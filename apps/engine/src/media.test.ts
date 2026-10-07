import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

  it("rejects images, empty files and missing durations", () => {
    expect(() => interpretProbe({ streams: [videoStream], format: { format_name: "png_pipe" } })).toThrow(MediaError);
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

describe("ProxyManager", () => {
  const job = (assetId: string, onDone = async () => {}) => ({
    assetId,
    source: "in.mp4",
    outFile: path.join(os.tmpdir(), `${assetId}.mp4`),
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
    const events: string[] = [];
    manager.subscribe((s) => events.push(`${s.assetId}:${s.state}`));
    manager.enqueue(job("ok1"));
    manager.enqueue(job("bad"));
    await manager.idle();
    expect(order).toEqual(["ok1", "bad"]);
    expect(manager.list().find((s) => s.assetId === "bad")).toMatchObject({ state: "failed", message: "boom" });
    expect(events).toContain("ok1:done");
    await rm(path.join(os.tmpdir(), "ok1.mp4"), { force: true });
  });

  it("forgets everything on reset", async () => {
    const manager = new ProxyManager("ffmpeg", (input) => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    manager.enqueue(job("slow"));
    await new Promise((r) => setTimeout(r, 20));
    manager.reset();
    await manager.idle();
    expect(manager.list()).toEqual([]);
  });
});

describe.skipIf(!hasFfmpeg)("import and proxy (real FFmpeg)", () => {
  let tmp: string;
  let clip: string;
  let app: FastifyInstance;
  const headers = { "x-engine-token": "secret" };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-media-"));
    clip = path.join(tmp, "clip.mp4");
    execFileSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip,
    ], { stdio: "ignore" });
  });
  beforeEach(async () => {
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }));
  });
  afterEach(async () => app.close());

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

  it("probes a real file", async () => {
    const info = await probeFile("ffprobe", clip);
    expect(info).toMatchObject({ kind: "video", fps: { num: 25, den: 1 }, width: 640, height: 360, hasAudio: true });
    expect(info.durationFrames).toBeGreaterThanOrEqual(49);
  });

  it("imports by reference, builds a seekable proxy, and rejects duplicates", async () => {
    await create(path.join(tmp, "p1"));
    const res = await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [clip], mode: "reference" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imported).toHaveLength(1);
    expect(body.project.assets[0]).toMatchObject({ mediaMode: "reference", sourcePath: clip, proxyPath: null });

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
    await waitForProxies();
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
    await waitForProxies();
  });

  it("resumes missing proxies when a project is reopened", async () => {
    const folder = path.join(tmp, "p4");
    await create(folder);
    await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [clip], mode: "reference" } });
    await waitForProxies();
    const project = (await app.inject({ url: "/project", headers })).json().project;
    await rm(path.join(folder, project.assets[0].proxyPath));
    await app.inject({ method: "POST", url: "/project/close", headers });
    await app.inject({ method: "POST", url: "/project/open", headers, payload: { folder } });
    const proxies = await waitForProxies();
    expect(proxies[0].state).toBe("done");
    expect((await stat(path.join(folder, project.assets[0].proxyPath))).isFile()).toBe(true);
  });

  it("rejects import with no open project", async () => {
    const res = await app.inject({ method: "POST", url: "/project/import", headers, payload: { paths: [clip], mode: "reference" } });
    expect(res.statusCode).toBe(409);
  });
});