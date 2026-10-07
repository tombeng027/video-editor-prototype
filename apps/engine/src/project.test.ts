import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "ve-test-"));
});
afterEach(async () => rm(tmp, { recursive: true, force: true }));

const sample = (name = "Demo") =>
  createEmptyProject({ id: "p1", name, fps: { num: 30, den: 1 }, width: 1920, height: 1080 });

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

  it("returns an empty list for a missing or damaged index", async () => {
    const file = path.join(tmp, "recent.json");
    expect(await new RecentProjects(file).list()).toEqual([]);
    await writeFile(file, "garbage", "utf8");
    expect(await new RecentProjects(file).list()).toEqual([]);
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
