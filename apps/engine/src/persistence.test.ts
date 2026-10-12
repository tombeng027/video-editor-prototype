import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@ve/schema";
import { applyCommands, createEmptyProject, validateProject } from "@ve/timeline-core";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { BACKUP_FILE, PROJECT_FILE, createProjectFolder, readProject, writeProject } from "./projectStore.js";
import { RecentProjects } from "./recent.js";
import { ProjectSession } from "./session.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rename: vi.fn(original.rename), writeFile: vi.fn(original.writeFile), readFile: vi.fn(original.readFile), rm: vi.fn(original.rm) };
});

const sample = (name = "Original"): Project => ({
  ...createEmptyProject({ id: "p", name, fps: { num: 30, den: 1 }, width: 640, height: 360 }),
  assets: [{ id: "a", kind: "video", name: "video", mediaMode: "reference", sourcePath: "missing-original.mp4", contentHash: "a", durationFrames: 120, fps: { num: 60, den: 1 }, width: 640, height: 360, hasAudio: true, proxyPath: null }],
  tracks: [{ id: "t", kind: "video", order: 0, locked: false, muted: false,
    clips: [{ id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true }] }],
});

const invalidCases: { name: string; change: (project: Project) => void; code: string }[] = [
  { name: "missing asset", change: (p) => { p.tracks[0]!.clips[0]!.assetId = "missing"; }, code: "NOT_FOUND" },
  { name: "reversed range", change: (p) => { p.tracks[0]!.clips[0]!.sourceIn = 40; }, code: "INVALID_RANGE" },
  { name: "empty range", change: (p) => { p.tracks[0]!.clips[0]!.sourceOut = 0; }, code: "INVALID_RANGE" },
  { name: "out-of-bounds mixed-fps range", change: (p) => { p.tracks[0]!.clips[0]!.sourceOut = 61; }, code: "INVALID_RANGE" },
  { name: "duplicate asset", change: (p) => { p.assets.push({ ...p.assets[0]! }); }, code: "DUPLICATE_ID" },
  { name: "cross-kind ID", change: (p) => { p.tracks[0]!.id = "a"; }, code: "DUPLICATE_ID" },
  { name: "duplicate clip", change: (p) => { p.tracks[0]!.clips.push({ ...p.tracks[0]!.clips[0]!, timelineStart: 40 }); }, code: "DUPLICATE_ID" },
  { name: "duplicate track order", change: (p) => { p.tracks.push({ ...p.tracks[0]!, id: "t2", clips: [] }); }, code: "DUPLICATE_ORDER" },
  { name: "overlap", change: (p) => { p.tracks[0]!.clips.push({ ...p.tracks[0]!.clips[0]!, id: "c2", timelineStart: 20 }); }, code: "OVERLAP" },
  { name: "wrong track kind", change: (p) => { p.assets[0]!.kind = "audio"; }, code: "TRACK_KIND_MISMATCH" },
  { name: "invalid transform", change: (p) => { p.tracks[0]!.clips[0]!.transform = { x: 0, y: 0, scale: 1, opacity: 1 }; }, code: "INVALID_TRANSFORM" },
  { name: "dangling link", change: (p) => { p.tracks[0]!.clips[0]!.linkedClipId = "missing"; }, code: "NOT_FOUND" },
  { name: "self link", change: (p) => { p.tracks[0]!.clips[0]!.linkedClipId = "c"; }, code: "NOT_FOUND" },
];

describe("persistence integrity", () => {
  let tmp: string;
  let folder: string;
  beforeEach(async () => {
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(writeFile).mockReset().mockImplementation(original.writeFile);
    vi.mocked(rename).mockReset().mockImplementation(original.rename);
    vi.mocked(readFile).mockReset().mockImplementation(original.readFile);
    vi.mocked(rm).mockReset().mockImplementation(original.rm);
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-persistence-"));
    folder = path.join(tmp, "project");
    await createProjectFolder(folder, sample());
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmp, { recursive: true, force: true });
  });

  it.each(invalidCases)("rejects $name and recovers a validated backup", async ({ change, code }) => {
    const invalid = sample();
    change(invalid);
    expect(validateProject(invalid)).toMatchObject({ code });
    await writeFile(path.join(folder, PROJECT_FILE), JSON.stringify(invalid));
    await expect(readProject(folder)).rejects.toMatchObject({ code: "CORRUPT", message: expect.stringContaining(code) });
    await writeFile(path.join(folder, BACKUP_FILE), JSON.stringify(sample("Backup")));
    expect(await readProject(folder)).toMatchObject({ recoveredFromBackup: true, project: { name: "Backup" } });
  });

  it("accepts touching clips, unsorted storage order, locked tracks and missing original media", async () => {
    const valid = sample();
    valid.tracks[0]!.locked = true;
    valid.tracks[0]!.clips.unshift({ ...valid.tracks[0]!.clips[0]!, id: "c2", timelineStart: 30 });
    expect(validateProject(valid)).toBeNull();
    await writeProject(folder, valid);
    expect((await readProject(folder)).project).toEqual(valid);
  });

  it("rejects invalid writes without altering the main or backup", async () => {
    await writeProject(folder, sample("Second"));
    const before = await Promise.all([readFile(path.join(folder, PROJECT_FILE)), readFile(path.join(folder, BACKUP_FILE))]);
    const invalid = sample();
    invalid.tracks[0]!.clips[0]!.sourceOut = 0;
    await expect(writeProject(folder, invalid)).rejects.toMatchObject({ code: "CORRUPT" });
    expect(await Promise.all([readFile(path.join(folder, PROJECT_FILE)), readFile(path.join(folder, BACKUP_FILE))])).toEqual(before);
  });

  it("rejects an invalid backup as well as invalid main without changing the active session", async () => {
    const session = new ProjectSession(new RecentProjects(path.join(tmp, "recent.json")));
    await session.create({ folder: path.join(tmp, "active"), name: "Active", fps: { num: 30, den: 1 }, width: 640, height: 360 });
    const invalid = sample();
    invalid.tracks[0]!.clips[0]!.assetId = "missing";
    await writeFile(path.join(folder, PROJECT_FILE), JSON.stringify(invalid));
    await writeFile(path.join(folder, BACKUP_FILE), JSON.stringify(invalid));
    await expect(session.openFolder(folder)).rejects.toMatchObject({ code: "CORRUPT" });
    expect(session.open!.project.name).toBe("Active");
  });

  it("surfaces failed temporary-file cleanup with the save cause and owned path", async () => {
    vi.mocked(rename).mockRejectedValueOnce(new Error("Replacement denied"));
    vi.mocked(rm).mockRejectedValueOnce(new Error("Cleanup denied"));
    await expect(writeProject(folder, sample("New"))).rejects.toMatchObject({
      code: "SAVE_CLEANUP_FAILED", message: expect.stringContaining(folder),
      cause: expect.objectContaining({ message: "Replacement denied" }),
    });
    expect((await readProject(folder)).project.name).toBe("Original");
    expect((await readdir(folder)).filter((name) => name.endsWith(".tmp"))).toHaveLength(1);
  });

  it("checks whole atomic command batches for dangling linked clips", () => {
    const valid = sample();
    valid.tracks[0]!.clips.push({ ...valid.tracks[0]!.clips[0]!, id: "c2", timelineStart: 30, linkedClipId: "c" });
    expect(applyCommands(valid, [{ type: "RemoveClip", clipId: "c" }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(valid.tracks[0]!.clips).toHaveLength(2);
    expect(applyCommands(valid, [{ type: "RemoveClip", clipId: "c" }, { type: "RemoveClip", clipId: "c2" }])).toMatchObject({ ok: true });
  });

  it.each(["main write", "backup write", "backup replace", "main replace"] as const)("preserves usable data on %s failure", async (phase) => {
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    vi.mocked(writeFile).mockImplementation(async (file, data, options) => {
      const name = String(file);
      if ((phase === "main write" && name.includes(`${PROJECT_FILE}.`) && !name.includes(".bak.")) ||
          (phase === "backup write" && name.includes(`${BACKUP_FILE}.`))) throw new Error(`Injected ${phase}`);
      return original.writeFile(file, data, options);
    });
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if ((phase === "backup replace" && String(to).endsWith(BACKUP_FILE)) ||
          (phase === "main replace" && String(to).endsWith(PROJECT_FILE))) throw new Error(`Injected ${phase}`);
      return original.rename(from, to);
    });
    await expect(writeProject(folder, sample("New"))).rejects.toMatchObject({ code: "SAVE_FAILED" });
    expect((await readProject(folder)).project.name).toBe("Original");
    expect((await readdir(folder)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it.each(["corrupt", "missing"] as const)("preserves a recovered backup across failed and successful saves with %s main", async (state) => {
    await writeProject(folder, sample("Second"));
    const backup = await readFile(path.join(folder, BACKUP_FILE));
    if (state === "corrupt") await writeFile(path.join(folder, PROJECT_FILE), "{ corrupt");
    else await rm(path.join(folder, PROJECT_FILE));
    const session = new ProjectSession(new RecentProjects(path.join(tmp, "recent.json")));
    expect((await session.openFolder(folder)).recoveredFromBackup).toBe(true);
    vi.mocked(rename).mockRejectedValueOnce(new Error("Injected replacement failure"));
    await expect(session.save()).rejects.toMatchObject({ code: "SAVE_FAILED" });
    expect(session.open!.recoveredFromBackup).toBe(true);
    expect(await readFile(path.join(folder, BACKUP_FILE))).toEqual(backup);
    expect((await readProject(folder)).project.name).toBe("Original");
    await session.save();
    expect(session.open!.recoveredFromBackup).toBe(false);
    expect(await readFile(path.join(folder, BACKUP_FILE))).toEqual(backup);
    expect((await readProject(folder)).recoveredFromBackup).toBe(false);
  });

  it("does not adopt failed command saves and can retry the same edit", async () => {
    const session = new ProjectSession(new RecentProjects(path.join(tmp, "recent.json")));
    await session.openFolder(folder);
    vi.mocked(rename).mockRejectedValueOnce(new Error("Denied"));
    const command = { type: "RemoveClip" as const, clipId: "c" };
    await expect(session.apply([command])).rejects.toMatchObject({ code: "SAVE_FAILED" });
    expect(session.open!.project.tracks[0]!.clips).toHaveLength(1);
    expect((await readProject(folder)).project.tracks[0]!.clips).toHaveLength(1);
    expect(await session.apply([command])).toMatchObject({ ok: true });
  });

  it("does not treat a permission error as damaged or missing project data", async () => {
    const error = Object.assign(new Error("Denied"), { code: "EACCES" });
    vi.mocked(readFile).mockRejectedValueOnce(error);
    await expect(readProject(folder)).rejects.toMatchObject({ code: "STORE_IO_FAILED", cause: error });
  });

  it("returns actionable persistence codes through open/save routes", async () => {
    const headers = { "x-engine-token": "secret" };
    const app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }));
    try {
      expect((await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } })).statusCode).toBe(200);
      vi.mocked(rename).mockRejectedValueOnce(new Error("Synthetic disk failure"));
      const saved = await app.inject({ method: "POST", url: "/project/save", headers });
      expect(saved.statusCode).toBe(500);
      expect(saved.json().error).toMatchObject({ code: "SAVE_FAILED", message: expect.stringContaining("Synthetic disk failure") });
      const invalid = sample();
      invalid.tracks[0]!.clips[0]!.assetId = "absent";
      await writeFile(path.join(folder, PROJECT_FILE), JSON.stringify(invalid));
      await rm(path.join(folder, BACKUP_FILE), { force: true });
      const opened = await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
      expect(opened.statusCode).toBe(422);
      expect(opened.json().error).toMatchObject({ code: "CORRUPT", message: expect.stringContaining("absent") });
      expect((await app.inject({ url: "/project", headers })).json().project.tracks[0].clips[0].assetId).toBe("a");
    } finally { await app.close(); }
  });

  it("refuses creation over a backup-only project", async () => {
    await rename(path.join(folder, PROJECT_FILE), path.join(folder, BACKUP_FILE));
    await expect(createProjectFolder(folder, sample("Replacement"))).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
    expect((await readProject(folder)).project.name).toBe("Original");
  });

  it("reports backup-only recovery as available in recents", async () => {
    const recent = new RecentProjects(path.join(tmp, "recent.json"));
    await recent.add(folder, "Original");
    await rename(path.join(folder, PROJECT_FILE), path.join(folder, BACKUP_FILE));
    expect(await recent.list()).toMatchObject([{ exists: true }]);
    await writeFile(path.join(folder, BACKUP_FILE), "garbage");
    expect(await recent.list()).toMatchObject([{ exists: false }]);
  });

  it("reports unreadable recents instead of an empty list", async () => {
    const denied = Object.assign(new Error("Permission denied"), { code: "EACCES" });
    vi.mocked(readFile).mockRejectedValueOnce(denied);
    await expect(new RecentProjects(path.join(tmp, "recent.json")).list()).rejects.toMatchObject({ code: "RECENT_UNAVAILABLE", cause: denied });
  });

  it("preserves a recent index and removes its temporary file when replacement fails", async () => {
    const file = path.join(tmp, "recent.json");
    const recent = new RecentProjects(file);
    await recent.add(folder, "Original");
    const previous = await readFile(file);
    vi.mocked(rename).mockRejectedValueOnce(new Error("Index replacement denied"));
    await expect(recent.add(folder, "Changed")).rejects.toMatchObject({ code: "RECENT_UNAVAILABLE" });
    expect(await readFile(file)).toEqual(previous);
    expect((await readdir(tmp)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    await recent.add(folder, "Changed");
    expect(await recent.list()).toMatchObject([{ name: "Changed", exists: true }]);
  });

  it.each(["create", "open"] as const)("keeps %s successful when recent bookkeeping fails, including API warning", async (operation) => {
    const headers = { "x-engine-token": "secret" };
    const app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }));
    vi.spyOn(RecentProjects.prototype, "add").mockRejectedValue(new Error("Injected index denial"));
    const destination = operation === "open" ? folder : path.join(tmp, "new");
    try {
      const response = await app.inject({ method: "POST", url: `/project/${operation}`, headers,
        payload: operation === "open" ? { folder: destination } : { folder: destination, name: "Created", fps: { num: 30, den: 1 }, width: 640, height: 360 } });
      expect(response.statusCode).toBe(200);
      expect(response.json().warnings).toMatchObject([{ code: "RECENT_UPDATE_FAILED", message: expect.stringContaining("Injected index denial") }]);
      expect((await app.inject({ url: "/project", headers })).json().folder).toBe(destination);
      expect((await readProject(destination)).project.name).toBe(operation === "open" ? "Original" : "Created");
    } finally { await app.close(); }
  });

  it("reports damaged recents instead of returning an empty success and preserves the index", async () => {
    const index = path.join(tmp, "recent.json");
    await writeFile(index, "damaged");
    const recent = new RecentProjects(index);
    await expect(recent.add(folder, "Original")).rejects.toMatchObject({ code: "RECENT_INDEX_INVALID" });
    expect(await readFile(index, "utf8")).toBe("damaged");
    const app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: tmp }));
    try {
      const response = await app.inject({ url: "/projects/recent", headers: { "x-engine-token": "secret" } });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe("RECENT_INDEX_INVALID");
    } finally { await app.close(); }
  });
});
