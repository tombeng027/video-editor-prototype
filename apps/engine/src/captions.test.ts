import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "@ve/timeline-core";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { BACKUP_FILE, PROJECT_FILE, createProjectFolder, readProject, writeProject } from "./projectStore.js";

let tmp: string;
beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), "ve-captions-")); });
afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });
const sample = () => createEmptyProject({ id: "p", name: "Captions", fps: { num: 30, den: 1 }, width: 640, height: 360 });
const cue = { id: "cue", start: 0, end: 30, text: "Hello\nworld" };
const legacy = () => {
  const project = sample();
  return { schemaVersion: 1, id: project.id, name: project.name, settings: project.settings,
    assets: project.assets, tracks: project.tracks, createdAt: project.createdAt, updatedAt: project.updatedAt };
};

describe("caption persistence and compatibility", () => {
  it("migrates v1 in memory only, saves v2 on edit and keeps the original v1 backup", async () => {
    const old = JSON.stringify(legacy());
    await writeFile(path.join(tmp, PROJECT_FILE), old);
    const opened = await readProject(tmp);
    expect(opened.recoveredFromBackup).toBe(false);
    expect(opened.project).toMatchObject({ schemaVersion: 2, captionCues: [] });
    expect(await readFile(path.join(tmp, PROJECT_FILE), "utf8")).toBe(old);
    opened.project.captionCues = [cue];
    await writeProject(tmp, opened.project);
    expect(JSON.parse(await readFile(path.join(tmp, PROJECT_FILE), "utf8"))).toMatchObject({ schemaVersion: 2, captionCues: [cue] });
    expect(await readFile(path.join(tmp, BACKUP_FILE), "utf8")).toBe(old);
    expect((await readProject(tmp)).project.captionCues).toEqual([cue]);
  });
  it("recovers a corrupt main from a valid legacy backup without changing either file on open", async () => {
    const old = JSON.stringify(legacy());
    await writeFile(path.join(tmp, PROJECT_FILE), "{broken");
    await writeFile(path.join(tmp, BACKUP_FILE), old);
    expect(await readProject(tmp)).toMatchObject({ recoveredFromBackup: true, project: { schemaVersion: 2, captionCues: [] } });
    expect(await readFile(path.join(tmp, PROJECT_FILE), "utf8")).toBe("{broken");
    expect(await readFile(path.join(tmp, BACKUP_FILE), "utf8")).toBe(old);
  });
  it("does not recover an older backup over an unsupported-version main or overwrite it on save", async () => {
    const future = JSON.stringify({ ...sample(), schemaVersion: 999, futureData: "preserve" });
    const backup = JSON.stringify(legacy());
    await writeFile(path.join(tmp, PROJECT_FILE), future);
    await writeFile(path.join(tmp, BACKUP_FILE), backup);
    await expect(readProject(tmp)).rejects.toMatchObject({ code: "UNSUPPORTED_PROJECT_VERSION" });
    await expect(writeProject(tmp, sample())).rejects.toMatchObject({ code: "SAVE_FAILED" });
    expect(await readFile(path.join(tmp, PROJECT_FILE), "utf8")).toBe(future);
    expect(await readFile(path.join(tmp, BACKUP_FILE), "utf8")).toBe(backup);
  });
  it("rejects unsupported backups instead of treating them as corrupt data", async () => {
    await writeFile(path.join(tmp, BACKUP_FILE), JSON.stringify({ ...sample(), schemaVersion: 3 }));
    await expect(readProject(tmp)).rejects.toMatchObject({ code: "UNSUPPORTED_PROJECT_VERSION" });
  });
  it("uses relational validation on load and refuses to replace good files with overlapping cues", async () => {
    const project = sample();
    project.captionCues = [cue];
    await createProjectFolder(tmp, project);
    const before = await readFile(path.join(tmp, PROJECT_FILE), "utf8");
    project.captionCues.push({ ...cue, id: "overlap", start: 29, end: 60 });
    await expect(writeProject(tmp, project)).rejects.toMatchObject({ code: "CORRUPT" });
    expect(await readFile(path.join(tmp, PROJECT_FILE), "utf8")).toBe(before);
    await writeFile(path.join(tmp, PROJECT_FILE), JSON.stringify(project));
    await expect(readProject(tmp)).rejects.toMatchObject({ code: "CORRUPT" });
  });
  it("autosaves API cue edits, reopens them and restores exact data with confirmed Undo/Redo", async () => {
    const project = sample();
    const old = JSON.stringify(legacy());
    await writeFile(path.join(tmp, PROJECT_FILE), old);
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: path.join(tmp, "engine"), ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    try {
      const opened = await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder: tmp } });
      expect(opened.statusCode).toBe(200);
      expect(opened.json().warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PROJECT_MIGRATED" })]));
      expect(await readFile(path.join(tmp, PROJECT_FILE), "utf8")).toBe(old);
      const added = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "AddCaptionCue", cue }] } });
      expect(added.statusCode).toBe(200);
      expect((await readProject(tmp)).project.captionCues).toEqual([cue]);
      const malformed = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "SetCaptionCue", cue: { ...cue, text: "" } }] } });
      expect(malformed.statusCode).toBe(400);
      expect(malformed.json()).toMatchObject({ error: { code: "INVALID_REQUEST" }, outcome: "not-applied" });
      const rejected = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [
          { type: "AddCaptionCue", cue: { ...cue, id: "valid", start: 30, end: 60 } },
          { type: "AddCaptionCue", cue: { ...cue, id: "overlap", start: 29, end: 60 } },
        ] } });
      expect(rejected.statusCode).toBe(422);
      expect(rejected.json()).toMatchObject({ error: { code: "INVALID_CAPTION" }, outcome: "not-applied" });
      expect((await readProject(tmp)).project.captionCues).toEqual([cue]);
      const editedCue = { ...cue, start: 10, end: 40, text: "Edited" };
      const edited = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "SetCaptionCue", cue: editedCue }] } });
      expect(edited.statusCode).toBe(200);
      await app.inject({ method: "POST", url: "/project/close", headers });
      const reopened = await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder: tmp } });
      expect(reopened.json().project.captionCues).toEqual([editedCue]);
      const undone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: edited.json().inverse } });
      expect(undone.statusCode).toBe(200);
      expect((await readProject(tmp)).project.captionCues).toEqual([cue]);
      const redone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: undone.json().inverse } });
      expect(redone.statusCode).toBe(200);
      expect((await readProject(tmp)).project.captionCues).toEqual([editedCue]);
      const removed = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "RemoveCaptionCue", cueId: "cue" }] } });
      expect(removed.statusCode).toBe(200);
      expect((await readProject(tmp)).project.captionCues).toEqual([]);
      expect((await readProject(tmp)).project.tracks).toEqual(project.tracks);
    } finally { await app.close(); }
  });
  it("returns an explicit unsupported-version rejection on open, leaving files unchanged", async () => {
    const future = JSON.stringify({ ...sample(), schemaVersion: 3 });
    await writeFile(path.join(tmp, PROJECT_FILE), future);
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: path.join(tmp, "engine"), ENGINE_TOKEN: "secret" }));
    try {
      const opened = await app.inject({ method: "POST", url: "/project/open", headers: { "x-engine-token": "secret" }, payload: { folder: tmp } });
      expect(opened.statusCode).toBe(422);
      expect(opened.json()).toMatchObject({ error: { code: "UNSUPPORTED_PROJECT_VERSION" } });
      expect(await readFile(path.join(tmp, PROJECT_FILE), "utf8")).toBe(future);
    } finally { await app.close(); }
  });
});
