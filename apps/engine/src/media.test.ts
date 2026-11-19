import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MediaError, interpretProbe, parseRational, probeFile } from "./media.js";
import { parseRange } from "./mediaRoutes.js";
import { ProxyManager, proxyArgs, type ProxyRunner } from "./proxy.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

if (!hasFfmpeg) {
  const msg = "ffmpeg/ffprobe not found on PATH: real-FFmpeg tests are SKIPPED (open a fresh terminal after installing FFmpeg).";
  if (process.env.CI) throw new Error(msg);
  console.warn(`\n[media.test] ${msg}\n`);
}

describe("probe interpretation", () => {
  const videoStream = { codec_type: "video", avg_frame_rate: "30000/1001", width: 1280, height: 720, duration: "2.002" };

  it("reduces rationals and rejects junk", () => {
    expect(parseRational("60000/2000")).toEqual({ num: 30, den: 1 });
    expect(parseRational("0/0")).toBeNull();
    expect(parseRational("abc")).toBeNull();
  });

  it("reads video facts and counts native frames", () => {
    const info = interpretProbe({ streams: [videoStream, { codec_type: "audio" }], format: { format_name: "mov,mp4" } });
    expect(info).toMatchObject({ kind: "video", durationFrames: 60, fps: { num: 30000, den: 1001 }, width: 1280, hasAudio: true });
  });

  it("treats audio-only files as a millisecond timebase", () => {
    const info = interpretProbe({ streams: [{ codec_type: "audio", duration: "1.5" }], format: { format_name: "mp3" } });
    expect(info).toMatchObject({ kind: "audio", durationFrames: 1500, fps: { num: 1000, den: 1 }, hasAudio: true });
  });

  it("recognizes still images with a five-second default duration", () => {
    expect(interpretProbe({ streams: [{ ...videoStream, duration: undefined }], format: { format_name: "png_pipe" } }))
      .toMatchObject({ kind: "image", durationSeconds: 5, fps: null, width: 1280, height: 720, hasAudio: false });
  });

  it("rejects empty files and missing video durations", () => {
    expect(() => interpretProbe({ streams: [] })).toThrow(MediaError);
    expect(() => interpretProbe({ streams: [{ ...videoStream, duration: undefined }], format: {} })).toThrow(MediaError);
  });
});

describe("parseRange", () => {
  it("handles absent, open-ended, suffix and invalid ranges", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=0-500", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=5-2", 100)).toBe("invalid");
    expect(parseRange("nonsense", 100)).toBe("invalid");
  });
});

describe("on-demand preview API", () => {
  let tmp: string;
  let app: FastifyInstance;
  const headers = { "x-engine-token": "secret" };
  beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), "ve-direct-")); });
  afterEach(async () => { await app?.close(); await rm(tmp, { recursive: true, force: true }); });

  it.each([false, true])("settles active cancel, deduplicates prepare and rejects stale completion (close=%s)", async (close) => {
    let release!: () => void;
    let aborted!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const abortSeen = new Promise<void>((resolve) => { aborted = resolve; });
    const runner = vi.fn<ProxyRunner>(async (input) => {
      if (runner.mock.calls.length === 1) {
        await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => { aborted(); resolve(); }, { once: true }));
        await released;
      }
      await writeFile(input.outFile, "owned output");
    });
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: tmp }), undefined, {
      probe: async () => ({ kind: "video", durationFrames: 60, durationSeconds: 2,
        fps: { num: 30, den: 1 }, width: 320, height: 180, hasAudio: false }),
      proxyRunner: runner,
    });
    const folder = path.join(tmp, "project"), source = path.join(tmp, "source.mp4");
    await writeFile(source, "owned original");
    const opened = (await app.inject({ method: "POST", url: "/project/create", headers, payload: {
      folder, name: "Cancellation", fps: { num: 30, den: 1 }, width: 320, height: 180,
    } })).json();
    const imported = (await app.inject({ method: "POST", url: "/project/import", headers,
      payload: { paths: [source], mode: "reference" } })).json();
    const assetId = imported.project.assets[0].id;
    const control = (action: "prepare" | "cancel") => app.inject({ method: "POST", url: "/project/preview-jobs", headers,
      payload: { assetId, action, expectedProject: { id: opened.project.id, folder } } });
    try {
      expect((await control("prepare")).statusCode).toBe(200);
      expect((await control("prepare")).statusCode).toBe(200);
      expect(runner).toHaveBeenCalledOnce();
      let settled = false;
      const cancelling = control("cancel").then((response) => { settled = true; return response; });
      await abortSeen;
      expect(settled).toBe(false);
      expect((await control("prepare")).statusCode).toBe(200);
      expect(runner).toHaveBeenCalledOnce();
      const closing = close ? app.inject({ method: "POST", url: "/project/close", headers }).then((response) => response) : null;
      if (closing) await vi.waitFor(async () => expect((await app.inject({ url: "/project", headers })).statusCode).toBe(404));
      release();
      expect((await cancelling).statusCode).toBe(close ? 409 : 200);
      if (closing) expect((await closing).statusCode).toBe(200);
      expect(await readdir(path.join(folder, "proxies"))).toEqual([]);
      expect(await readFile(source, "utf8")).toBe("owned original");
      if (!close) {
        const current = (await app.inject({ url: "/project", headers })).json().project;
        expect(current.assets).toEqual(imported.project.assets);
        expect(current.tracks).toEqual(imported.project.tracks);
        expect((await app.inject({ url: "/project/proxies", headers })).json().proxies[0].state).toBe("cancelled");
        await control("prepare");
        await vi.waitFor(async () => expect((await app.inject({ url: "/project/proxies", headers })).json().proxies[0].state).toBe("done"));
        expect(runner).toHaveBeenCalledTimes(2);
      }
    } finally { release(); }
  });

  it("registers three-hour silent footage without encoding, serves byte ranges and only prepares explicitly", async () => {
    const runner = vi.fn<ProxyRunner>(async (job) => { await writeFile(job.outFile, "owned proxy"); });
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: tmp }), undefined, {
      probe: async () => ({ kind: "video", durationFrames: 10800 * 30, durationSeconds: 10800,
        fps: { num: 30, den: 1 }, width: 3840, height: 2160, hasAudio: false }),
      proxyRunner: runner,
    });
    const folder = path.join(tmp, "project"), source = path.join(tmp, "silent.mp4");
    await writeFile(source, "owned silent video fixture");
    const opened = (await app.inject({ method: "POST", url: "/project/create", headers, payload: {
      folder, name: "Long", fps: { num: 30, den: 1 }, width: 3840, height: 2160,
    } })).json();
    const imported = (await app.inject({ method: "POST", url: "/project/import", headers,
      payload: { paths: [source], mode: "reference" } })).json();
    const assetId = imported.project.assets[0].id;
    expect(runner).not.toHaveBeenCalled();
    expect((await app.inject({ url: "/project/proxies", headers })).json().proxies).toEqual([]);
    const range = await app.inject({ url: `/media/${assetId}/source`, headers: { ...headers, range: "bytes=6-11" } });
    expect(range.statusCode).toBe(206);
    expect(range.headers["content-type"]).toBe("video/mp4");
    expect(range.body).toBe("silent");
    expect((await app.inject({ url: `/media/${assetId}/source` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/media/${assetId}/source`, headers: { ...headers, range: "bytes=999-" } })).statusCode).toBe(416);
    await app.inject({ method: "POST", url: "/project/close", headers });
    await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    expect(runner).not.toHaveBeenCalled();
    const payload = { assetId, action: "prepare", expectedProject: { id: opened.project.id, folder } };
    expect((await app.inject({ method: "POST", url: "/project/preview-jobs", headers,
      payload: { ...payload, expectedProject: { id: "wrong", folder } } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/project/preview-jobs", headers,
      payload: { ...payload, assetId: "missing" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/project/preview-jobs", payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/project/preview-jobs", headers, payload })).statusCode).toBe(200);
    await vi.waitFor(async () => expect((await app.inject({ url: "/project/proxies", headers })).json().proxies[0].state).toBe("done"));
    expect(runner).toHaveBeenCalledOnce();
    await app.inject({ method: "POST", url: "/project/preview-jobs", headers, payload });
    await app.inject({ method: "POST", url: "/project/preview-jobs", headers, payload: { ...payload, action: "cancel" } });
    expect(runner).toHaveBeenCalledOnce();
    expect(await readFile(source, "utf8")).toBe("owned silent video fixture");
    await app.inject({ method: "POST", url: "/project/close", headers });
    await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    expect(runner).toHaveBeenCalledOnce();
    expect((await app.inject({ url: "/project", headers })).json().project.assets[0].proxyPath).toBe(`proxies/${assetId}.mp4`);
    await rm(path.join(folder, `proxies/${assetId}.mp4`));
    await app.inject({ method: "POST", url: "/project/close", headers });
    await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    expect((await app.inject({ url: "/project", headers })).json().project.assets[0].proxyPath).toBeNull();
    expect(runner).toHaveBeenCalledOnce();
  });
});

describe("import diagnostics", () => {
  let tmp: string;
  let app: FastifyInstance;
  const headers = { "x-engine-token": "secret" };

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-import-diagnostic-"));
    app = await buildApp(
      loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }),
      undefined,
      { probe: async () => { throw new Error("private probe detail C:\\Private\\source.mp4"); } },
    );
  });
  afterEach(async () => {
    await app?.close();
    await rm(tmp, { recursive: true, force: true });
  });

  it("correlates unexpected per-file failures without exposing error details in diagnostics or the response", async () => {
    const source = path.join(tmp, "source.mp4");
    const folder = path.join(tmp, "project");
    await writeFile(source, "source");
    await app.inject({ method: "POST", url: "/project/create", headers,
      payload: { folder, name: "Import diagnostic", fps: { num: 30, den: 1 }, width: 1280, height: 720 } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await app.inject({ method: "POST", url: "/project/import", headers,
        payload: { paths: [source], mode: "reference" } });
      const failure = response.json().failed[0];
      expect(failure).toMatchObject({
        code: "IMPORT_FAILED",
        message: "The file could not be imported. Check engine diagnostics using the diagnostic ID.",
        diagnosticId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      });
      expect(log).toHaveBeenCalledOnce();
      const record = String(log.mock.calls[0]![0]);
      expect(JSON.parse(record)).toMatchObject({
        code: "IMPORT_FILE_FAILED",
        diagnosticId: failure.diagnosticId,
        route: "/project/import",
        causes: [{ name: "Error" }],
      });
      expect(record + JSON.stringify(failure)).not.toContain("C:\\Private");
      expect(record + JSON.stringify(failure)).not.toContain("private probe detail");
    } finally {
      log.mockRestore();
    }
  });
});

describe("import catalog outcomes", () => {
  let tmp: string;
  let app: FastifyInstance;
  const headers = { "x-engine-token": "secret" };
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-import-catalog-"));
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }), undefined, {
      probe: async (file) => {
        if (file.endsWith("denied.media")) throw Object.assign(new Error("private permissions"), { code: "EACCES" });
        if (file.endsWith("invalid.media")) throw new MediaError("PROBE_FAILED", "Unreadable media.");
        return { kind: "audio", durationFrames: 1000, durationSeconds: 1, fps: { num: 1000, den: 1 },
          width: null, height: null, hasAudio: true };
      },
    });
    await app.inject({ method: "POST", url: "/project/create", headers,
      payload: { folder: path.join(tmp, "project"), name: "Catalog", fps: { num: 30, den: 1 }, width: 640, height: 360 } });
  });
  afterEach(async () => { await app?.close(); await rm(tmp, { recursive: true, force: true }); });

  it("preserves partial copy success and distinguishes missing, directory, permission, duplicate and unreadable files", async () => {
    const source = path.join(tmp, "good.media");
    const denied = path.join(tmp, "denied.media");
    const invalid = path.join(tmp, "invalid.media");
    await writeFile(source, "source");
    await writeFile(denied, "denied");
    await writeFile(invalid, "invalid");
    const response = await app.inject({ method: "POST", url: "/project/import", headers,
      payload: { paths: [source, path.join(tmp, "missing.media"), tmp, denied, source, invalid], mode: "copy" } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.imported).toHaveLength(1);
    expect(body.project.assets).toHaveLength(1);
    expect(body.failed.map((failure: { code: string }) => failure.code)).toEqual([
      "FILE_NOT_FOUND", "INVALID_MEDIA_PATH", "FILE_ACCESS_DENIED", "ALREADY_IMPORTED", "PROBE_FAILED",
    ]);
    expect(JSON.stringify(body.failed)).not.toContain("private permissions");
    expect(await readdir(path.join(tmp, "project", "media"))).toEqual(["good.media"]);
    expect((await app.inject({ url: "/project", headers })).json().project.assets).toHaveLength(1);
  });
});

describe("ProxyManager", () => {
  let tmp: string;
  const managers: ProxyManager[] = [];
  const releases: (() => void)[] = [];
  beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), "ve-proxy-test-")); });
  afterEach(async () => {
    for (const release of releases.splice(0)) release();
    for (const manager of managers.splice(0)) {
      manager.reset();
      await manager.idle();
    }
    await rm(tmp, { recursive: true, force: true });
    await expect(stat(tmp)).rejects.toMatchObject({ code: "ENOENT" });
    vi.restoreAllMocks();
  });
  const job = (assetId: string, onDone = async () => {}) => ({
    assetId,
    source: "in.mp4",
    outFile: path.join(tmp, `${assetId}.mp4`),
    fps: { num: 30, den: 1 },
    durationSeconds: 1,
    hasAudio: false,
    onDone,
  });

  it("builds CFR 540p arguments", () => {
    const args = proxyArgs({ source: "a.mp4", fps: { num: 30000, den: 1001 }, hasAudio: false }, "out.mp4");
    expect(args).toContain("30000/1001");
    expect(args.join(" ")).toContain("min(540,ih)");
    expect(args).not.toContain("0:a:0");
  });

  it("runs jobs one at a time and reports failures", async () => {
    const order: string[] = [];
    const runner: ProxyRunner = async (input) => {
      order.push(input.assetId);
      if (input.assetId === "bad") throw new Error("boom");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(input.outFile, "x");
    };
    const manager = new ProxyManager("ffmpeg", runner);
    managers.push(manager);
    const events: string[] = [];
    manager.subscribe((s) => events.push(`${s.assetId}:${s.state}`));
    manager.enqueue(job("ok1"));
    manager.enqueue(job("bad"));
    await manager.idle();
    expect(order).toEqual(["ok1", "bad"]);
    expect(manager.list().find((s) => s.assetId === "bad")).toMatchObject({ state: "failed", message: "boom" });
    expect(events).toContain("ok1:done");
  });

  it("correlates a failed background proxy job without logging private error text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const manager = new ProxyManager("ffmpeg", async () => {
      throw new Error("decoder failed for C:\\Private\\source.mp4");
    });
    managers.push(manager);
    manager.enqueue(job("bad"));
    await manager.idle();
    const failed = manager.list().find((state) => state.assetId === "bad")!;
    expect(failed).toMatchObject({ state: "failed", diagnosticId: expect.stringMatching(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ) });
    expect(log).toHaveBeenCalledOnce();
    const record = String(log.mock.calls[0]![0]);
    expect(JSON.parse(record)).toMatchObject({
      code: "BACKGROUND_JOB_FAILED", diagnosticId: failed.diagnosticId, route: "proxy generation",
      causes: [{ name: "Error" }],
    });
    expect(record).not.toContain("C:\\Private\\source.mp4");
  });

  it("forgets everything on reset", async () => {
    const manager = new ProxyManager("ffmpeg", (input) => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    managers.push(manager);
    manager.enqueue(job("slow"));
    await new Promise((r) => setTimeout(r, 20));
    manager.reset();
    await manager.idle();
    expect(manager.list()).toEqual([]);
  });

  it("settles cancellation before retry, cleans late output and cancels queued jobs without starting them", async () => {
    let release!: () => void;
    let aborted!: () => void;
    const released = new Promise<void>((resolve) => { release = resolve; });
    releases.push(release);
    const abortSeen = new Promise<void>((resolve) => { aborted = resolve; });
    const runner = vi.fn<ProxyRunner>(async (input) => {
      if (runner.mock.calls.length === 1) {
        input.signal.addEventListener("abort", aborted, { once: true });
        await released;
        await writeFile(input.outFile, "late output");
        throw new Error("cancelled");
      }
      await writeFile(input.outFile, "complete");
    });
    const done = vi.fn(async () => undefined);
    const manager = new ProxyManager("ffmpeg", runner);
    managers.push(manager);
    manager.enqueue(job("active", done));
    manager.enqueue(job("queued"));
    await manager.cancel("queued");
    expect(manager.list().find((state) => state.assetId === "queued")?.state).toBe("cancelled");
    let settled = false;
    const cancel = manager.cancel("active").then(() => { settled = true; });
    await abortSeen;
    expect(settled).toBe(false);
    manager.enqueue(job("active", done));
    expect(runner).toHaveBeenCalledOnce();
    release();
    await cancel;
    expect(manager.list().find((state) => state.assetId === "active")?.state).toBe("cancelled");
    expect(done).not.toHaveBeenCalled();
    expect(await readdir(tmp)).toEqual([]);
    manager.enqueue(job("active", done));
    await manager.idle();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledOnce();
    expect(manager.list().find((state) => state.assetId === "active")?.state).toBe("done");
    await manager.cancel("active");
    expect(await readFile(job("active").outFile, "utf8")).toBe("complete");
  });

  it("does not cancel a proxy already at its metadata commit boundary", async () => {
    let release!: () => void;
    let entered!: () => void;
    const committing = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    releases.push(release);
    const manager = new ProxyManager("ffmpeg", async (input) => { await writeFile(input.outFile, "complete"); });
    managers.push(manager);
    manager.enqueue(job("commit", async () => { entered(); await released; }));
    await committing;
    const cancel = manager.cancel("commit");
    release();
    await cancel;
    expect(manager.list()[0]?.state).toBe("done");
    expect(await readFile(job("commit").outFile, "utf8")).toBe("complete");
  });

  it("reports cancellation cleanup failure instead of claiming cancelled", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const manager = new ProxyManager("ffmpeg", async (input) => {
      await mkdir(input.outFile);
      if (!input.signal.aborted) await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new Error("cancelled");
    });
    managers.push(manager);
    manager.enqueue(job("cleanup"));
    await manager.cancel("cleanup");
    expect(manager.list()[0]).toMatchObject({ state: "failed", message: expect.stringContaining("Proxy cleanup failed"),
      diagnosticId: expect.any(String) });
    expect(log).toHaveBeenCalled();
  });
});

describe.skipIf(!hasFfmpeg)("import and proxy (real FFmpeg)", () => {
  let tmp: string;
  let clip: string;
  let music: string;
  let still: string;
  let app: FastifyInstance;
  const headers = { "x-engine-token": "secret" };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-media-"));
    clip = path.join(tmp, "clip.mp4");
    music = path.join(tmp, "music.wav");
    still = path.join(tmp, "still.png");
    execFileSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip,
    ], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1", music], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x48", "-frames:v", "1", still], { stdio: "ignore" });
  });
  afterAll(async () => {
    if (tmp) {
      await rm(tmp, { recursive: true, force: true });
      await expect(stat(tmp)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  beforeEach(async () => {
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }));
  });
  afterEach(async () => app?.close());

  const create = (folder: string, extra: object = {}) =>
    app.inject({
      method: "POST",
      url: "/project/create",
      headers,
      payload: { folder, name: "M", fps: { num: 30, den: 1 }, width: 1280, height: 720, ...extra },
    });

  const waitForProxies = async () => {
    for (let i = 0; i < 200; i++) {
      const { proxies } = (await app.inject({ url: "/project/proxies", headers })).json();
      if (proxies.length > 0 && proxies.every((p: { state: string }) => p.state === "done" || p.state === "failed")) return proxies;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("proxy timed out");
  };
  const prepare = async () => {
    const opened = (await app.inject({ url: "/project", headers })).json();
    const response = await app.inject({ method: "POST", url: "/project/preview-jobs", headers,
      payload: { assetId: opened.project.assets[0].id, action: "prepare",
        expectedProject: { id: opened.project.id, folder: opened.folder } } });
    expect(response.statusCode).toBe(200);
  };

  it("probes a real file", async () => {
    const info = await probeFile("ffprobe", clip);
    expect(info).toMatchObject({ kind: "video", fps: { num: 25, den: 1 }, width: 640, height: 360, hasAudio: true });
    expect(info.durationFrames).toBeGreaterThanOrEqual(49);
  });

  it("imports by reference, explicitly builds a seekable proxy, and rejects duplicates", async () => {
    await create(path.join(tmp, "p1"));
    const res = await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [clip], mode: "reference" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toHaveLength(1);
    expect(body.project.assets[0]).toMatchObject({ mediaMode: "reference", sourcePath: clip, proxyPath: null });

    await prepare();
    const proxies = await waitForProxies();
    expect(proxies[0].state).toBe("done");
    const project = (await app.inject({ url: "/project", headers })).json().project;
    const asset = project.assets[0];
    expect(asset.proxyPath).toBe(`proxies/${asset.id}.mp4`);

    const full = await app.inject({ url: `/media/${asset.id}/proxy`, headers });
    expect(full.statusCode).toBe(200);
    const range = await app.inject({ url: `/media/${asset.id}/proxy`, headers: { ...headers, range: "bytes=0-99" } });
    expect(range.statusCode).toBe(206);
    expect(range.rawPayload.length).toBe(100);
    expect(range.headers["content-range"]).toMatch(/^bytes 0-99\//);
    const bad = await app.inject({ url: `/media/${asset.id}/proxy`, headers: { ...headers, range: "bytes=999999999-" } });
    expect(bad.statusCode).toBe(416);

    const again = await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [clip], mode: "reference" } });
    expect(again.json().imported).toHaveLength(0);
    expect(again.json().failed[0].message).toMatch(/already imported/);
  });

  it("copies into media/ and adopts the first video's frame rate when asked", async () => {
    const folder = path.join(tmp, "p2");
    await create(folder, { fpsFromFirstImport: true });
    const res = await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [clip], mode: "copy" } });
    const { project } = res.json();
    expect(project.settings.fps).toEqual({ num: 25, den: 1 });
    expect(project.assets[0].sourcePath).toBe("media/clip.mp4");
    expect((await stat(path.join(folder, "media", "clip.mp4"))).isFile()).toBe(true);
    await prepare();
    await waitForProxies();
  });

  it("imports a still image, assigns five seconds in project frames, and serves the source", async () => {
    await create(path.join(tmp, "p-image"));
    const response = await app.inject({
      method: "POST",
      url: "/project/import",
      headers,
      payload: { paths: [still], mode: "reference" },
    });
    const asset = response.json().project.assets[0];
    expect(asset).toMatchObject({ kind: "image", durationFrames: 150, fps: null, proxyPath: null });
    const source = await app.inject({ url: `/media/${asset.id}/source`, headers });
    expect(source.statusCode).toBe(200);
    expect(source.headers["content-type"]).toBe("image/png");
    expect(source.rawPayload.length).toBeGreaterThan(0);
    expect((await app.inject({ url: `/media/${asset.id}/proxy`, headers })).statusCode).toBe(404);
  });

  it("imports and range-serves audio sources for preview playback", async () => {
    await create(path.join(tmp, "p-audio"));
    const response = await app.inject({
      method: "POST",
      url: "/project/import",
      headers,
      payload: { paths: [music], mode: "reference" },
    });
    const asset = response.json().project.assets[0];
    expect(asset).toMatchObject({ kind: "audio", hasAudio: true, proxyPath: null });
    const source = await app.inject({ url: `/media/${asset.id}/source`, headers: { ...headers, range: "bytes=0-31" } });
    expect(source.statusCode).toBe(206);
    expect(source.headers["content-type"]).toBe("audio/wav");
    expect(source.rawPayload).toHaveLength(32);
  });

  it("reports unreadable files without failing the batch", async () => {
    await create(path.join(tmp, "p3"));
    const junk = path.join(tmp, "junk.mp4");
    await import("node:fs/promises").then((fs) => fs.writeFile(junk, "not media"));
    const res = await app.inject({
      method: "POST",
      url: "/project/import",
      headers,
      payload: { paths: [junk, path.join(tmp, "missing.mp4"), clip], mode: "reference" },
    });
    const body = res.json();
    expect(body.imported).toHaveLength(1);
    expect(body.failed).toHaveLength(2);
    await prepare();
    await waitForProxies();
  });

  it("clears missing proxies when reopened and regenerates only on request", async () => {
    const folder = path.join(tmp, "p4");
    await create(folder);
    await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [clip], mode: "reference" } });
    await prepare();
    await waitForProxies();
    const project = (await app.inject({ url: "/project", headers })).json().project;
    await rm(path.join(folder, project.assets[0].proxyPath));
    await app.inject({ method: "POST", url: "/project/close", headers });
    await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    expect((await app.inject({ url: "/project/proxies", headers })).json().proxies).toEqual([]);
    expect((await app.inject({ url: "/project", headers })).json().project.assets[0].proxyPath).toBeNull();
    await prepare();
    const proxies = await waitForProxies();
    expect(proxies[0].state).toBe("done");
    expect((await stat(path.join(folder, project.assets[0].proxyPath))).isFile()).toBe(true);
  });

  it("rejects import with no open project", async () => {
    const res = await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [clip], mode: "reference" } });
    expect(res.statusCode).toBe(409);
  });
});