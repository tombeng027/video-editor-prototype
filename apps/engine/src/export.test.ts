import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { ANIMATION_CATALOG, animatedTransform, CANVAS_ASPECT_PRESETS, canvasSizeForAspect, clipCanvasRect, ClipAnimationsSchema, ClipZoomSchema, DEFAULT_EXPORT_SETTINGS, resolveExportSettings, type Asset, type Command, type OfflineAsset, type Project } from "@ve/schema";
import { applyCommands, buildRenderPlan, createEmptyProject, type RenderPlan } from "@ve/timeline-core";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { buildExportArgs, ExportPlanError, type ExportAsset } from "./exportArgs.js";
import { durationMatches, exportFileName, findOfflineAssets } from "./exporter.js";
import type { DurationProbe, ExportFileRemover, ExportRunner } from "./exporter.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const fps = { num: 30, den: 1 };
const asset = (id: string, sourcePath: string, over: Partial<Asset> = {}): Asset => ({
  id,
  kind: "video",
  name: `${id}.mp4`,
  mediaMode: "reference",
  sourcePath,
  contentHash: id,
  durationFrames: 90,
  fps,
  width: 640,
  height: 360,
  hasAudio: true,
  proxyPath: null,
  ...over,
});
const clipCmd = (id: string, assetId: string, timelineStart: number, sourceIn: number, sourceOut: number): Command => ({
  type: "AddClip",
  trackId: "t1",
  clip: { id, assetId, timelineStart, sourceIn, sourceOut, speed: 1, audioLinked: true },
});
const trackCmd: Command = { type: "AddTrack", track: { id: "t1", kind: "video", order: 0, muted: false, locked: false, clips: [] } };

describe("exportFileName and durationMatches", () => {
  it("makes a safe, stamped file name", () => {
    const name = exportFileName("My: Cool/Project?", new Date(2026, 9, 7, 9, 5, 3));
    expect(name).toBe("My_Cool_Project-20261007-090503.mp4");
    expect(exportFileName("???", new Date(2026, 0, 1, 0, 0, 0))).toBe("export-20260101-000000.mp4");
  });

  it("allows about two frames of drift and no more", () => {
    expect(durationMatches(2.02, 2, 1 / 30)).toBe(true);
    expect(durationMatches(2.5, 2, 1 / 30)).toBe(false);
    expect(durationMatches(1.0, 2, 1 / 30)).toBe(false);
  });
});

describe("buildExportArgs", () => {
  const plan = (project: Project): RenderPlan => buildRenderPlan(project);
  const base = createEmptyProject({ id: "p", name: "p", fps, width: 1281, height: 721 });
  const withTrack = (clips: { id: string; a: string; at: number; i: number; o: number }[]): Project => ({
    ...base,
    tracks: [
      {
        id: "t1",
        kind: "video",
        order: 0,
        muted: false,
        locked: false,
        clips: clips.map((c) => ({ id: c.id, assetId: c.a, timelineStart: c.at, sourceIn: c.i, sourceOut: c.o, speed: 1, audioLinked: true })),
      },
    ],
  });
  const assets = new Map([
    ["a", { path: "C:/media/a.mp4", hasAudio: true }],
    ["b", { path: "C:/media/b.mp4", hasAudio: false }],
  ]);

  it("trims each clip from the original, fills gaps and concatenates", () => {
    const args = buildExportArgs(plan(withTrack([{ id: "c1", a: "a", at: 0, i: 30, o: 60 }, { id: "c2", a: "b", at: 45, i: 0, o: 30 }])), assets, "out.mp4.part");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.filter((x) => x === "-i")).toHaveLength(2);
    expect(args).toContain("C:/media/a.mp4");
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "1.000000", "-t", "1.000000"]);
    expect(graph).toContain("color=c=black:s=1280x720");
    expect(graph).toContain("concat=n=3:v=1:a=1[vout][aout]");
    expect(graph).toContain("[0:a:0]");
    expect(graph).not.toContain("[1:a:0]");
    expect(args.at(-1)).toBe("out.mp4.part");
  });

  it("rejects an unknown asset", () => {
    expect(() => buildExportArgs(plan(withTrack([{ id: "c1", a: "zzz", at: 0, i: 0, o: 30 }])), assets, "o")).toThrow(ExportPlanError);
  });

  it("mixes the sound of every stacked visual clip and skips clips on muted tracks", () => {
    const project = withTrack([{ id: "base", a: "a", at: 0, i: 0, o: 30 }]);
    project.tracks.push({ id: "over", kind: "overlay", order: 1, muted: false, locked: false, clips: [
      { id: "top", assetId: "a", timelineStart: 0, sourceIn: 30, sourceOut: 60, speed: 1, audioLinked: true },
    ] });
    const graphOf = (p: Project) => { const args = buildExportArgs(plan(p), assets, "o.mp4"); return args[args.indexOf("-filter_complex") + 1]!; };
    const both = graphOf(project);
    expect(both).toContain("[0:a:0]");
    expect(both).toContain("[1:a:0]");
    expect(both).toContain("amix=inputs=2:duration=first:dropout_transition=0:normalize=0");

    project.tracks[1]!.muted = true;
    const topMuted = graphOf(project);
    expect(topMuted).toContain("[0:a:0]");
    expect(topMuted).not.toContain("[1:a:0]");
    project.tracks[0]!.muted = true;
    const allMuted = graphOf(project);
    expect(allMuted).not.toContain(":a:0]");
    expect(allMuted).toContain("anullsrc");
  });

  it("silences a video clip whose audio was split and mixes the audio-track copy instead", () => {
    const project = withTrack([{ id: "c1", a: "a", at: 0, i: 30, o: 60 }]);
    project.tracks[0]!.clips[0]!.audioLinked = false;
    project.tracks.push({ id: "music", kind: "audio", order: 1, muted: false, locked: false, clips: [
      { id: "split", assetId: "a", timelineStart: 0, sourceIn: 30, sourceOut: 60, speed: 1, audioLinked: true },
    ] });
    const args = buildExportArgs(plan(project), assets, "out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.filter((x) => x === "-i")).toHaveLength(2);
    expect(graph).not.toContain("[0:a:0]");
    expect(graph).toContain("anullsrc");
    expect(graph).toContain("[1:a:0]");
    expect(graph).toContain("amix=inputs=2");
  });

  it("applies clip volume to visual-clip sound and audio-track clips only when below 100%", () => {
    const project = withTrack([{ id: "c1", a: "a", at: 0, i: 0, o: 30 }]);
    project.tracks[0]!.clips[0]!.volume = 0.5;
    project.tracks.push({ id: "music", kind: "audio", order: 1, muted: false, locked: false, clips: [
      { id: "bgm", assetId: "a", timelineStart: 0, sourceIn: 30, sourceOut: 60, speed: 1, audioLinked: true, volume: 0.2 },
      { id: "full", assetId: "a", timelineStart: 30, sourceIn: 30, sourceOut: 60, speed: 1, audioLinked: true },
    ] });
    const args = buildExportArgs(plan(project), assets, "out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toMatch(/\[0:a:0\]asetpts=PTS-STARTPTS,volume=0\.5,/);
    expect(graph).toMatch(/\[1:a:0\]asetpts=PTS-STARTPTS,volume=0\.2,/);
    expect(graph).toMatch(/\[2:a:0\]asetpts=PTS-STARTPTS,aresample/);
  });

  it("converts only the final composition, retaining project time mapping and selected quality", () => {
    const project = withTrack([{ id: "c", a: "a", at: 0, i: 30, o: 60 }]);
    const before = structuredClone(project);
    const settings = resolveExportSettings(project.settings, {
      ...DEFAULT_EXPORT_SETTINGS, frameRate: "59.94", resolution: "720p", quality: "high",
    });
    const args = buildExportArgs(plan(project), assets, "out.mp4", settings);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("trim=end_frame=30");
    expect(graph).toContain("[vout]scale=1280:720,setsar=1,");
    expect(graph).toContain("fps=60000/1001,trim=end_frame=60");
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "1.000000", "-t", "1.000000"]);
    expect(args[args.indexOf("-crf") + 1]).toBe("18");
    expect(args[args.indexOf("-r") + 1]).toBe("60000/1001");
    expect(project).toEqual(before);
  });

  it("exports static fitted scale, normalized center and alpha on each transformed layer", () => {
    const project = withTrack([{ id: "c1", a: "a", at: 0, i: 30, o: 60 }]);
    project.tracks[0]!.clips[0]!.transform = { x: 0.75, y: 0.25, scale: 0.5, opacity: 0.25 };
    const args = buildExportArgs(plan(project), assets, "out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("scale=640:360,colorchannelmixer=aa=0.25");
    expect(graph).toContain("overlay=x=960-overlay_w/2:y=180-overlay_h/2");
    expect(graph).toContain("trim=end_frame=30");
    expect(args).toContain("C:/media/a.mp4");
  });

  it.each([0.25, 0.5, 1.33, 2, 4])("retimes original input duration, video timestamps and pitch-preserving audio at %sx", (speed) => {
    const project = withTrack([{ id: "c", a: "a", at: 0, i: 30, o: 150 }]);
    project.tracks[0]!.clips[0]!.speed = speed;
    const args = buildExportArgs(plan(project), assets, "out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual([
      "-ss", "1.000000", "-t", (Math.round(120 / speed) * speed / 30).toFixed(6),
    ]);
    expect(graph).toContain(`setpts=(PTS-STARTPTS)/${speed}`);
    expect(graph).toContain(speed < 0.5 ? "atempo=0.5,atempo=0.5" : speed > 2 ? "atempo=2,atempo=2" : `atempo=${speed}`);
  });

  it("does not read beyond source Out when speed rounds duration up to a whole project frame", () => {
    const project = withTrack([{ id: "c", a: "a", at: 0, i: 30, o: 93 }]);
    project.tracks[0]!.clips[0]!.speed = 4;
    const args = buildExportArgs(plan(project), assets, "out.mp4");
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "1.000000", "-t", "2.100000"]);
  });
  it("loops and mixes audio-track clips at their timeline offsets", () => {
    const project = withTrack([{ id: "c1", a: "a", at: 0, i: 0, o: 60 }]);
    project.assets.push({
      id: "music", kind: "audio", name: "music.wav", mediaMode: "reference", sourcePath: "C:/media/music.wav",
      contentHash: "music", durationFrames: 2000, fps: { num: 1000, den: 1 }, width: null, height: null,
      hasAudio: true, proxyPath: null,
    });
    project.tracks.push({
      id: "audio-track", kind: "audio", order: 1, muted: false, locked: false,
      clips: [{ id: "music-clip", assetId: "music", timelineStart: 30, sourceIn: 0, sourceOut: 120, speed: 1, audioLinked: true }],
    });
    const args = buildExportArgs(plan(project), new Map<string, ExportAsset>([
      ...assets,
      ["music", { path: "C:/media/music.wav", hasAudio: true, durationFrames: 60 }],
    ]), "out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(args).toContain("-stream_loop");
    expect(args).toContain("-1");
    expect(args).toContain("C:/media/music.wav");
    expect(graph).toContain("adelay=1000:all=1");
    expect(graph).toContain("amix=inputs=2:duration=first");
    expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 4)).toEqual([
      "-map", "[vout]", "-map", "[mixedAudio]",
    ]);
  });

  it("refuses timelines that would exceed the command-line limit", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, a: "a", at: i * 2, i: 0, o: 1 }));
    expect(() => buildExportArgs(plan(withTrack(many)), assets, "o")).toThrow(/more than the prototype exporter/);
  });
});

describe("export routes (fake FFmpeg)", () => {
  let tmp: string;
  let app: FastifyInstance;
  let folder: string;
  let source: string;
  const headers = { "x-engine-token": "secret" };
  let runner: ExportRunner;
  let removeExportFile: ExportFileRemover;
  let offlineAssetsFinder: ((folder: string, project: Project) => Promise<OfflineAsset[]>) | undefined;
  let probed = 3;
  let probedOutput: Awaited<ReturnType<DurationProbe>>;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-export-"));
    source = path.join(tmp, "src.mp4");
    await writeFile(source, "x");
  });
  afterAll(async () => {
    if (tmp) {
      await rm(tmp, { recursive: true, force: true });
      await expect(stat(tmp)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  beforeEach(async () => {
    probed = 3;
    probedOutput = { durationSeconds: 3, width: 1280, height: 720, fps, videoCodec: "h264", audioCodec: "aac" };
    removeExportFile = rm;
    offlineAssetsFinder = undefined;
    runner = async (input) => {
      input.onProgress(0.5);
      await writeFile(input.args.at(-1)!, "fake");
    };
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }), undefined, {
      exportRunner: (i) => runner(i),
      probeDuration: async () => ({ ...probedOutput, durationSeconds: probed }),
      exportFileRemover: (file, options) => removeExportFile(file, options),
      offlineAssetsFinder: (projectFolder, project) =>
        offlineAssetsFinder ? offlineAssetsFinder(projectFolder, project) : findOfflineAssets(projectFolder, project),
    });
    folder = path.join(tmp, `p-${Math.random().toString(36).slice(2)}`);
    await app.inject({
      method: "POST",
      url: "/project/create",
      headers,
      payload: { folder, name: "Demo", fps, width: 1280, height: 720 },
    });
  });
  afterEach(async () => app?.close());

  const commands = (cmds: Command[]) => app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: cmds } });
  const start = () => app.inject({ method: "POST", url: "/project/export", headers });
  const state = async () => (await app.inject({ url: "/project/export", headers })).json();
  const settle = async () => {
    for (let i = 0; i < 100; i++) {
      const s = await state();
      if (s.state !== "running") return s;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("export did not settle");
  };
  const setup = async (path_: string = source) => {
    const res = await commands([{ type: "AddAsset", asset: asset("a", path_) }, trackCmd, clipCmd("c1", "a", 0, 0, 90)]);
    expect(res.statusCode).toBe(200);
  };

  it("refuses an empty timeline", async () => {
    const res = await start();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("EMPTY_TIMELINE");
  });

  it("rejects invalid export settings before rendering or changing status or project", async () => {
    await setup();
    const before = (await app.inject({ url: "/project", headers })).json();
    const run = vi.fn(runner);
    runner = run;
    for (const settings of [{ frameRate: "120" }, { codec: "hevc" }, { resolution: "8k" }, { quality: "invalid" }, null]) {
      const response = await app.inject({ method: "POST", url: "/project/export", headers, payload: { settings } });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_EXPORT_SETTINGS");
    }
    expect(run).not.toHaveBeenCalled();
    expect(await state()).toEqual({ state: "idle", percent: 0 });
    expect((await app.inject({ url: "/project", headers })).json()).toEqual(before);
  });

  it("freezes resolved settings across progress, busy inspection and cancellation", async () => {
    await setup();
    runner = (input) => {
      input.onProgress(0.5);
      return new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    const attemptId = "00000000-0000-4000-8000-000000000011";
    const settings = { ...DEFAULT_EXPORT_SETTINGS, frameRate: "60", resolution: "1080p", quality: "high" } as const;
    const expected = resolveExportSettings({ width: 1280, height: 720, fps }, settings);
    const response = await app.inject({ method: "POST", url: "/project/export", headers, payload: { attemptId, settings } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ attemptId, settings: expected });
    expect(await state()).toMatchObject({ attemptId, settings: expected, percent: 50 });
    expect((await start()).statusCode).toBe(409);
    expect(await state()).toMatchObject({ attemptId, settings: expected });
    await app.inject({ method: "POST", url: "/project/export/cancel", headers });
    expect(await settle()).toMatchObject({ attemptId, settings: expected, state: "cancelled" });
  });

  it.each(["codec", "dimensions", "rate"] as const)("discards output with mismatched %s before publication", async (mismatch) => {
    await setup();
    if (mismatch === "codec") probedOutput.videoCodec = "hevc";
    if (mismatch === "dimensions") probedOutput.width = 640;
    if (mismatch === "rate") probedOutput.fps = { num: 60, den: 1 };
    await start();
    expect(await settle()).toMatchObject({ state: "failed", code: "EXPORT_SETTINGS_MISMATCH", diagnosticId: expect.any(String) });
    expect(await readdir(path.join(folder, "exports"))).toEqual([]);
  });

  it("validates attempt IDs and retains correlation through progress and cancellation", async () => {
    await setup();
    const invalid = await app.inject({ method: "POST", url: "/project/export", headers, payload: { attemptId: "invalid" } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVALID_REQUEST");
    expect(await state()).toEqual({ state: "idle", percent: 0 });
    const attemptId = "00000000-0000-4000-8000-000000000001";
    runner = (input) => {
      input.onProgress(0.5);
      return new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    const res = await app.inject({ method: "POST", url: "/project/export", headers, payload: { attemptId } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ state: "running", attemptId });
    expect(await state()).toMatchObject({ state: "running", percent: 50, attemptId });
    const busy = await app.inject({ method: "POST", url: "/project/export", headers,
      payload: { attemptId: "00000000-0000-4000-8000-000000000002" } });
    expect(busy.statusCode).toBe(409);
    expect((await state()).attemptId).toBe(attemptId);
    await app.inject({ method: "POST", url: "/project/export/cancel", headers });
    expect(await settle()).toMatchObject({ state: "cancelled", attemptId });
  });

  it("retains attempt correlation through successful completion and validation failure", async () => {
    await setup();
    const attemptId = "00000000-0000-4000-8000-000000000001";
    await app.inject({ method: "POST", url: "/project/export", headers, payload: { attemptId } });
    expect(await settle()).toMatchObject({ state: "done", attemptId });
    const failedId = "00000000-0000-4000-8000-000000000002";
    await commands([{ type: "AddAsset", asset: asset("missing", path.join(tmp, "gone.mp4")) },
      clipCmd("missing-clip", "missing", 90, 0, 30)]);
    const rejected = await app.inject({ method: "POST", url: "/project/export", headers, payload: { attemptId: failedId } });
    expect(rejected.statusCode).toBe(422);
    expect(await settle()).toMatchObject({ state: "failed", attemptId: failedId });
    await app.inject({ method: "POST", url: "/project/close", headers });
    expect(await state()).toEqual({ state: "idle", percent: 0 });
  });

  it("correlates export cleanup failures without logging private paths or error messages", async () => {
    await setup();
    probed = 100;
    removeExportFile = async () => {
      throw Object.assign(new Error("private path C:\\Private\\output.part"), { code: "EACCES", path: "C:\\Private\\output.part" });
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await start();
      const failed = await settle();
      expect(failed).toMatchObject({
        state: "failed",
        code: "EXPORT_CLEANUP_FAILED",
        diagnosticId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      });
      expect(failed.message).toBe("Export cleanup failed. Check engine diagnostics using the diagnostic ID.");
      expect(log).toHaveBeenCalledOnce();
      const record = String(log.mock.calls[0]![0]);
      expect(JSON.parse(record)).toMatchObject({
        code: "BACKGROUND_JOB_FAILED",
        diagnosticId: failed.diagnosticId,
        route: "export cleanup",
        causes: [{ name: "Error", ioCode: "EACCES" }],
      });
      expect(record + JSON.stringify(failed)).not.toContain("C:\\Private");
      expect(record + JSON.stringify(failed)).not.toContain("private path");
    } finally {
      log.mockRestore();
    }
  });

  it("refuses to export media that went missing and names the file", async () => {
    await setup(path.join(tmp, "gone.mp4"));
    const res = await start();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("OFFLINE_MEDIA");
    expect(res.json().error.message).toContain("a.mp4");
  });

  it("reports offline assets (K7)", async () => {
    await commands([{ type: "AddAsset", asset: asset("a", source) }, { type: "AddAsset", asset: asset("m", path.join(tmp, "gone.mp4")) }]);
    const res = await app.inject({ url: "/project/media-status", headers });
    expect(res.json().projectId).toBe((await app.inject({ url: "/project", headers })).json().project.id);
    expect(res.json().offline).toEqual([{ assetId: "m", name: "m.mp4", path: path.join(tmp, "gone.mp4") }]);
  });

  it("rejects a media snapshot if project contents change during the filesystem scan", async () => {
    await setup();
    let resolveScan!: (offline: OfflineAsset[]) => void;
    let scanStarted!: () => void;
    const started = new Promise<void>((resolve) => { scanStarted = resolve; });
    offlineAssetsFinder = async () => {
      scanStarted();
      return new Promise((resolve) => { resolveScan = resolve; });
    };
    const pending = app.inject({ url: "/project/media-status", headers });
    await started;
    const changed = await commands([{ type: "AddAsset", asset: asset("b", source) }]);
    expect(changed.statusCode).toBe(200);
    resolveScan([]);
    const response = await pending;
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PROJECT_CHANGED");
  });

  it("exports to exports/ and finishes done", async () => {
    await setup();
    const res = await start();
    expect(res.statusCode).toBe(202);
    const done = await settle();
    expect(done.state).toBe("done");
    expect(done.outputPath).toMatch(/exports[\\/]Demo-\d{8}-\d{6}-[a-f0-9-]+\.mp4$/);
    expect((await stat(done.outputPath)).isFile()).toBe(true);
    expect((await readdir(path.join(folder, "exports"))).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("discards a file whose duration does not match the timeline", async () => {
    await setup();
    probed = 10;
    await start();
    const failed = await settle();
    expect(failed.state).toBe("failed");
    expect(failed.code).toBe("EXPORT_DURATION_MISMATCH");
    expect(failed.diagnosticId).toBeDefined();
    expect(failed.message).toMatch(/discarded/);
    expect(await readdir(path.join(folder, "exports"))).toEqual([]);
  });

  it("reports a runner failure and removes the partial file", async () => {
    await setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    runner = async (input) => {
      await writeFile(input.args.at(-1)!, "partial");
      throw new Error("encoder exploded for C:\\Private\\source.mp4");
    };
    try {
      await start();
      const failed = await settle();
      expect(failed).toMatchObject({
        state: "failed",
        message: "encoder exploded for C:\\Private\\source.mp4",
        diagnosticId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
      });
      expect(log).toHaveBeenCalledOnce();
      const record = String(log.mock.calls[0]![0]);
      expect(JSON.parse(record)).toMatchObject({
        code: "BACKGROUND_JOB_FAILED",
        diagnosticId: failed.diagnosticId,
        route: "/project/export",
        causes: [{ name: "Error" }],
      });
      expect(record).not.toContain("C:\\Private");
      expect(await readdir(path.join(folder, "exports"))).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it("cancels a running export and rejects a second start while busy", async () => {
    await setup();
    runner = (input) => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect((await start()).statusCode).toBe(202);
    const busy = await start();
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe("EXPORT_BUSY");
    await app.inject({ method: "POST", url: "/project/export/cancel", headers });
    expect((await settle()).state).toBe("cancelled");
    await mkdir(path.join(folder, "exports"), { recursive: true });
    expect(await readdir(path.join(folder, "exports"))).toEqual([]);
  });

  it("forgets the result when the project is closed", async () => {
    await setup();
    await start();
    await settle();
    await app.inject({ method: "POST", url: "/project/close", headers });
    expect(await state()).toEqual({ state: "idle", percent: 0 });
  });
});

describe.skipIf(!hasFfmpeg)("export (real FFmpeg)", () => {
  let tmp: string;
  let app: FastifyInstance;
  const headers = { "x-engine-token": "secret" };

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-export-real-"));
  });
  afterAll(async () => {
    if (tmp) {
      await rm(tmp, { recursive: true, force: true });
      await expect(stat(tmp)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  afterEach(async () => app?.close());

  const ffprobe = (file: string, entries: string) =>
    execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0", file]).toString().trim();

  it("trims asymmetric odd-pixel sources in place with shared canvas bounds through zoom and fade", async () => {
    const sourceWidth = 101, sourceHeight = 61;
    const pixels = Buffer.alloc(sourceWidth * sourceHeight * 3);
    for (let y = 0; y < sourceHeight; y++) {
      for (let x = 0; x < sourceWidth; x++) {
        const color = y < 7 || y >= 54 ? [255, 255, 255] : x < 37 ? [255, 0, 0] : x >= 89 ? [0, 255, 0] : [0, 0, 255];
        pixels.set(color, (y * sourceWidth + x) * 3);
      }
    }
    const ppm = path.join(tmp, "crop-pattern.ppm"), image = path.join(tmp, "crop-pattern.png"), video = path.join(tmp, "crop-pattern.mp4");
    await writeFile(ppm, Buffer.concat([Buffer.from(`P6\n${sourceWidth} ${sourceHeight}\n255\n`), pixels]));
    execFileSync("ffmpeg", ["-y", "-i", ppm, "-frames:v", "1", image], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-loop", "1", "-i", image, "-t", "1", "-r", "30",
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "0", video], { stdio: "ignore" });
    const crop = { left: 0.37, right: 0.11, top: 0.13, bottom: 0.09 };
    const transform = { x: 0.62, y: 0.5, scale: 0.6, opacity: 1 };
    const zoom = ClipZoomSchema.parse({ version: 1, startPercent: 0, endPercent: 100, startScale: 1, endScale: 1.25 });
    const animations = ClipAnimationsSchema.parse({ entrance: { id: "entrance.fade", version: 1, durationFrames: 15 } });
    for (const kind of ["image", "video"] as const) {
      for (const [width, height] of [[160, 120], [120, 160]] as const) {
        const project = createEmptyProject({ id: "crop", name: "Crop", fps, width, height });
        project.assets = [asset("source", kind === "image" ? image : video, {
          kind, fps: kind === "image" ? null : fps, width: sourceWidth, height: sourceHeight, durationFrames: 30, hasAudio: false,
        })];
        project.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
          { id: "c", assetId: "source", timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true,
            crop, transform, zoom, animations },
        ] }];
        const output = path.join(tmp, `crop-${kind}-${width}.mp4`);
        execFileSync("ffmpeg", buildExportArgs(buildRenderPlan(project), new Map<string, ExportAsset>([
          ["source", { path: kind === "image" ? image : video, kind, hasAudio: false }],
        ]), output), { stdio: "pipe" });
        expect(ffprobe(output, "stream=width,height,nb_read_frames")).toBe(`${width},${height},30`);
        const frames = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
          { maxBuffer: width * height * 3 * 31 });
        for (const frame of [0, 14, 29]) {
          const current = animatedTransform(animations, 30, frame, transform, zoom);
          const rect = clipCanvasRect(current, project.settings, project.assets[0], crop);
          const pixel = (x: number, y: number) => {
            const at = ((frame * height + Math.round(y)) * width + Math.round(x)) * 3;
            return Array.from(frames.subarray(at, at + 3));
          };
          const center = pixel(current.x * width, current.y * height);
          if (frame === 0) { expect(Math.max(...center)).toBeLessThan(20); continue; }
          const left = rect.left * width, right = (rect.left + rect.width) * width;
          const top = rect.top * height, bottom = (rect.top + rect.height) * height;
          for (const [x, y] of [[left + 4, current.y * height], [right - 4, current.y * height],
            [current.x * width, top + 4], [current.x * width, bottom - 4]]) {
            const color = pixel(x!, y!);
            expect(color[2]).toBeGreaterThan(180);
            expect(color[0]).toBeLessThan(60);
            expect(color[1]).toBeLessThan(60);
          }
          for (const [x, y] of [[left - 4, current.y * height], [right + 4, current.y * height],
            [current.x * width, top - 4], [current.x * width, bottom + 4]]) {
            expect(Math.max(...pixel(x!, y!))).toBeLessThan(20);
          }
        }
      }
    }
  }, 20000);

  it("keeps retained source landmarks in the same exported pixels before and after cropping", async () => {
    const source = path.join(tmp, "crop-landmark.png");
    const background = path.join(tmp, "crop-background.png");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i",
      "color=c=blue:s=100x60,drawbox=x=40:y=20:w=10:h=10:color=yellow:t=fill",
      "-frames:v", "1", source], { stdio: "pipe" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=100x80", "-frames:v", "1", background], { stdio: "pipe" });
    const project = createEmptyProject({ id: "landmark", name: "Landmark", fps, width: 200, height: 160 });
    project.assets = [asset("source", source, { kind: "image", fps: null, width: 100, height: 60, hasAudio: false }),
      asset("background", background, { kind: "image", fps: null, width: 100, height: 80, hasAudio: false })];
    project.tracks = [{ id: "back", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "back", assetId: "background", timelineStart: 0, sourceIn: 0, sourceOut: 3, speed: 1, audioLinked: true,
    }] }, { id: "t", kind: "overlay", order: 1, muted: false, locked: false, clips: [{
      id: "c", assetId: "source", timelineStart: 0, sourceIn: 0, sourceOut: 3, speed: 1, audioLinked: true,
      transform: { x: 0.6, y: 0.5, scale: 0.8, opacity: 1 },
    }] }];
    const landmarks: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    for (const cropped of [false, true]) {
      if (cropped) project.tracks[1]!.clips[0]!.crop = { left: 0.3, top: 0.1, right: 0.1, bottom: 0.2 };
      const output = path.join(tmp, `landmark-${cropped}.mp4`);
      execFileSync("ffmpeg", buildExportArgs(buildRenderPlan(project), new Map([
        ["source", { path: source, kind: "image" as const, hasAudio: false }],
        ["background", { path: background, kind: "image" as const, hasAudio: false }],
      ]), output),
        { stdio: "pipe" });
      const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
      const xs: number[] = [], ys: number[] = [];
      for (let y = 0; y < 160; y++) for (let x = 0; x < 200; x++) {
        const i = (y * 200 + x) * 3;
        if (pixels[i]! > 180 && pixels[i + 1]! > 180 && pixels[i + 2]! < 60) { xs.push(x); ys.push(y); }
      }
      expect(xs.length).toBeGreaterThan(50);
      landmarks.push({ left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) });
      const removed = (80 * 200 + 60) * 3;
      expect(pixels[removed + (cropped ? 0 : 2)]).toBeGreaterThan(180);
      expect(pixels[removed + (cropped ? 2 : 0)]).toBeLessThan(40);
    }
    expect(landmarks[1]).toEqual(landmarks[0]);
  });

  it("renders all project canvas aspect presets with matching output dimensions and fitted media", () => {
    const source = path.join(tmp, "canvas-aspect-red.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x36:r=30:d=0.1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source], { stdio: "ignore" });
    const project = createEmptyProject({ id: "aspect", name: "Aspect", fps, width: 64, height: 36 });
    project.assets = [asset("red", source, { width: 64, height: 36, durationFrames: 3, hasAudio: false })];
    project.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "red", timelineStart: 0, sourceIn: 0, sourceOut: 3, speed: 1, audioLinked: true },
    ] }];
    const assets = new Map<string, ExportAsset>([["red", { path: source, hasAudio: false }]]);
    for (const [index, preset] of CANVAS_ASPECT_PRESETS.entries()) {
      const size = canvasSizeForAspect(project.settings, preset);
      const result = applyCommands(project, [{ type: "SetProjectCanvas", ...size }]);
      if (!result.ok) throw new Error(result.error.message);
      const output = path.join(tmp, `canvas-aspect-${index}.mp4`);
      execFileSync("ffmpeg", buildExportArgs(buildRenderPlan(result.project), assets, output), { stdio: "pipe" });
      expect(ffprobe(output, "stream=width,height,nb_read_frames")).toBe(`${size.width},${size.height},3`);
      const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
      const center = (Math.floor(size.height / 2) * size.width + Math.floor(size.width / 2)) * 3;
      expect(pixels[center]).toBeGreaterThan(220);
      expect(pixels[center + 2]).toBeLessThan(20);
      if (preset.label !== "16:9") expect(Math.max(...pixels.subarray(0, 3))).toBeLessThan(20);
    }
  }, 15000);

  it("renders all animation presets with shared endpoints and smooth motion across segment cuts", () => {
    const source = path.join(tmp, "animation-red.mp4");
    const still = path.join(tmp, "animation-red.png");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=30:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-i", source, "-frames:v", "1", still], { stdio: "ignore" });
    const p = createEmptyProject({ id: "animation", name: "Animation", fps, width: 64, height: 64 });
    const base = { x: 0.55, y: 0.45, scale: 0.75, opacity: 0.8 };
    const entrances = ANIMATION_CATALOG.filter((item) => item.phase === "entrance");
    const exits = ANIMATION_CATALOG.filter((item) => item.phase === "exit");
    const pairs = [...entrances.map((item, index) => [item, exits[index]!] as const),
      [entrances[1]!, exits[0]!] as const, [entrances[0]!, exits[1]!] as const];
    for (const [index, [entrance, exit]] of pairs.entries()) {
      const animations = ClipAnimationsSchema.parse({
        entrance: { id: entrance.id, version: 1, durationFrames: 15 },
        exit: { id: exit.id, version: 1, durationFrames: 15 },
      });
      p.tracks = [
        { id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
          { id: "c", assetId: "red", timelineStart: 0, sourceIn: 0, sourceOut: index >= 5 ? 90 : 45, speed: index >= 5 ? 2 : 1, audioLinked: true, transform: base, animations },
        ] },
        { id: "top", kind: "overlay", order: 1, muted: false, locked: false, clips: [
          { id: "cut", assetId: "red", timelineStart: 7, sourceIn: 0, sourceOut: 7, speed: 1, audioLinked: true,
            transform: { x: 0.5, y: 0.5, scale: 1, opacity: 0 } },
        ] },
      ];
      const output = path.join(tmp, `animation-${index}.mp4`);
      const settings = resolveExportSettings(p.settings, { ...DEFAULT_EXPORT_SETTINGS,
        ...(index === 6 ? { frameRate: "60", resolution: "720p" } : {}) });
      const image = index < 5 && index % 2 !== 0;
      execFileSync("ffmpeg", buildExportArgs(buildRenderPlan(p), new Map([["red", {
        path: image ? still : source, kind: image ? "image" : "video", hasAudio: false,
      }]]), output, settings), { stdio: "pipe" });
      expect(ffprobe(output, "stream=width,height,nb_read_frames")).toBe(index === 6 ? "1280,1280,90" : "64,64,45");
      const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-vf", "fps=30,scale=64:64", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
        { maxBuffer: 2 * 1024 * 1024 });
      for (const frame of [0, 3, 7, 10, 14, 15, 29, 30, 34, 37, 41, 44]) {
        const transform = animatedTransform(animations, 45, frame, base);
        const size = Math.round(64 * transform.scale);
        const left = 64 * transform.x - size / 2;
        const top = 64 * transform.y - size / 2;
        let lit = 0;
        let red = 0;
        const bytes = pixels.subarray(frame * 64 * 64 * 3, (frame + 1) * 64 * 64 * 3);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          const value = bytes[(y * 64 + x) * 3]!;
          const inside = x >= left + 3 && x < left + size - 3 && y >= top + 3 && y < top + size - 3;
          if (inside) { red += value; lit++; }
          const outside = x < left - 3 || x >= left + size + 3 || y < top - 3 || y >= top + size + 3;
          if (outside) expect(value, `${entrance.id} frame ${frame} outside`).toBeLessThan(25);
        }
        if (lit) expect(Math.abs(red / lit - 255 * transform.opacity), `${entrance.id} frame ${frame} opacity`).toBeLessThan(20);
      }
    }
  }, 30_000);

  it("renders a two-point zoom matching preview math, combined with animations and across segment cuts", () => {
    const source = path.join(tmp, "zoom-red.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=30:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", source], { stdio: "ignore" });
    const p = createEmptyProject({ id: "zoom", name: "Zoom", fps, width: 64, height: 64 });
    const base = { x: 0.5, y: 0.5, scale: 0.4, opacity: 1 };
    const zoom = ClipZoomSchema.parse({ version: 1, startPercent: 20, endPercent: 80, startScale: 1, endScale: 1.75 });
    const animations = ClipAnimationsSchema.parse({ exit: { id: "exit.fade", version: 1, durationPercent: 20 } });
    p.tracks = [
      { id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
        { id: "c", assetId: "red", timelineStart: 0, sourceIn: 0, sourceOut: 45, speed: 1, audioLinked: true, transform: base, animations, zoom },
      ] },
      { id: "top", kind: "overlay", order: 1, muted: false, locked: false, clips: [
        { id: "cut", assetId: "red", timelineStart: 20, sourceIn: 0, sourceOut: 5, speed: 1, audioLinked: true,
          transform: { x: 0.5, y: 0.5, scale: 1, opacity: 0 } },
      ] },
    ];
    const output = path.join(tmp, "zoom.mp4");
    execFileSync("ffmpeg", buildExportArgs(buildRenderPlan(p), new Map([["red", { path: source, kind: "video", hasAudio: false }]]),
      output, resolveExportSettings(p.settings, DEFAULT_EXPORT_SETTINGS)), { stdio: "pipe" });
    expect(ffprobe(output, "stream=width,height,nb_read_frames")).toBe("64,64,45");
    const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
      { maxBuffer: 2 * 1024 * 1024 });
    for (const frame of [0, 8, 12, 18, 22, 27, 30, 36, 40, 44]) {
      const transform = animatedTransform(animations, 45, frame, base, zoom);
      const size = Math.round(64 * transform.scale);
      const left = 32 - size / 2;
      let lit = 0;
      let red = 0;
      const bytes = pixels.subarray(frame * 64 * 64 * 3, (frame + 1) * 64 * 64 * 3);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const value = bytes[(y * 64 + x) * 3]!;
        if (x >= left + 3 && x < left + size - 3 && y >= left + 3 && y < left + size - 3) { red += value; lit++; }
        if (x < left - 3 || x >= left + size + 3 || y < left - 3 || y >= left + size + 3) {
          expect(value, `zoom frame ${frame} outside`).toBeLessThan(25);
        }
      }
      if (lit) expect(Math.abs(red / lit - 255 * transform.opacity), `zoom frame ${frame} opacity`).toBeLessThan(20);
    }
    expect(animatedTransform(animations, 45, 44, base, zoom).scale).toBeCloseTo(0.7);
  }, 30_000);

  it("exports selected output settings with verified rates, dimensions, frames and unchanged timeline timing", async () => {
    const source = path.join(tmp, "settings-source.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=96x64:r=30:d=1",
      "-f", "lavfi", "-i", "color=c=blue:s=96x64:r=30:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source], { stdio: "ignore" });
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "settings-data") }));
    const folder = path.join(tmp, "settings-project");
    await app.inject({ method: "POST", url: "/project/create", headers,
      payload: { folder, name: "Settings", fps, width: 96, height: 64 } });
    const sourceAsset = asset("a", source, { durationFrames: 60, width: 96, height: 64 });
    const commands: Command[] = [
      { type: "AddAsset", asset: sourceAsset }, trackCmd, clipCmd("c1", "a", 0, 0, 15),
      { type: "AddClip", trackId: "t1", clip: { id: "c2", assetId: "a", timelineStart: 20, sourceIn: 30, sourceOut: 60, speed: 2, audioLinked: true } },
      { type: "AddTrack", track: { id: "overlay", kind: "overlay", order: 1, muted: false, locked: false, clips: [] } },
      { type: "AddClip", trackId: "overlay", clip: { id: "top", assetId: "a", timelineStart: 5, sourceIn: 30, sourceOut: 40, speed: 1, audioLinked: true,
        transform: { x: 0.75, y: 0.5, scale: 0.5, opacity: 1 } } },
      { type: "AddTrack", track: { id: "audio", kind: "audio", order: 2, muted: false, locked: false, clips: [] } },
      { type: "AddClip", trackId: "audio", clip: { id: "music", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 45, speed: 1, audioLinked: true } },
    ];
    expect((await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands } })).statusCode).toBe(200);
    const before = (await app.inject({ url: "/project", headers })).json();
    for (const [frameRate, resolution, quality] of [
      ["60", "720p", "smaller"], ["59.94", "project", "high"], ["24", "project", "standard"],
    ] as const) {
      const settings = { ...DEFAULT_EXPORT_SETTINGS, frameRate, resolution, quality };
      const expected = resolveExportSettings(before.project.settings, settings);
      const started = await app.inject({ method: "POST", url: "/project/export", headers, payload: { settings } });
      expect(started.statusCode).toBe(202);
      let result = started.json();
      for (let i = 0; i < 300 && result.state === "running"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        result = (await app.inject({ url: "/project/export", headers })).json();
      }
      expect(result).toMatchObject({ state: "done", settings: expected });
      const file = result.outputPath;
      const metadata = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames",
        "-show_streams", "-show_format", "-of", "json", file]).toString());
      const video = metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
      const audio = metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
      expect(video).toMatchObject({
        codec_name: "h264", width: expected.width, height: expected.height,
        avg_frame_rate: `${expected.fps.num}/${expected.fps.den}`,
        nb_read_frames: String(Math.round(1.5 * expected.fps.num / expected.fps.den)),
      });
      expect(audio).toMatchObject({ codec_name: "aac", channels: 2 });
      expect(Number(video.duration)).toBeCloseTo(1.5, 1);
      expect(Number(audio.duration)).toBeCloseTo(1.5, 1);
      for (const [time, color] of [["0.1", "red"], ["0.55", "black"], ["0.8", "blue"], ["1.3", "black"]] as const) {
        const pixel = execFileSync("ffmpeg", ["-v", "error", "-ss", time, "-i", file, "-frames:v", "1",
          "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
        if (color === "red") { expect(pixel[0]).toBeGreaterThan(220); expect(pixel[2]).toBeLessThan(20); }
        else if (color === "blue") { expect(pixel[2]).toBeGreaterThan(220); expect(pixel[0]).toBeLessThan(20); }
        else expect(Math.max(...pixel)).toBeLessThan(20);
      }
      const samples = execFileSync("ffmpeg", ["-v", "error", "-ss", "1.25", "-i", file, "-t", "0.1",
        "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"]);
      expect(samples.some((byte) => byte !== 0)).toBe(true);
      expect((await app.inject({ url: "/project", headers })).json()).toEqual(before);
    }
    expect((await readdir(path.join(folder, "exports"))).every((file) => file.endsWith(".mp4"))).toBe(true);
  }, 60_000);

  it("exports clip speed with correct frames, source colors and preserved audio pitch, including looped audio", () => {
    const source = path.join(tmp, "speed-source.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=30:d=1",
      "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=30:d=1",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source], { stdio: "ignore" });
    const project = createEmptyProject({ id: "speed", name: "Speed", fps, width: 64, height: 64 });
    project.assets = [asset("source", source, { durationFrames: 60, width: 64, height: 64 })];
    project.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "source", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true },
    ] }];
    const checkPitch = (file: string) => {
      const samples = execFileSync("ffmpeg", ["-v", "error", "-ss", "0.1", "-i", file, "-t", "0.2",
        "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"]);
      let crossings = 0;
      for (let i = 4; i < samples.length; i += 4) {
        if (samples.readFloatLE(i - 4) <= 0 && samples.readFloatLE(i) > 0) crossings++;
      }
      const hz = crossings / (samples.length / 4 / 48000);
      expect(hz).toBeGreaterThan(420);
      expect(hz).toBeLessThan(460);
    };
    for (const speed of [0.25, 0.5, 1.33, 2, 4]) {
      project.tracks[0]!.clips[0]!.speed = speed;
      const output = path.join(tmp, `speed-${speed}.mp4`);
      const plan = buildRenderPlan(project);
      execFileSync("ffmpeg", buildExportArgs(plan, new Map([["source", { path: source, hasAudio: true }]]), output), { stdio: "pipe" });
      expect(Number(ffprobe(output, "stream=nb_read_frames"))).toBe(Math.round(60 / speed));
      for (const [sourceTime, channel] of [[0.4, 0], [1.4, 2]] as const) {
        const pixel = execFileSync("ffmpeg", ["-v", "error", "-ss", String(sourceTime / speed), "-i", output,
          "-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
        expect(pixel[channel]).toBeGreaterThan(200);
        expect(pixel[channel === 0 ? 2 : 0]).toBeLessThan(40);
      }
      checkPitch(output);
    }
    project.tracks[0]!.kind = "audio";
    project.tracks[0]!.clips[0] = { ...project.tracks[0]!.clips[0]!, sourceIn: 30, sourceOut: 150, speed: 2 };
    const audioOutput = path.join(tmp, "speed-looped-audio.mp4");
    execFileSync("ffmpeg", buildExportArgs(buildRenderPlan(project),
      new Map([["source", { path: source, hasAudio: true, durationFrames: 60 }]]), audioOutput), { stdio: "pipe" });
    expect(Number(ffprobe(audioOutput, "stream=nb_read_frames"))).toBe(60);
    checkPitch(audioOutput);
  }, 30000);

  it("renders scaled, positioned translucent visual clips and crops zoomed media to the canvas", () => {
    const red = path.join(tmp, "transform-red.mp4"), blue = path.join(tmp, "transform-blue.png");
    const blueVideo = path.join(tmp, "transform-blue.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=0.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", red], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=80x80", "-frames:v", "1", blue], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=80x80:r=30:d=0.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", blueVideo], { stdio: "ignore" });
    const project = createEmptyProject({ id: "transform", name: "Transform", fps, width: 320, height: 180 });
    project.tracks = [
      { id: "base", kind: "video", order: 0, muted: false, locked: false, clips: [
        { id: "red", assetId: "red", timelineStart: 0, sourceIn: 0, sourceOut: 15, speed: 1, audioLinked: true },
      ] },
      { id: "top", kind: "overlay", order: 1, muted: false, locked: false, clips: [
        { id: "blue", assetId: "blue", timelineStart: 0, sourceIn: 0, sourceOut: 15, speed: 1, audioLinked: true,
          transform: { x: 0.75, y: 0.5, scale: 0.5, opacity: 0.5 } },
      ] },
    ];
    const assets = new Map<string, ExportAsset>([["red", { path: red, hasAudio: false }], ["blue", { path: blue, kind: "image", hasAudio: false }]]);
    for (const [kind, zoom] of [["image", 0.5], ["image", 2], ["video", 0.5], ["video", 2]] as const) {
      assets.set("blue", { path: kind === "image" ? blue : blueVideo, kind, hasAudio: false });
      project.tracks[1]!.clips[0]!.transform!.scale = zoom;
      const output = path.join(tmp, `transform-${kind}-${zoom}.mp4`);
      execFileSync("ffmpeg", buildExportArgs(buildRenderPlan(project), assets, output), { stdio: "pipe" });
      expect(ffprobe(output, "stream=width,height,nb_read_frames")).toBe("320,180,15");
      const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
      const pixel = (x: number, y: number) => Array.from(pixels.subarray((y * 320 + x) * 3, (y * 320 + x) * 3 + 3));
      const mixed = pixel(240, 90);
      expect(mixed[0]).toBeGreaterThan(100); expect(mixed[0]).toBeLessThan(160);
      expect(mixed[2]).toBeGreaterThan(100); expect(mixed[2]).toBeLessThan(160);
      const left = pixel(20, 90);
      expect(left[0]).toBeGreaterThan(220); expect(left[2]).toBeLessThan(20);
      if (zoom === 0.5) expect(pixel(240, 20)[2]).toBeLessThan(20);
      else expect(pixel(300, 20)[2]).toBeGreaterThan(100);
    }
  }, 20_000);

  it("places a non-square picture exactly where the shared canvas geometry says it is", () => {
    const blue = path.join(tmp, "parity-blue.png"), red = path.join(tmp, "parity-red.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=0.5",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", red], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=80x80", "-frames:v", "1", blue], { stdio: "ignore" });
    const transform = { x: 0.75, y: 0.5, scale: 0.5, opacity: 1 };
    const project = createEmptyProject({ id: "parity", name: "Parity", fps, width: 320, height: 180 });
    project.tracks = [
      { id: "base", kind: "video", order: 0, muted: false, locked: false, clips: [
        { id: "red", assetId: "red", timelineStart: 0, sourceIn: 0, sourceOut: 15, speed: 1, audioLinked: true },
      ] },
      { id: "top", kind: "overlay", order: 1, muted: false, locked: false, clips: [
        { id: "blue", assetId: "blue", timelineStart: 0, sourceIn: 0, sourceOut: 15, speed: 1, audioLinked: true, transform },
      ] },
    ];
    const output = path.join(tmp, "parity.mp4");
    execFileSync("ffmpeg", buildExportArgs(buildRenderPlan(project), new Map<string, ExportAsset>([
      ["red", { path: red, hasAudio: false }], ["blue", { path: blue, kind: "image", hasAudio: false }]]), output), { stdio: "pipe" });
    const pixels = execFileSync("ffmpeg", ["-v", "error", "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    const isBlue = (x: number, y: number) => {
      const at = (Math.round(y) * 320 + Math.round(x)) * 3;
      return pixels[at + 2]! > 180 && pixels[at]! < 60;
    };
    const rect = clipCanvasRect(transform, { width: 320, height: 180 }, { width: 80, height: 80 });
    const [left, right, top, bottom] = [rect.left * 320, (rect.left + rect.width) * 320, rect.top * 180, (rect.top + rect.height) * 180];
    const midX = (left + right) / 2, midY = (top + bottom) / 2;
    for (const [x, y] of [[left + 4, midY], [right - 4, midY], [midX, top + 4], [midX, bottom - 4]] as const) expect(isBlue(x, y)).toBe(true);
    for (const [x, y] of [[left - 4, midY], [right + 4, midY], [midX, top - 4], [midX, bottom + 4]] as const) expect(isBlue(x, y)).toBe(false);
  }, 20_000);

  it("renders split clips, a gap and a clip without audio to the exact frame count", async () => {
    const withAudio = path.join(tmp, "a.mp4");
    const silent = path.join(tmp, "b.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", withAudio], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent], { stdio: "ignore" });

    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }));
    const folder = path.join(tmp, "proj");
    await app.inject({ method: "POST", url: "/project/create", headers, payload: { folder, name: "Real", fps, width: 640, height: 360 } });
    const cmds: Command[] = [
      { type: "AddAsset", asset: asset("a", withAudio, { durationFrames: 90 }) },
      { type: "AddAsset", asset: asset("b", silent, { durationFrames: 50, fps: { num: 25, den: 1 }, width: 320, height: 240, hasAudio: false }) },
      trackCmd,
      clipCmd("c1", "a", 0, 0, 30),
      clipCmd("c2", "a", 30, 60, 90),
      clipCmd("c3", "b", 75, 0, 30),
    ];
    expect((await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands: cmds } })).statusCode).toBe(200);

    expect((await app.inject({ method: "POST", url: "/project/export", headers })).statusCode).toBe(202);
    let result = { state: "running" } as { state: string; outputPath?: string; message?: string };
    for (let i = 0; i < 600 && result.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      result = (await app.inject({ url: "/project/export", headers })).json();
    }
    expect(result.message).toBeUndefined();
    expect(result.state).toBe("done");

    const file = result.outputPath!;
    // 30 + 30 frames of A, a 15-frame gap, then 30 frames of B = 105 frames at 30 fps, 640x360.
    expect(ffprobe(file, "stream=width,height,nb_read_frames")).toBe("640,360,105");
    const audio = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,channels", "-of", "csv=p=0", file]).toString().trim();
    expect(audio).toBe("aac,2");
    expect((await readdir(path.join(folder, "exports"))).every((f) => f.endsWith(".mp4"))).toBe(true);
    await rm(file);
  }, 60_000);

  it("loops an audio asset across an audio-only timeline", async () => {
    const music = path.join(tmp, "music-loop.wav");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", music], { stdio: "ignore" });
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data-audio") }));
    const folder = path.join(tmp, "audio-project");
    await app.inject({ method: "POST", url: "/project/create", headers, payload: { folder, name: "Audio", fps, width: 640, height: 360 } });
    const audioAsset: Asset = {
      ...asset("music", music),
      kind: "audio",
      durationFrames: 1000,
      fps: { num: 1000, den: 1 },
      width: null,
      height: null,
      hasAudio: true,
    };
    const commands: Command[] = [
      { type: "AddAsset", asset: audioAsset },
      { type: "AddTrack", track: { id: "audio-track", kind: "audio", order: 0, muted: false, locked: false, clips: [] } },
      { type: "AddClip", trackId: "audio-track", clip: {
        id: "music-clip", assetId: "music", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true,
      } },
    ];
    expect((await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/project/export", headers })).statusCode).toBe(202);
    let result = { state: "running" } as { state: string; outputPath?: string; message?: string };
    for (let i = 0; i < 600 && result.state === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = (await app.inject({ url: "/project/export", headers })).json();
    }
    expect(result).toMatchObject({ state: "done" });
    expect(Number(execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", result.outputPath!,
    ]).toString().trim())).toBeCloseTo(3, 1);
    const samples = execFileSync("ffmpeg", [
      "-v", "error", "-ss", "2", "-t", "0.5", "-i", result.outputPath!,
      "-f", "s16le", "-ac", "1", "-ar", "8000", "pipe:1",
    ]);
    let energy = 0;
    for (let i = 0; i + 1 < samples.length; i += 2) {
      const sample = samples.readInt16LE(i);
      energy += sample * sample;
    }
    expect(energy).toBeGreaterThan(0);
    await rm(result.outputPath!);
  }, 60_000);

  it.each(["png", "gif"])("composites a %s still overlay over video and preserves the fitted transparent area", async (extension) => {
    const background = path.join(tmp, "background.mp4");
    const overlay = path.join(tmp, `overlay.${extension}`);
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", background], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=80x80", "-frames:v", "1", overlay], { stdio: "ignore" });

    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, `data-overlay-${extension}`) }));
    const folder = path.join(tmp, `overlay-project-${extension}`);
    await app.inject({ method: "POST", url: "/project/create", headers, payload: { folder, name: "Overlay", fps, width: 640, height: 360 } });
    const commands: Command[] = [
      { type: "AddAsset", asset: asset("background", background, { durationFrames: 30, hasAudio: false }) },
      { type: "AddAsset", asset: asset("overlay", overlay, {
        kind: "image", name: `overlay.${extension}`, durationFrames: 30, fps: null, width: 80, height: 80, hasAudio: false,
      }) },
      { type: "AddTrack", track: { id: "base-track", kind: "video", order: 0, muted: false, locked: false, clips: [] } },
      { type: "AddTrack", track: { id: "overlay-track", kind: "overlay", order: 1, muted: false, locked: false, clips: [] } },
      { type: "AddClip", trackId: "base-track", clip: { id: "background-clip", assetId: "background", timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true } },
      { type: "AddClip", trackId: "overlay-track", clip: { id: "overlay-clip", assetId: "overlay", timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true } },
    ];
    expect((await app.inject({ method: "POST", url: "/project/commands", headers, payload: { commands } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/project/export", headers })).statusCode).toBe(202);
    let result = { state: "running" } as { state: string; outputPath?: string; message?: string };
    for (let i = 0; i < 600 && result.state === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      result = (await app.inject({ url: "/project/export", headers })).json();
    }
    expect(result).toMatchObject({ state: "done" });
    expect(ffprobe(result.outputPath!, "stream=nb_read_frames")).toBe("30");

    const sample = (x: number, y: number) => execFileSync("ffmpeg", [
      "-v", "error", "-ss", "0.95", "-i", result.outputPath!, "-vf", `crop=2:2:${x}:${y},scale=1:1,format=rgb24`,
      "-frames:v", "1", "-f", "rawvideo", "pipe:1",
    ]);
    const center = sample(320, 180);
    const corner = sample(10, 10);
    // GIF scaling/color conversion can shift the blue value, but it must still cover the red base.
    expect(center[0]).toBeLessThan(5);
    expect(center[1]).toBeLessThan(5);
    expect(center[2]).toBeGreaterThan(128);
    expect(corner[0]).toBeGreaterThan(245);
    expect(corner[1]).toBeLessThan(5);
    expect(corner[2]).toBeLessThan(5);
    await rm(result.outputPath!);
  }, 60_000);
});
