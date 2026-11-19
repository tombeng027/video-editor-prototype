import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createEmptyProject } from "@ve/timeline-core";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { exitWhenParentGone } from "./parentWatch.js";
import {
  BACKUP_FILE,
  PROJECT_FILE,
  StoreError,
  createProjectFolder,
  readProject,
  writeProject,
} from "./projectStore.js";
import type { Probes } from "./probes.js";
import { RecentProjects } from "./recent.js";
import { ProxyManager } from "./proxy.js";
import { ProjectSession } from "./session.js";
import { quickHash } from "./media.js";
import * as projectStore from "./projectStore.js";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "ve-test-"));
});
afterEach(async () => rm(tmp, { recursive: true, force: true }));

const sample = (name = "Demo") =>
  createEmptyProject({ id: "p1", name, fps: { num: 30, den: 1 }, width: 1920, height: 1080 });

describe("clip properties persistence", () => {
  it("autosaves canvas dimensions, reopens them and restores the original size with confirmed Undo", async () => {
    const folder = path.join(tmp, "canvas");
    const project = sample();
    await createProjectFolder(folder, project);
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    try {
      await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      const applied = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "SetProjectCanvas", width: 1080, height: 1920 }] } });
      expect(applied.statusCode).toBe(200);
      expect((await readProject(folder)).project.settings).toMatchObject({ width: 1080, height: 1920 });
      await app.inject({ method: "POST", url: "/project/close", headers });
      const reopened = await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      expect(reopened.json().project.settings).toMatchObject({ width: 1080, height: 1920 });
      const undone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: applied.json().inverse } });
      expect(undone.statusCode).toBe(200);
      expect((await readProject(folder)).project.settings).toEqual(project.settings);
    } finally { await app.close(); }
  });

  it("autosaves crop, reopens it and restores exact crop presence through confirmed Undo/Redo", async () => {
    const folder = path.join(tmp, "crop");
    const project = sample();
    project.assets = [{ id: "a", name: "Still", kind: "image", mediaMode: "reference", sourcePath: path.join(tmp, "still.png"),
      contentHash: "fixture", durationFrames: 150, fps: null, width: 64, height: 64, hasAudio: false, proxyPath: null }];
    project.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true,
    }] }];
    await createProjectFolder(folder, project);
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    const crop = { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 };
    try {
      await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      const applied = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "SetClipCrop", clipId: "c", crop }] } });
      expect(applied.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks[0]!.clips[0]!.crop).toEqual(crop);
      const invalid = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "SetClipCrop", clipId: "c", crop: { ...crop, left: 0.9 } }] } });
      expect(invalid.json()).toMatchObject({ error: { code: "INVALID_REQUEST" }, outcome: "not-applied" });
      expect((await readProject(folder)).project.tracks[0]!.clips[0]!.crop).toEqual(crop);
      await app.inject({ method: "POST", url: "/project/close", headers });
      const reopened = await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      expect(reopened.json().project.tracks[0].clips[0].crop).toEqual(crop);
      const undone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: applied.json().inverse } });
      expect(undone.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks).toEqual(project.tracks);
      const redone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: undone.json().inverse } });
      expect(redone.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks[0]!.clips[0]!.crop).toEqual(crop);
    } finally { await app.close(); }
  });

  it("autosaves animations, reopens them, rejects invalid shortening and supports confirmed Undo/Redo", async () => {
    const folder = path.join(tmp, "animations");
    const project = sample();
    project.assets = [{ id: "a", name: "Still", kind: "image", mediaMode: "reference", sourcePath: path.join(tmp, "still.png"),
      contentHash: "fixture", durationFrames: 150, fps: null, width: 64, height: 64, hasAudio: false, proxyPath: null }];
    project.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true,
    }] }];
    await createProjectFolder(folder, project);
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    const animations = { entrance: { id: "entrance.zoom", version: 1, durationFrames: 15 },
      exit: { id: "exit.fade", version: 1, durationFrames: 15 } };
    try {
      await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      const applied = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "SetClipAnimations", clipId: "c", animations }] } });
      expect(applied.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks[0]!.clips[0]!.animations).toEqual(animations);
      const rejected = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "TrimClip", clipId: "c", sourceOut: 20 }] } });
      expect(rejected.json()).toMatchObject({ error: { code: "INVALID_ANIMATION" }, outcome: "not-applied" });
      expect((await readProject(folder)).project.tracks[0]!.clips[0]!.sourceOut).toBe(60);
      await app.inject({ method: "POST", url: "/project/close", headers });
      const reopened = await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      expect(reopened.json().project.tracks[0].clips[0].animations).toEqual(animations);
      const undone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: applied.json().inverse } });
      expect(undone.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks).toEqual(project.tracks);
      const redone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: undone.json().inverse } });
      expect(redone.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks[0]!.clips[0]!.animations).toEqual(animations);
    } finally { await app.close(); }
  });
  it("marks only definitive command rejections as not applied and leaves duplicate attempts ambiguous", async () => {
    const folder = path.join(tmp, "rejection");
    await createProjectFolder(folder, sample());
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    try {
      const invalid = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "UnsupportedCommand" }] } });
      expect(invalid.json()).toMatchObject({ error: { code: "INVALID_REQUEST" }, outcome: "not-applied" });
      await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      const attemptId = "00000000-0000-4000-8000-000000000022";
      const payload = { attemptId, commands: [{ type: "RemoveClip", clipId: "missing" }] };
      const rejected = await app.inject({ method: "POST", url: "/project/commands", headers, payload });
      expect(rejected.json()).toMatchObject({ error: { code: "NOT_FOUND" }, outcome: "not-applied" });
      const duplicate = await app.inject({ method: "POST", url: "/project/commands", headers, payload });
      expect(duplicate.json().error.code).toBe("ATTEMPT_EXISTS");
      expect(duplicate.json()).not.toHaveProperty("outcome");
    } finally { await app.close(); }
  });
  it("autosaves speed and ripple, reopens them and restores exact timing using the confirmed inverse", async () => {
    const folder = path.join(tmp, "speed");
    const project = sample();
    project.assets = [{ id: "a", name: "Audio", kind: "audio", mediaMode: "reference", sourcePath: path.join(tmp, "audio.wav"),
      contentHash: "fixture", durationFrames: 10000, fps: { num: 1000, den: 1 }, width: null, height: null, hasAudio: true, proxyPath: null }];
    project.tracks = [{ id: "t", kind: "audio", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 120, speed: 1, audioLinked: true },
      { id: "n", assetId: "a", timelineStart: 150, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true },
    ] }];
    await createProjectFolder(folder, project);
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    try {
      await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      const applied = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "SetClipSpeed", clipId: "c", speed: 2 }] } });
      expect(applied.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks[0]!.clips.map((c) => [c.speed, c.timelineStart])).toEqual([[2, 0], [1, 90]]);
      await app.inject({ method: "POST", url: "/project/close", headers });
      const reopened = await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      expect(reopened.json().project.tracks[0].clips[0].speed).toBe(2);
      const undone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: applied.json().inverse } });
      expect(undone.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks).toEqual(project.tracks);
    } finally { await app.close(); }
  });
  it("autosaves transforms, reopens them and restores absence via the confirmed inverse", async () => {
    const folder = path.join(tmp, "properties");
    const project = sample();
    project.assets = [{ id: "a", name: "Still", kind: "image", mediaMode: "reference", sourcePath: path.join(tmp, "still.png"),
      contentHash: "fixture", durationFrames: 150, fps: null, width: 64, height: 64, hasAudio: false, proxyPath: null }];
    project.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 150, speed: 1, audioLinked: true,
    }] }];
    await createProjectFolder(folder, project);
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    try {
      await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      const transform = { x: 0.75, y: 0.5, scale: 1.5, opacity: 0.25 };
      const applied = await app.inject({ method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "SetClipTransform", clipId: "c", transform }] } });
      expect(applied.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks[0]!.clips[0]!.transform).toEqual(transform);
      await app.inject({ method: "POST", url: "/project/close", headers });
      const reopened = (await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } })).json();
      expect(reopened.project.tracks[0].clips[0].transform).toEqual(transform);
      const undone = await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: applied.json().inverse } });
      expect(undone.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks[0]!.clips[0]).not.toHaveProperty("transform");
    } finally { await app.close(); }
  });
});

describe("media relinking", () => {
  it("uses relinked originals without auto-generating proxies and prepares only on request", async () => {
    const sourcePath = path.join(tmp, "relocated.mp4");
    await writeFile(sourcePath, "owned video fixture");
    const project = sample();
    project.assets = [{
      id: "video", name: "video.mp4", kind: "video", mediaMode: "reference",
      sourcePath: path.join(tmp, "missing.mp4"), contentHash: await quickHash(sourcePath),
      durationFrames: 30, fps: { num: 30, den: 1 }, width: 1920, height: 1080, hasAudio: false, proxyPath: null,
    }];
    const folder = path.join(tmp, "project");
    await createProjectFolder(folder, project);
    const proxyRunner = vi.fn(async (job: { source: string; outFile: string }) => {
      expect(job.source).toBe(sourcePath);
      await writeFile(job.outFile, "owned proxy fixture");
    });
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }), undefined, { proxyRunner });
    const headers = { "x-engine-token": "secret" };
    try {
      await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      expect(proxyRunner).not.toHaveBeenCalled();
      const result = await app.inject({
        method: "POST", url: "/project/commands", headers,
        payload: { commands: [{ type: "RelinkAsset", assetId: "video", sourcePath }] },
      });
      expect(result.statusCode).toBe(200);
      expect(proxyRunner).not.toHaveBeenCalled();
      const prepared = await app.inject({ method: "POST", url: "/project/preview-jobs", headers,
        payload: { assetId: "video", action: "prepare", expectedProject: { id: project.id, folder } } });
      expect(prepared.statusCode).toBe(200);
      await vi.waitFor(async () => {
        expect((await readProject(folder)).project.assets[0]!.proxyPath).toBe("proxies/video.mp4");
      });
      expect(proxyRunner).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });

  it("validates replacements, persists the reference and preserves clips and operation recovery", async () => {
    const replacement = path.join(tmp, "relocated.wav");
    const different = path.join(tmp, "different.wav");
    await writeFile(replacement, "original owned audio fixture");
    await writeFile(different, "other owned audio fixture");
    const project = sample();
    project.assets = [{
      id: "music", name: "original.wav", kind: "audio", mediaMode: "copy", sourcePath: "media/missing.wav",
      contentHash: await quickHash(replacement), durationFrames: 10000, fps: { num: 1000, den: 1 },
      width: null, height: null, hasAudio: true, proxyPath: null,
    }];
    project.tracks = [{
      id: "audio", kind: "audio", order: 0, muted: false, locked: false,
      clips: [{ id: "sound", assetId: "music", timelineStart: 30, sourceIn: 15, sourceOut: 90, speed: 1, audioLinked: true }],
    }];
    const folder = path.join(tmp, "project");
    await createProjectFolder(folder, project);
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    try {
      await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      for (const [sourcePath, code] of [
        [different, "RELINK_MISMATCH"], [path.join(tmp, "absent.wav"), "RELINK_INVALID_FILE"],
        [tmp, "RELINK_INVALID_FILE"], ["relative.wav", "RELINK_INVALID_FILE"],
      ]) {
        const result = await app.inject({
          method: "POST", url: "/project/commands", headers,
          payload: { commands: [{ type: "RelinkAsset", assetId: "music", sourcePath }] },
        });
        expect(result.statusCode).toBe(422);
        expect(result.json().error.code).toBe(code);
        expect((await readProject(folder)).project).toEqual(project);
      }
      const attemptId = crypto.randomUUID();
      const result = await app.inject({
        method: "POST", url: "/project/commands", headers,
        payload: { attemptId, commands: [{ type: "RelinkAsset", assetId: "music", sourcePath: replacement }] },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().inverse).toEqual([]);
      const persisted = (await readProject(folder)).project;
      expect(persisted.tracks).toEqual(project.tracks);
      expect(persisted.assets[0]).toEqual({ ...project.assets[0], sourcePath: replacement, mediaMode: "reference" });
      const status = await app.inject({ url: `/project/command-operations/${attemptId}`, headers });
      expect(status.json().state).toBe("done");
      const media = await app.inject({ url: "/project/media-status", headers });
      expect(media.json().offline).toEqual([]);
    } finally { await app.close(); }
  });
});

describe("default project location", () => {
  it("returns a recoverable error when the location is a file", async () => {
    const folder = path.join(tmp, "not-a-directory");
    await writeFile(folder, "test");
    const app = await buildApp(loadConfig({ PROJECTS_DIR: folder, ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    try {
      const result = await app.inject({ url: "/projects/default-folder", headers: { "x-engine-token": "secret" } });
      expect(result.statusCode).toBe(422);
      expect(result.json().error).toMatchObject({ code: "PROJECT_LOCATION_UNAVAILABLE" });
      expect(result.json().error.message).toMatch(/Choose a writable folder/);
    } finally { await app.close(); }
  });
  it("rejects a relative override", () => {
    expect(() => loadConfig({ PROJECTS_DIR: "relative" })).toThrow(/absolute/);
  });

  it("creates the configured folder and protects the route", async () => {
    const folder = path.join(tmp, "samples");
    const app = await buildApp(loadConfig({ PROJECTS_DIR: folder, ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    try {
      expect((await app.inject({ url: "/projects/default-folder" })).statusCode).toBe(401);
      const result = await app.inject({ url: "/projects/default-folder", headers: { "x-engine-token": "secret" } });
      expect(result.json()).toEqual({ folder });
      expect((await stat(folder)).isDirectory()).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("projectStore", () => {
  it("creates the folder layout and a readable project", async () => {
    const folder = path.join(tmp, "A");
    await createProjectFolder(folder, sample());
    const { project, recoveredFromBackup } = await readProject(folder);
    expect(project.name).toBe("Demo");
    expect(recoveredFromBackup).toBe(false);
  });

  it("refuses to create over an existing project", async () => {
    const folder = path.join(tmp, "A");
    await createProjectFolder(folder, sample());
    await expect(createProjectFolder(folder, sample())).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
  });

  it("keeps the previous version as a backup and leaves no temp file", async () => {
    const folder = path.join(tmp, "A");
    await createProjectFolder(folder, sample("One"));
    await writeProject(folder, sample("Two"));
    expect(JSON.parse(await readFile(path.join(folder, BACKUP_FILE), "utf8")).name).toBe("One");
    expect(JSON.parse(await readFile(path.join(folder, PROJECT_FILE), "utf8")).name).toBe("Two");
    await expect(readFile(path.join(folder, `${PROJECT_FILE}.tmp`))).rejects.toThrow();
  });

  it("recovers from the backup when project.json is corrupt", async () => {
    const folder = path.join(tmp, "A");
    await createProjectFolder(folder, sample("One"));
    await writeProject(folder, sample("Two"));
    await writeFile(path.join(folder, PROJECT_FILE), "{ not json", "utf8");
    const result = await readProject(folder);
    expect(result.recoveredFromBackup).toBe(true);
    expect(result.project.name).toBe("One");
  });

  it("reports corrupt when there is no usable backup, and not found for empty folders", async () => {
    const folder = path.join(tmp, "A");
    await createProjectFolder(folder, sample());
    await writeFile(path.join(folder, PROJECT_FILE), "{}", "utf8");
    await expect(readProject(folder)).rejects.toMatchObject({ code: "CORRUPT" });
    await expect(readProject(path.join(tmp, "empty"))).rejects.toBeInstanceOf(StoreError);
  });
});

describe("RecentProjects", () => {
  it("lists most recent first, dedupes, caps at 10 and flags missing projects", async () => {
    const recent = new RecentProjects(path.join(tmp, "data", "recent.json"));
    for (let i = 0; i < 12; i++) await recent.add(path.join(tmp, `p${i}`), `P${i}`);
    await recent.add(path.join(tmp, "p5"), "P5 again");
    const list = await recent.list();
    expect(list).toHaveLength(10);
    expect(list[0]).toMatchObject({ name: "P5 again", exists: false });
    expect(list.filter((p) => p.folder.endsWith("p5"))).toHaveLength(1);
  });

  it("returns an empty list only for a missing index and reports damage", async () => {
    const file = path.join(tmp, "recent.json");
    expect(await new RecentProjects(file).list()).toEqual([]);
    await writeFile(file, "garbage", "utf8");
    await expect(new RecentProjects(file).list()).rejects.toMatchObject({ code: "RECENT_INDEX_INVALID" });
  });
});

describe("exitWhenParentGone", () => {
  it("fires once when the stream ends or closes", () => {
    const stream = Object.assign(new EventEmitter(), { resume: () => undefined });
    let calls = 0;
    exitWhenParentGone(stream, () => calls++);
    stream.emit("end");
    stream.emit("close");
    expect(calls).toBe(1);
  });
});

describe("project routes", () => {
  const probes: Probes = {
    ffmpeg: async () => ({ name: "ffmpeg", status: "ok" }),
    ollama: async () => ({ name: "ollama", status: "unknown" }),
    vision: async () => ({ name: "vision", status: "unknown" }),
  };
  let app: FastifyInstance;
  const headers = { "x-engine-token": "secret" };

  async function make() {
    const config = loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") });
    app = await buildApp(config, probes);
    return app;
  }
  afterEach(async () => app?.close());

  const createBody = (folder: string) => ({
    folder,
    name: "Demo",
    fps: { num: 30, den: 1 },
    width: 1920,
    height: 1080,
  });

  it("persists renamed and locked tracks across reopening and restores their exact settings through inverse commands", async () => {
    const a = await make(), folder = path.join(tmp, "track-settings");
    await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folder) });
    await a.inject({ method: "POST", url: "/project/commands", headers, payload: {
      commands: [{ type: "AddTrack", track: { id: "track", kind: "audio", order: 0, muted: false, locked: false, clips: [] } }],
    } });
    const changed = await a.inject({ method: "POST", url: "/project/commands", headers, payload: {
      commands: [{ type: "SetTrackName", trackId: "track", name: " Music " }, { type: "SetTrackLocked", trackId: "track", locked: true }],
    } });
    expect(changed.statusCode).toBe(200);
    await a.inject({ method: "POST", url: "/project/close", headers });
    const reopened = await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    expect(reopened.json().project.tracks[0]).toMatchObject({ name: "Music", locked: true });
    const blocked = await a.inject({ method: "POST", url: "/project/commands", headers,
      payload: { commands: [{ type: "RemoveTrack", trackId: "track" }] } });
    expect(blocked.json().error.code).toBe("TRACK_LOCKED");
    const restored = await a.inject({ method: "POST", url: "/project/commands", headers,
      payload: { commands: changed.json().inverse } });
    expect(restored.statusCode).toBe(200);
    const saved = (await readProject(folder)).project.tracks[0]!;
    expect(saved.locked).toBe(false);
    expect(saved).not.toHaveProperty("name");
  });

  it.each(["SAVE_FAILED", "SAVE_CLEANUP_FAILED"] as const)("confirms %s without applying an edit and permits an explicit new attempt", async (code) => {
    const a = await make();
    const folder = path.join(tmp, "save-failure");
    const opened = (await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folder) })).json();
    const attemptId = "00000000-0000-4000-8000-000000000051";
    const commands = [{ type: "AddTrack", track: { id: "track", kind: "video", order: 0, muted: false, locked: false, clips: [] } }];
    const write = vi.spyOn(projectStore, "writeProject").mockRejectedValueOnce(new StoreError(code, "Injected disk failure"));
    try {
      const failed = await a.inject({ method: "POST", url: "/project/commands", headers, payload: { attemptId, commands } });
      expect(failed.statusCode).toBe(500);
      expect(failed.json().error.code).toBe(code);
      const status = (await a.inject({ url: `/project/command-operations/${attemptId}`, headers })).json();
      expect(status).toMatchObject({ state: "failed", error: { code } });
      expect((await a.inject({ url: "/project", headers })).json().project).toEqual(opened.project);
      expect((await readProject(folder)).project).toEqual(opened.project);
      expect(write).toHaveBeenCalledOnce();
      const retry = await a.inject({ method: "POST", url: "/project/commands", headers,
        payload: { attemptId: "00000000-0000-4000-8000-000000000052", commands } });
      expect(retry.statusCode).toBe(200);
      expect((await readProject(folder)).project.tracks.map((track) => track.id)).toEqual(["track"]);
    } finally { write.mockRestore(); }
  });

  it("keeps backup recovery explicit until a successful autosave repairs the main file and preserves the usable backup", async () => {
    const a = await make();
    const folder = path.join(tmp, "backup-recovery");
    await createProjectFolder(folder, sample("Backup"));
    await writeProject(folder, sample("Newer"));
    await writeFile(path.join(folder, PROJECT_FILE), "{broken");
    const backupBefore = await readFile(path.join(folder, BACKUP_FILE), "utf8");
    const opened = await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    expect(opened.json()).toMatchObject({ recoveredFromBackup: true, project: { name: "Backup" } });
    expect(await readFile(path.join(folder, PROJECT_FILE), "utf8")).toBe("{broken");
    const saved = await a.inject({ method: "POST", url: "/project/commands", headers, payload: {
      commands: [{ type: "AddTrack", track: { id: "track", kind: "video", order: 0, muted: false, locked: false, clips: [] } }],
    } });
    expect(saved.statusCode).toBe(200);
    expect((await a.inject({ url: "/project", headers })).json().recoveredFromBackup).toBe(false);
    expect(await readFile(path.join(folder, BACKUP_FILE), "utf8")).toBe(backupBefore);
    const reopened = await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    expect(reopened.json()).toMatchObject({ recoveredFromBackup: false, project: { name: "Backup", tracks: [{ id: "track" }] } });
  });

  it("refuses stale expected-project closes without affecting the active project and accepts settled retries", async () => {
    const a = await make();
    const folderA = path.join(tmp, "A");
    const folderB = path.join(tmp, "B");
    const first = (await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folderA) })).json();
    const second = (await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folderB) })).json();
    const stale = await a.inject({ method: "POST", url: "/project/close", headers,
      payload: { expectedProject: { id: first.project.id, folder: folderA } } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("PROJECT_CHANGED");
    expect((await a.inject({ url: "/project", headers })).json().project.id).toBe(second.project.id);
    const wrongFolder = await a.inject({ method: "POST", url: "/project/close", headers,
      payload: { expectedProject: { id: second.project.id, folder: folderA } } });
    expect(wrongFolder.statusCode).toBe(409);
    const invalid = await a.inject({ method: "POST", url: "/project/close", headers,
      payload: { expectedProject: { id: second.project.id } } });
    expect(invalid.statusCode).toBe(400);
    const close = { method: "POST", url: "/project/close", headers,
      payload: { expectedProject: { id: second.project.id, folder: folderB } } } as const;
    expect((await a.inject(close)).json()).toEqual({ ok: true });
    expect((await a.inject({ url: "/project", headers })).statusCode).toBe(404);
    expect((await a.inject(close)).json()).toEqual({ ok: true });
    expect((await readProject(folderA)).project.id).toBe(first.project.id);
    expect((await readProject(folderB)).project.id).toBe(second.project.id);
  });

  it("reports post-commit close cleanup failure and permits confirmation retry without deleting saved work", async () => {
    const a = await make();
    const folder = path.join(tmp, "close-recovery");
    const opened = (await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folder) })).json();
    const request = { method: "POST", url: "/project/close", headers,
      payload: { expectedProject: { id: opened.project.id, folder } } } as const;
    const reset = vi.spyOn(ProxyManager.prototype, "reset").mockImplementationOnce(() => {
      throw new Error("Injected close cleanup failure");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failed = await a.inject(request);
      expect(failed.statusCode).toBe(500);
      expect(failed.json().error.code).toBe("ENGINE_UNEXPECTED_ERROR");
      expect(failed.json().error.diagnosticId).toEqual(expect.any(String));
      expect(JSON.parse(log.mock.calls[0]![0]).diagnosticId).toBe(failed.json().error.diagnosticId);
      expect(failed.body).not.toContain("Injected close cleanup failure");
      expect((await a.inject({ url: "/project", headers })).statusCode).toBe(404);
      expect((await a.inject(request)).json()).toEqual({ ok: true });
      expect((await readProject(folder)).project.id).toBe(opened.project.id);
    } finally {
      reset.mockRestore();
      log.mockRestore();
    }
  });

  it("reports committed create/open preparation failures as warnings and retains matching recovery results", async () => {
    const a = await make(), folder = path.join(tmp, "preparation-warning");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reset = vi.spyOn(ProxyManager.prototype, "reset").mockImplementationOnce(() => { throw new Error("Injected preparation failure"); });
    const attemptId = "00000000-0000-4000-8000-000000000001";
    try {
      const created = await a.inject({ method: "POST", url: "/project/create", headers, payload: { ...createBody(folder), attemptId } });
      expect(created.statusCode).toBe(200);
      expect(created.json().warnings).toContainEqual(expect.objectContaining({ code: "PROJECT_PREPARATION_FAILED" }));
      expect((await readProject(folder)).project.id).toBe(created.json().project.id);
      const status = await a.inject({ url: `/project/operations/${attemptId}`, headers });
      expect(status.json()).toMatchObject({ state: "done", attemptId, response: created.json() });
      const duplicate = await a.inject({ method: "POST", url: "/project/create", headers, payload: { ...createBody(folder), attemptId } });
      expect(duplicate.json().error.code).toBe("ATTEMPT_EXISTS");
      const openId = "00000000-0000-4000-8000-000000000002";
      reset.mockImplementationOnce(() => { throw new Error("Injected open preparation failure"); });
      const opened = await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder, attemptId: openId } });
      expect(opened.statusCode).toBe(200);
      expect(opened.json().warnings[0].code).toBe("PROJECT_PREPARATION_FAILED");
      expect((await a.inject({ url: `/project/operations/${openId}`, headers })).json().response).toEqual(opened.json());
      expect((await a.inject({ url: `/project/operations/${attemptId}`, headers })).json().error.code).toBe("PROJECT_CHANGED");
      expect(log).toHaveBeenCalledTimes(2);
      for (let i = 0; i < 2; i++) {
        const record = JSON.parse(log.mock.calls[i]![0]);
        const warning = i === 0 ? created.json().warnings[0] : opened.json().warnings[0];
        expect(record.code).toBe("PROJECT_PREPARATION_FAILED");
        expect(warning.message).toContain(record.diagnosticId);
        expect(JSON.stringify(record)).not.toContain("Injected");
      }
    } finally { reset.mockRestore(); log.mockRestore(); }
  });

  it("retains an unexpected project-operation diagnostic in both failure response and recovery status", async () => {
    const a = await make(), folder = path.join(tmp, "diagnostic-failure");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = vi.spyOn(ProjectSession.prototype, "create").mockRejectedValueOnce(
      new Error("private unexpected cause", { cause: Object.assign(new Error("private path"), { code: "ENOSPC" }) }),
    );
    const attemptId = "00000000-0000-4000-8000-000000000001";
    try {
      const result = await a.inject({ method: "POST", url: "/project/create", headers, payload: { ...createBody(folder), attemptId } });
      expect(result.statusCode).toBe(500);
      expect(result.json().error.code).toBe("PROJECT_OPERATION_FAILED");
      const record = JSON.parse(log.mock.calls[0]![0]);
      expect(record.diagnosticId).toBe(result.json().error.diagnosticId);
      expect(record.causes[1].ioCode).toBe("ENOSPC");
      expect(result.body + JSON.stringify(record)).not.toContain("private");
      const status = (await a.inject({ url: `/project/operations/${attemptId}`, headers })).json();
      expect(status).toMatchObject({ state: "failed", attemptId, error: result.json().error });
      expect((await a.inject({ url: "/project", headers })).statusCode).toBe(404);
      await expect(stat(path.join(folder, PROJECT_FILE))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { failure.mockRestore(); log.mockRestore(); }
  });

  it("records pending before hooks settle, rejects overlapping opens and invalidates status after close", async () => {
    const a = await make(), folder = path.join(tmp, "pending");
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const idle = vi.spyOn(ProxyManager.prototype, "idle").mockImplementationOnce(() => {
      entered();
      return new Promise<void>((resolve) => { release = resolve; });
    });
    const attemptId = "00000000-0000-4000-8000-000000000001";
    const started = a.inject({ method: "POST", url: "/project/create", headers, payload: { ...createBody(folder), attemptId } }).then((r) => r);
    try {
      await waiting;
      expect((await a.inject({ url: `/project/operations/${attemptId}`, headers })).json()).toEqual({ state: "pending", attemptId });
      const busy = await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      expect(busy.json().error.code).toBe("PROJECT_OPERATION_BUSY");
      release();
      expect((await started).statusCode).toBe(200);
      await a.inject({ method: "POST", url: "/project/close", headers });
      expect((await a.inject({ url: `/project/operations/${attemptId}`, headers })).json().error.code).toBe("PROJECT_CHANGED");
    } finally { release(); await started; idle.mockRestore(); }
  });

  it("validates, authenticates and records definitive project failures without changing the active project", async () => {
    const a = await make(), folder = path.join(tmp, "missing");
    const attemptId = "00000000-0000-4000-8000-000000000001";
    expect((await a.inject({ url: `/project/operations/${attemptId}` })).statusCode).toBe(401);
    expect((await a.inject({ url: "/project/operations/invalid", headers })).statusCode).toBe(400);
    expect((await a.inject({ url: `/project/operations/${attemptId}`, headers })).json().error.code).toBe("OPERATION_UNKNOWN");
    const failed = await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder, attemptId } });
    expect(failed.statusCode).toBe(404);
    expect((await a.inject({ url: `/project/operations/${attemptId}`, headers })).json()).toMatchObject({ state: "failed", attemptId, error: { code: "NOT_FOUND" } });
    expect((await a.inject({ url: "/project", headers })).statusCode).toBe(404);
    expect((await a.inject({ method: "POST", url: "/project/create", headers, payload: { ...createBody(folder), attemptId: "bad" } })).statusCode).toBe(400);
  });

  it("returns current committed edits for a completed attempt rather than its stale opening snapshot", async () => {
    const a = await make(), folder = path.join(tmp, "operation-edits");
    const attemptId = "00000000-0000-4000-8000-000000000001";
    await a.inject({ method: "POST", url: "/project/create", headers, payload: { ...createBody(folder), attemptId } });
    await a.inject({ method: "POST", url: "/project/commands", headers,
      payload: { commands: [{ type: "AddTrack", track: { id: "new-track", kind: "video", order: 0, muted: false, locked: false, clips: [] } }] } });
    const status = (await a.inject({ url: `/project/operations/${attemptId}`, headers })).json();
    expect(status.state).toBe("done");
    expect(status.response.project.tracks[0].id).toBe("new-track");
    expect(status.response.project).toEqual((await readProject(folder)).project);
  });

  it("records command outcomes and rejects duplicate attempt IDs without applying them twice", async () => {
    const a = await make(), folder = path.join(tmp, "command-recovery");
    const successId = "00000000-0000-4000-8000-000000000011";
    await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folder) });
    const payload = { attemptId: successId, commands: [
      { type: "AddTrack", track: { id: "track-1", kind: "video", order: 0, muted: false, locked: false, clips: [] } },
    ] };
    const applied = await a.inject({ method: "POST", url: "/project/commands", headers, payload });
    expect(applied.statusCode).toBe(200);
    expect((await a.inject({ url: `/project/command-operations/${successId}`, headers })).json())
      .toMatchObject({ state: "done", attemptId: successId, response: { project: { tracks: [{ id: "track-1" }] } } });
    const duplicate = await a.inject({ method: "POST", url: "/project/commands", headers, payload });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ATTEMPT_EXISTS");
    expect((await readProject(folder)).project.tracks).toHaveLength(1);

    const failedId = "00000000-0000-4000-8000-000000000012";
    const failed = await a.inject({ method: "POST", url: "/project/commands", headers, payload: {
      attemptId: failedId, commands: [{ type: "RemoveTrack", trackId: "missing" }],
    } });
    expect(failed.statusCode).toBe(422);
    expect((await a.inject({ url: `/project/command-operations/${failedId}`, headers })).json())
      .toMatchObject({ state: "failed", attemptId: failedId });
  });

  it("reports pending and unknown command operations without implying a rollback", async () => {
    const a = await make(), folder = path.join(tmp, "command-pending");
    const pendingId = "00000000-0000-4000-8000-000000000014";
    await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folder) });
    const originalApply = ProjectSession.prototype.apply;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const apply = vi.spyOn(ProjectSession.prototype, "apply").mockImplementationOnce(async function (this: ProjectSession, commands, version) {
      await gate;
      return originalApply.call(this, commands, version);
    });
    const commandRequest = a.inject({ method: "POST", url: "/project/commands", headers, payload: {
      attemptId: pendingId, commands: [{ type: "AddTrack", track: { id: "track-1", kind: "video", order: 0, muted: false, locked: false, clips: [] } }],
    } });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect((await a.inject({ url: `/project/command-operations/${pendingId}`, headers })).json())
      .toEqual({ state: "pending", attemptId: pendingId });
    release();
    expect((await commandRequest).statusCode).toBe(200);

    const unknownId = "00000000-0000-4000-8000-000000000015";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    apply.mockRejectedValueOnce(new Error("Injected command failure"));
    try {
      const failed = await a.inject({ method: "POST", url: "/project/commands", headers, payload: {
        attemptId: unknownId, commands: [{ type: "AddTrack", track: { id: "track-2", kind: "video", order: 1, muted: false, locked: false, clips: [] } }],
      } });
      expect(failed.statusCode).toBe(500);
      expect(failed.json().error.code).toBe("ENGINE_UNEXPECTED_ERROR");
      const status = (await a.inject({ url: `/project/command-operations/${unknownId}`, headers })).json();
      expect(status).toMatchObject({ state: "unknown", attemptId: unknownId, error: { diagnosticId: failed.json().error.diagnosticId } });
      expect(failed.body).not.toContain("Injected command failure");
    } finally {
      apply.mockRestore();
      log.mockRestore();
    }
  });

  it("does not return a command result after its project generation changes", async () => {
    const a = await make(), folder = path.join(tmp, "command-generation");
    const attemptId = "00000000-0000-4000-8000-000000000013";
    await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folder) });
    await a.inject({ method: "POST", url: "/project/commands", headers, payload: {
      attemptId, commands: [{ type: "AddTrack", track: { id: "track-1", kind: "video", order: 0, muted: false, locked: false, clips: [] } }],
    } });
    await a.inject({ method: "POST", url: "/project/close", headers });
    await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    const status = await a.inject({ url: `/project/command-operations/${attemptId}`, headers });
    expect(status.statusCode).toBe(409);
    expect(status.json().error.code).toBe("PROJECT_CHANGED");
  });

  it("bounds operation records and reports eviction explicitly instead of guessing a retry outcome", async () => {
    const a = await make(), folder = path.join(tmp, "not-created");
    const ids: string[] = [];
    for (let i = 0; i < 17; i++) {
      const attemptId = crypto.randomUUID();
      ids.push(attemptId);
      await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder, attemptId } });
    }
    expect((await a.inject({ url: `/project/operations/${ids[0]}`, headers })).json().error.code).toBe("OPERATION_UNKNOWN");
    expect((await a.inject({ url: `/project/operations/${ids[1]}`, headers })).json()).toMatchObject({ state: "failed" });
    expect((await a.inject({ url: `/project/operations/${ids[16]}`, headers })).json()).toMatchObject({ state: "failed" });
  });

  it("creates, applies commands with autosave, and reopens the saved state", async () => {
    const a = await make();
    const folder = path.join(tmp, "proj");
    const created = await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folder) });
    expect(created.statusCode).toBe(200);

    const applied = await a.inject({
      method: "POST",
      url: "/project/commands",
      headers,
      payload: { commands: [{ type: "AddTrack", track: { id: "t1", kind: "video", order: 0, muted: false, locked: false, clips: [] } }] },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().project.tracks).toHaveLength(1);

    await a.inject({ method: "POST", url: "/project/close", headers });
    const reopened = await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    expect(reopened.json().project.tracks).toHaveLength(1);

    const recent = await a.inject({ url: "/projects/recent", headers });
    expect(recent.json().projects[0]).toMatchObject({ name: "Demo", exists: true });
  });

  it("rejects an invalid command batch without changing or saving anything", async () => {
    const a = await make();
    const folder = path.join(tmp, "proj");
    await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody(folder) });
    const res = await a.inject({
      method: "POST",
      url: "/project/commands",
      headers,
      payload: { commands: [{ type: "RemoveTrack", trackId: "missing" }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBeTruthy();
    expect((await readProject(folder)).project.tracks).toHaveLength(0);
  });

  it("returns typed errors for bad input, missing projects and no open project", async () => {
    const a = await make();
    const bad = await a.inject({ method: "POST", url: "/project/create", headers, payload: { folder: "x" } });
    expect(bad.statusCode).toBe(400);
    const relative = await a.inject({ method: "POST", url: "/project/create", headers, payload: createBody("relative/dir") });
    expect(relative.json().error.code).toBe("INVALID_PATH");
    const missing = await a.inject({ method: "POST", url: "/project/open", headers, payload: { folder: path.join(tmp, "none") } });
    expect(missing.statusCode).toBe(404);
    const noProject = await a.inject({
      method: "POST",
      url: "/project/commands",
      headers,
      payload: { commands: [{ type: "RemoveTrack", trackId: "t" }] },
    });
    expect(noProject.json().error.code).toBe("NO_PROJECT");
  });

  it("requires the token on project routes", async () => {
    const a = await make();
    expect((await a.inject({ url: "/projects/recent" })).statusCode).toBe(401);
  });
});
