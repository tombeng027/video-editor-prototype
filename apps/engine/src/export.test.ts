import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Asset, Command, Project } from "@ve/schema";
import { buildRenderPlan, createEmptyProject, type RenderPlan } from "@ve/timeline-core";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { buildExportArgs, ExportPlanError } from "./exportArgs.js";
import { durationMatches, exportFileName } from "./exporter.js";
import type { ExportRunner } from "./exporter.js";

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
  let probed = 3;

  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "ve-export-"));
    source = path.join(tmp, "src.mp4");
    await writeFile(source, "x");
  });
  beforeEach(async () => {
    probed = 3;
    runner = async (input) => {
      input.onProgress(0.5);
      await writeFile(input.args.at(-1)!, "fake");
    };
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "secret", ENGINE_DATA_DIR: path.join(tmp, "data") }), undefined, {
      exportRunner: (i) => runner(i),
      probeDuration: async () => probed,
    });
    folder = path.join(tmp, `p-${Math.random().toString(36).slice(2)}`);
    await app.inject({
      method: "POST",
      url: "/project/create",
      headers,
      payload: { folder, name: "Demo", fps, width: 1280, height: 720 },
    });
  });
  afterEach(async () => app.close());

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
    expect(res.json().offline).toEqual([{ assetId: "m", name: "m.mp4", path: path.join(tmp, "gone.mp4") }]);
  });

  it("exports to exports/ and finishes done", async () => {
    await setup();
    const res = await start();
    expect(res.statusCode).toBe(202);
    const done = await settle();
    expect(done.state).toBe("done");
    expect(done.outputPath).toMatch(/exports[\\/]Demo-\d{8}-\d{6}\.mp4$/);
    expect((await stat(done.outputPath)).isFile()).toBe(true);
    expect((await readdir(path.join(folder, "exports"))).filter((f) => f.endsWith(".part"))).toEqual([]);
  });

  it("discards a file whose duration does not match the timeline", async () => {
    await setup();
    probed = 10;
    await start();
    const failed = await settle();
    expect(failed.state).toBe("failed");
    expect(failed.message).toMatch(/discarded/);
    expect(await readdir(path.join(folder, "exports"))).toEqual([]);
  });

  it("reports a runner failure and removes the partial file", async () => {
    await setup();
    runner = async (input) => {
      await writeFile(input.args.at(-1)!, "partial");
      throw new Error("encoder exploded");
    };
    await start();
    const failed = await settle();
    expect(failed).toMatchObject({ state: "failed", message: "encoder exploded" });
    expect(await readdir(path.join(folder, "exports"))).toEqual([]);
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
  afterEach(async () => app?.close());

  const ffprobe = (file: string, entries: string) =>
    execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", entries, "-of", "csv=p=0", file]).toString().trim();

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
});
