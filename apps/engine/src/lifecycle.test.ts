import { link, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Command, CreateProjectRequest } from "@ve/schema";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Exporter, type ExportRunner } from "./exporter.js";
import { Importer } from "./importer.js";
import type { MediaInfo } from "./media.js";
import { ProxyManager } from "./proxy.js";
import { RecentProjects } from "./recent.js";
import { ProjectSession } from "./session.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, link: vi.fn(original.link) };
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("project-owned import and export lifecycle", () => {
  let tmp: string;
  let session: ProjectSession;
  let proxies: ProxyManager;
  let exporter: Exporter | undefined;
  let app: FastifyInstance | undefined;
  const gates: ReturnType<typeof deferred>[] = [];
  const config = loadConfig({});
  const fps = { num: 30, den: 1 };
  const audio: MediaInfo = { kind: "audio", durationSeconds: 1, durationFrames: 1000, fps: { num: 1000, den: 1 }, width: null, height: null, hasAudio: true };
  const video: MediaInfo = { kind: "video", durationSeconds: 1, durationFrames: 60, fps: { num: 60, den: 1 }, width: 640, height: 360, hasAudio: false };
  const gate = () => {
    const value = deferred();
    gates.push(value);
    return value;
  };
  const settings = (name: string): CreateProjectRequest => ({
    folder: path.join(tmp, name), name, fps, width: 640, height: 360, fpsFromFirstImport: false,
  });
  const create = (name: string) => session.create(settings(name));
  const source = async (name = "source.media", contents = "synthetic") => {
    const file = path.join(tmp, name);
    await writeFile(file, contents);
    return file;
  };
  const setupExport = async () => {
    const file = await source();
    const asset: Asset = { id: "a", name: "source", kind: "video", mediaMode: "reference", sourcePath: file, contentHash: "a", durationFrames: 30, fps, width: 640, height: 360, hasAudio: false, proxyPath: null };
    const commands: Command[] = [
      { type: "AddAsset", asset },
      { type: "AddTrack", track: { id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [] } },
      { type: "AddClip", trackId: "t", clip: { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true } },
    ];
    expect((await session.apply(commands)).ok).toBe(true);
  };
  const writeOutput: ExportRunner = async (job) => { await writeFile(job.args.at(-1)!, "output"); };
  const outputs = () => readdir(path.join(tmp, "A", "exports"));

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-lifecycle-"));
    session = new ProjectSession(new RecentProjects(path.join(tmp, "recent.json")));
    proxies = new ProxyManager("ffmpeg", async () => { throw new Error("No real rendering in import tests."); });
    exporter = undefined;
    app = undefined;
    await create("A");
  });
  afterEach(async () => {
    for (const value of gates.splice(0)) value.resolve();
    vi.restoreAllMocks();
    proxies.reset();
    exporter?.reset();
    await Promise.all([proxies.idle(), exporter?.settled()]);
    await app?.close();
    await rm(tmp, { recursive: true, force: true });
    await expect(stat(tmp)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["switch", "close", "reopen"] as const)("rejects import after project %s during probing", async (change) => {
    const entered = gate();
    const release = gate();
    const importer = new Importer(session, proxies, config, async () => {
      entered.resolve();
      await release.promise;
      return audio;
    });
    const pending = importer.importFiles({ paths: [await source()], mode: "copy" });
    const rejected = expect(pending).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
    await entered.promise;
    if (change === "switch") await create("B");
    else if (change === "close") await session.close();
    else await session.openFolder(path.join(tmp, "A"));
    release.resolve();
    await rejected;
    expect(session.open?.project.assets ?? []).toEqual([]);
    expect(await readdir(path.join(tmp, "A", "media"))).toEqual([]);
  });

  it("serializes duplicate imports and preserves a preexisting copy target", async () => {
    const file = await source();
    const sentinel = path.join(tmp, "A", "media", "source.media");
    await writeFile(sentinel, "unrelated preexisting file");
    const importer = new Importer(session, proxies, config, async () => audio);
    const results = await Promise.all([
      importer.importFiles({ paths: [file], mode: "copy" }),
      importer.importFiles({ paths: [file], mode: "copy" }),
    ]);
    expect(session.open!.project.assets).toHaveLength(1);
    expect(results[1]!.failed).toMatchObject([{ code: "UNSUPPORTED" }]);
    expect(await readFile(sentinel, "utf8")).toBe("unrelated preexisting file");
    expect(await readdir(path.dirname(sentinel))).toEqual(["source-1.media", "source.media"]);
  });

  it("cleans only owned copies when commit fails and accepts a subsequent retry", async () => {
    const file = await source();
    const sentinel = path.join(tmp, "A", "media", "source.media");
    await writeFile(sentinel, "keep");
    const importer = new Importer(session, proxies, config, async () => audio);
    const apply = vi.spyOn(session, "apply").mockRejectedValueOnce(new Error("Save failed."));
    await expect(importer.importFiles({ paths: [file], mode: "copy" })).rejects.toThrow("Save failed.");
    expect(await readdir(path.dirname(sentinel))).toEqual(["source.media"]);
    expect(session.open!.project.assets).toEqual([]);
    apply.mockRestore();
    expect((await importer.importFiles({ paths: [file], mode: "copy" })).imported).toHaveLength(1);
    expect(await readFile(sentinel, "utf8")).toBe("keep");
  });

  it("reports copied-media cleanup failure with a code, path and original cause", async () => {
    const importer = new Importer(session, proxies, config, async () => audio);
    const failure = new Error("Save failed.");
    vi.spyOn(session, "apply").mockImplementationOnce(async (commands) => {
      const batch = typeof commands === "function" ? commands(session.open!.project) : commands;
      const assetCommand = batch.find((command) => command.type === "AddAsset");
      if (!assetCommand || assetCommand.type !== "AddAsset") throw new Error("Missing test asset.");
      const target = path.join(tmp, "A", assetCommand.asset.sourcePath);
      await rm(target);
      await mkdir(target);
      await writeFile(path.join(target, "cleanup-denied-fixture"), "x");
      throw failure;
    });
    await expect(importer.importFiles({ paths: [await source()], mode: "copy" })).rejects.toMatchObject({
      code: "IMPORT_CLEANUP_FAILED", cause: failure, message: expect.stringContaining(path.join(tmp, "A", "media")),
    });
    expect(session.open!.project.assets).toEqual([]);
  });

  it("guards the queued commit after switching projects with copied files already prepared", async () => {
    const importer = new Importer(session, proxies, config, async () => audio);
    const apply = session.apply.bind(session);
    vi.spyOn(session, "apply").mockImplementationOnce(async (commands, version) => {
      await create("B");
      return apply(commands, version);
    });
    await expect(importer.importFiles({ paths: [await source()], mode: "copy" })).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
    expect(session.open!.project.assets).toEqual([]);
    expect(await readdir(path.join(tmp, "A", "media"))).toEqual([]);
  });

  it("matches the first video after audio-only import", async () => {
    await session.close();
    await session.create({ ...settings("match"), fpsFromFirstImport: true });
    const importer = new Importer(session, proxies, config, async (file) => file.endsWith("audio") ? audio : video);
    await importer.importFiles({ paths: [await source("audio", "audio")], mode: "reference" });
    await importer.importFiles({ paths: [await source("video", "video")], mode: "reference" });
    await proxies.idle();
    expect(session.open!.project.settings.fps).toEqual(video.fps);
  });

  it.each(["mixed", "concurrent", "reopen"] as const)("matches only the first video for %s imports", async (mode) => {
    await session.create({ ...settings("match"), fpsFromFirstImport: true });
    const importer = new Importer(session, proxies, config, async (file) => file.endsWith("audio") ? audio : video);
    const audioFile = await source("audio", "audio");
    const videoFile = await source("video", "video");
    if (mode === "mixed") await importer.importFiles({ paths: [audioFile, videoFile], mode: "reference" });
    else if (mode === "concurrent") await Promise.all([
      importer.importFiles({ paths: [audioFile], mode: "reference" }),
      importer.importFiles({ paths: [videoFile], mode: "reference" }),
    ]);
    else {
      await importer.importFiles({ paths: [audioFile], mode: "reference" });
      await session.openFolder(path.join(tmp, "match"));
      await importer.importFiles({ paths: [videoFile], mode: "reference" });
    }
    await proxies.idle();
    expect(session.open!.project.settings.fps).toEqual(video.fps);
    expect(session.open!.project.assets).toHaveLength(2);
  });

  it("plans fps adoption against the current timeline inside the session queue", async () => {
    await session.create({ ...settings("match"), fpsFromFirstImport: true });
    const audioFile = await source("audio", "audio");
    const importer = new Importer(session, proxies, config, async (file) => file.endsWith("audio") ? audio : video);
    await importer.importFiles({ paths: [audioFile], mode: "reference" });
    const apply = session.apply.bind(session);
    vi.spyOn(session, "apply").mockImplementationOnce(async (commands, version) => {
      expect((await apply([
        { type: "AddTrack", track: { id: "audio", kind: "audio", order: 0, muted: false, locked: false, clips: [] } },
        { type: "AddClip", trackId: "audio", clip: { id: "c", assetId: session.open!.project.assets[0]!.id, timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true } },
      ])).ok).toBe(true);
      return apply(commands, version);
    });
    await importer.importFiles({ paths: [await source("video", "video")], mode: "reference" });
    await proxies.idle();
    expect(session.open!.project.settings.fps).toEqual(fps);
  });

  it("rejects a proxy metadata callback from a prior opening of the same folder", async () => {
    proxies = new ProxyManager("ffmpeg", async (job) => {
      await writeFile(job.outFile, "proxy");
      await session.openFolder(path.join(tmp, "A"));
    });
    const importer = new Importer(session, proxies, config, async () => video);
    await importer.importFiles({ paths: [await source()], mode: "reference" });
    await proxies.idle();
    expect(session.open!.project.assets[0]!.proxyPath).toBeNull();
    expect(proxies.list()[0]).toMatchObject({ state: "failed", message: expect.stringContaining("project changed") });
    expect(await readdir(path.join(tmp, "A", "proxies"))).toEqual([]);
  });

  it("suppresses stale proxy completion and removes owned output on reset during its callback", async () => {
    const entered = gate();
    const release = gate();
    const output = path.join(tmp, "A", "proxies", "test.mp4");
    proxies = new ProxyManager("ffmpeg", async (job) => { await writeFile(job.outFile, "proxy"); });
    proxies.enqueue({
      assetId: "test", source: "unused", outFile: output, fps, hasAudio: false, durationSeconds: 1,
      onDone: async () => { entered.resolve(); await release.promise; },
    });
    await entered.promise;
    proxies.reset();
    release.resolve();
    await proxies.idle();
    expect(proxies.list()).toEqual([]);
    expect(await readdir(path.dirname(output))).toEqual([]);
  });

  it("reserves export before asynchronous validation", async () => {
    await setupExport();
    const release = gate();
    const runner = vi.fn(async () => { await release.promise; });
    exporter = new Exporter(session, config, runner, async () => 1);
    const first = exporter.start();
    await expect(exporter.start()).rejects.toMatchObject({ code: "EXPORT_BUSY" });
    await first;
    expect(runner).toHaveBeenCalledTimes(1);
    exporter.cancel();
    release.resolve();
    await exporter.settled();
    expect(exporter.state.state).toBe("cancelled");
    expect(await outputs()).toEqual([]);
  });

  it.each(["cancel", "reset"] as const)("does not start a runner after %s during preflight", async (action) => {
    await setupExport();
    const runner = vi.fn(writeOutput);
    exporter = new Exporter(session, config, runner, async () => 1);
    const start = exporter.start();
    if (action === "reset") exporter.reset();
    else exporter.cancel();
    await expect(start).rejects.toMatchObject({ code: "EXPORT_CANCELLED" });
    await exporter.settled();
    expect(runner).not.toHaveBeenCalled();
    expect(exporter.state.state).toBe(action === "reset" ? "idle" : "cancelled");
    expect(await outputs()).toEqual([]);
  });

  it.each(["cancel", "reset", "switch"] as const)("discards output on %s during duration verification and remains busy until settled", async (action) => {
    await setupExport();
    const entered = gate();
    const release = gate();
    exporter = new Exporter(session, config, writeOutput, async () => {
      entered.resolve();
      await release.promise;
      return 1;
    });
    await exporter.start();
    await entered.promise;
    if (action === "switch") await create("B");
    else if (action === "reset") exporter.reset();
    else exporter.cancel();
    await expect(exporter.start()).rejects.toMatchObject({ code: "EXPORT_BUSY" });
    release.resolve();
    await exporter.settled();
    expect(exporter.state.state).toBe(action === "reset" ? "idle" : action === "cancel" ? "cancelled" : "failed");
    expect(await outputs()).toEqual([]);
  });

  it("generates distinct output paths for repeated exports at the same time", async () => {
    await setupExport();
    exporter = new Exporter(session, config, writeOutput, async () => 1, () => new Date(2026, 9, 12, 10, 0, 0));
    await exporter.start();
    await exporter.settled();
    const first = exporter.state.outputPath!;
    await exporter.start();
    await exporter.settled();
    expect(exporter.state.state).toBe("done");
    expect(exporter.state.outputPath).not.toBe(first);
    expect(await outputs()).toHaveLength(2);
    expect(await readFile(first, "utf8")).toBe("output");
  });

  it("does not overwrite an occupied final output path", async () => {
    await setupExport();
    let occupied = "";
    exporter = new Exporter(session, config, async (job) => {
      occupied = job.args.at(-1)!.replace(/\.part$/, "");
      await writeFile(occupied, "existing output");
      await writeOutput(job);
    }, async () => 1);
    await exporter.start();
    await exporter.settled();
    expect(exporter.state.state).toBe("failed");
    expect(await readFile(occupied, "utf8")).toBe("existing output");
    expect(await outputs()).toHaveLength(1);
  });

  it("fails explicitly when exclusive output publication is unsupported", async () => {
    await setupExport();
    vi.mocked(link).mockRejectedValueOnce(new Error("Hard links are not supported on this filesystem."));
    exporter = new Exporter(session, config, writeOutput, async () => 1);
    await exporter.start();
    await exporter.settled();
    expect(exporter.state).toMatchObject({ state: "failed", code: "EXPORT_FAILED", message: expect.stringContaining("not supported") });
    expect(await outputs()).toEqual([]);
  });

  it("preserves a committed output when cancel is requested afterward", async () => {
    await setupExport();
    exporter = new Exporter(session, config, writeOutput, async () => 1);
    await exporter.start();
    await exporter.settled();
    const output = exporter.state.outputPath!;
    expect(exporter.cancel().state).toBe("done");
    expect(await readFile(output, "utf8")).toBe("output");
    expect(await outputs()).toHaveLength(1);
  });

  it.each(["cancel", "reset"] as const)("rolls back its own published output on %s during finalization", async (action) => {
    await setupExport();
    const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const entered = gate();
    const release = gate();
    vi.mocked(link).mockImplementationOnce(async (source, destination) => {
      await original.link(source, destination);
      entered.resolve();
      await release.promise;
    });
    exporter = new Exporter(session, config, writeOutput, async () => 1);
    await exporter.start();
    await entered.promise;
    if (action === "reset") exporter.reset();
    else exporter.cancel();
    release.resolve();
    await exporter.settled();
    expect(exporter.state.state).toBe(action === "reset" ? "idle" : "cancelled");
    expect(await outputs()).toEqual([]);
  });

  it("surfaces partial-output cleanup failure instead of leaving running status", async () => {
    await setupExport();
    exporter = new Exporter(session, config, async (job) => {
      await mkdir(job.args.at(-1)!);
      await writeFile(path.join(job.args.at(-1)!, "locked-fixture"), "x");
      throw new Error("Runner failed.");
    }, async () => 1);
    await exporter.start();
    await exporter.settled();
    expect(exporter.state).toMatchObject({ state: "failed", code: "EXPORT_CLEANUP_FAILED", message: expect.stringContaining("Cleanup failed") });
    expect(await outputs()).toHaveLength(1);
  });

  it.each(["proxy", "export"] as const)("waits for the %s writer to settle when the engine closes", async (kind) => {
    const entered = gate();
    const aborted = gate();
    const release = gate();
    const headers = { "x-engine-token": "test" };
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "test", ENGINE_DATA_DIR: path.join(tmp, "api-data") }), undefined, {
      probe: async () => video,
      proxyRunner: async (job) => {
        if (kind !== "proxy") throw new Error("Proxy not needed.");
        entered.resolve();
        job.signal.addEventListener("abort", aborted.resolve, { once: true });
        await release.promise;
        await writeFile(job.outFile, "late partial");
        throw new Error("Stopped.");
      },
      exportRunner: async (job) => {
        entered.resolve();
        job.signal.addEventListener("abort", aborted.resolve, { once: true });
        await release.promise;
        await writeFile(job.args.at(-1)!, "late partial");
        throw new Error("Stopped.");
      },
    });
    const folder = path.join(tmp, "API");
    expect((await app.inject({ method: "POST", url: "/project/create", headers, payload: { ...settings("API"), folder } })).statusCode).toBe(200);
    if (kind === "proxy") {
      expect((await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [await source()], mode: "reference" } })).statusCode).toBe(200);
    } else {
      await setupExport();
      const project = session.open!.project;
      expect((await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: [
        { type: "AddAsset", asset: project.assets[0] },
        { type: "AddTrack", track: { ...project.tracks[0], clips: [] } },
        { type: "AddClip", trackId: "t", clip: project.tracks[0]!.clips[0] },
      ] } })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/project/export", headers })).statusCode).toBe(202);
    }
    await entered.promise;
    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    await aborted.promise;
    expect(closed).toBe(false);
    release.resolve();
    await closing;
    expect(closed).toBe(true);
    expect(await readdir(path.join(folder, kind === "proxy" ? "proxies" : "exports"))).toEqual([]);
  });

  it("returns an actionable PROJECT_CHANGED conflict through the import API", async () => {
    const entered = gate();
    const release = gate();
    const headers = { "x-engine-token": "test" };
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "test", ENGINE_DATA_DIR: path.join(tmp, "api-data") }), undefined, {
      probe: async () => { entered.resolve(); await release.promise; return audio; },
    });
    expect((await app.inject({ method: "POST", url: "/project/create", headers, payload: settings("API") })).statusCode).toBe(200);
    const pending = app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [await source()], mode: "copy" } }).then((response) => response);
    await entered.promise;
    expect((await app.inject({ method: "POST", url: "/project/close", headers })).statusCode).toBe(200);
    release.resolve();
    const response = await pending;
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "PROJECT_CHANGED", message: expect.stringContaining("Retry") } });
    expect(await readdir(path.join(tmp, "API", "media"))).toEqual([]);
  });
});
