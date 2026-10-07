import { describe, expect, it } from "vitest";
import type { Asset, Clip, Command, Project, Track } from "@ve/schema";
import { applyCommand, applyCommands, createEmptyProject, findClip, type CommandResult } from "./index.js";

const fps = { num: 30, den: 1 };

const video: Asset = {
  id: "asset_v",
  kind: "video",
  name: "v.mp4",
  mediaMode: "reference",
  sourcePath: "C:/v.mp4",
  contentHash: "h1",
  durationFrames: 300,
  fps,
  width: 1920,
  height: 1080,
  hasAudio: true,
  proxyPath: null,
};
const image: Asset = { ...video, id: "asset_i", kind: "image", fps: null, durationFrames: 150, hasAudio: false };
const audio: Asset = {
  ...video,
  id: "asset_a",
  kind: "audio",
  fps: { num: 1000, den: 1 },
  durationFrames: 10000,
  width: null,
  height: null,
};

const track = (id: string, kind: Track["kind"], extra: Partial<Track> = {}): Track => ({
  id,
  kind,
  order: 0,
  muted: false,
  locked: false,
  clips: [],
  ...extra,
});

const clip = (id: string, start: number, inn: number, out: number, assetId = "asset_v"): Clip => ({
  id,
  assetId,
  timelineStart: start,
  sourceIn: inn,
  sourceOut: out,
  speed: 1,
  audioLinked: true,
});

function must(result: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result;
}

function setup(): Project {
  let p = createEmptyProject({ id: "p", name: "Test", fps, width: 1920, height: 1080, now: "t" });
  for (const cmd of [
    { type: "AddAsset", asset: video },
    { type: "AddAsset", asset: image },
    { type: "AddAsset", asset: audio },
    { type: "AddTrack", track: track("t_video", "video", { order: 0 }) },
    { type: "AddTrack", track: track("t_overlay", "overlay", { order: 1 }) },
    { type: "AddTrack", track: track("t_audio", "audio", { order: 2 }) },
  ] satisfies Command[]) {
    p = must(applyCommand(p, cmd)).project;
  }
  return p;
}

const add = (p: Project, trackId: string, c: Clip) => applyCommand(p, { type: "AddClip", trackId, clip: c });

describe("AddClip", () => {
  it("adds a valid clip and the inverse removes it", () => {
    const p = setup();
    const res = must(add(p, "t_video", clip("c1", 0, 0, 100)));
    expect(findClip(res.project, "c1")).toBeDefined();
    const undone = must(applyCommands(res.project, res.inverse));
    expect(undone.project).toEqual(p);
  });

  it("rejects ranges outside the asset", () => {
    const res = add(setup(), "t_video", clip("c1", 0, 0, 301));
    expect(res).toMatchObject({ ok: false, error: { code: "INVALID_RANGE" } });
  });

  it("rejects empty or negative ranges", () => {
    const p = setup();
    expect(add(p, "t_video", clip("c1", 0, 50, 50))).toMatchObject({ ok: false });
    expect(add(p, "t_video", clip("c1", -1, 0, 10))).toMatchObject({ ok: false });
  });

  it("rejects overlaps but allows touching clips", () => {
    const p = must(add(setup(), "t_video", clip("c1", 0, 0, 100))).project;
    expect(add(p, "t_video", clip("c2", 99, 0, 50))).toMatchObject({ ok: false, error: { code: "OVERLAP" } });
    expect(add(p, "t_video", clip("c2", 100, 0, 50)).ok).toBe(true);
  });

  it("rejects duplicate ids", () => {
    const p = must(add(setup(), "t_video", clip("c1", 0, 0, 10))).project;
    expect(add(p, "t_video", clip("c1", 50, 0, 10))).toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } });
  });

  it("enforces track and asset kind compatibility", () => {
    const p = setup();
    expect(add(p, "t_audio", clip("c1", 0, 0, 10, "asset_i"))).toMatchObject({
      ok: false,
      error: { code: "TRACK_KIND_MISMATCH" },
    });
    expect(add(p, "t_video", clip("c2", 0, 0, 10, "asset_a"))).toMatchObject({
      ok: false,
      error: { code: "TRACK_KIND_MISMATCH" },
    });
    expect(add(p, "t_audio", clip("c3", 0, 0, 100, "asset_v")).ok).toBe(true);
    expect(add(p, "t_audio", clip("c4", 200, 0, 100, "asset_a")).ok).toBe(true);
  });

  it("allows image clips of any length and a non-negative source start", () => {
    const p = setup();
    expect(add(p, "t_video", clip("c1", 0, 0, 900, "asset_i")).ok).toBe(true);
    expect(add(p, "t_video", clip("c2", 1000, 5, 100, "asset_i")).ok).toBe(true);
  });

  it("allows a video-with-audio on an audio track but not a silent one", () => {
    let p = setup();
    expect(add(p, "t_audio", clip("c1", 0, 0, 50, "asset_v")).ok).toBe(true);
    p = must(applyCommand(p, { type: "AddAsset", asset: { ...video, id: "silent", hasAudio: false } })).project;
    expect(add(p, "t_audio", clip("c2", 100, 0, 50, "silent"))).toMatchObject({
      ok: false,
      error: { code: "TRACK_KIND_MISMATCH" },
    });
  });

  it("only allows transforms on overlay tracks", () => {
    const withT = { ...clip("c1", 0, 0, 10), transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 } };
    const p = setup();
    expect(add(p, "t_video", withT)).toMatchObject({ ok: false, error: { code: "INVALID_TRANSFORM" } });
    expect(add(p, "t_overlay", withT).ok).toBe(true);
  });

  it("rejects locked tracks", () => {
    let p = setup();
    p = { ...p, tracks: p.tracks.map((t) => (t.id === "t_video" ? { ...t, locked: true } : t)) };
    expect(add(p, "t_video", clip("c1", 0, 0, 10))).toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
  });

  it("converts asset duration when frame rates differ", () => {
    const p = must(applyCommand(setup(), { type: "AddAsset", asset: { ...video, id: "v24", fps: { num: 24, den: 1 }, durationFrames: 240 } })).project;
    expect(add(p, "t_video", clip("c1", 0, 0, 300, "v24")).ok).toBe(true);
    expect(add(p, "t_video", clip("c2", 300, 0, 301, "v24")).ok).toBe(false);
  });
});

describe("SplitClip", () => {
  it("splits a clip into two contiguous clips", () => {
    const p = must(add(setup(), "t_video", clip("c1", 10, 20, 120))).project;
    const res = must(applyCommand(p, { type: "SplitClip", clipId: "c1", frame: 60, newClipId: "c2" }));
    const left = findClip(res.project, "c1")!.clip;
    const right = findClip(res.project, "c2")!.clip;
    expect(left).toMatchObject({ timelineStart: 10, sourceIn: 20, sourceOut: 70 });
    expect(right).toMatchObject({ timelineStart: 60, sourceIn: 70, sourceOut: 120 });
  });

  it("is undone by its inverse", () => {
    const p = must(add(setup(), "t_video", clip("c1", 10, 20, 120))).project;
    const res = must(applyCommand(p, { type: "SplitClip", clipId: "c1", frame: 60, newClipId: "c2" }));
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("rejects split points on or outside the clip edges", () => {
    const p = must(add(setup(), "t_video", clip("c1", 10, 0, 100))).project;
    for (const frame of [10, 110, 5, 500]) {
      expect(applyCommand(p, { type: "SplitClip", clipId: "c1", frame, newClipId: "c2" })).toMatchObject({
        ok: false,
        error: { code: "INVALID_FRAME" },
      });
    }
  });
});

describe("TrimClip", () => {
  it("trims the tail", () => {
    const p = must(add(setup(), "t_video", clip("c1", 10, 0, 100))).project;
    const res = must(applyCommand(p, { type: "TrimClip", clipId: "c1", sourceOut: 60 }));
    expect(findClip(res.project, "c1")!.clip).toMatchObject({ timelineStart: 10, sourceIn: 0, sourceOut: 60 });
  });

  it("trims the head while keeping the right edge fixed", () => {
    const p = must(add(setup(), "t_video", clip("c1", 10, 0, 100))).project;
    const res = must(applyCommand(p, { type: "TrimClip", clipId: "c1", sourceIn: 30 }));
    expect(findClip(res.project, "c1")!.clip).toMatchObject({ timelineStart: 40, sourceIn: 30, sourceOut: 100 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("rejects trimming into a neighbour or beyond the source", () => {
    let p = must(add(setup(), "t_video", clip("c1", 0, 0, 100))).project;
    p = must(add(p, "t_video", clip("c2", 100, 0, 50))).project;
    expect(applyCommand(p, { type: "TrimClip", clipId: "c1", sourceOut: 150 })).toMatchObject({
      ok: false,
      error: { code: "OVERLAP" },
    });
    expect(applyCommand(p, { type: "TrimClip", clipId: "c2", sourceOut: 400 })).toMatchObject({
      ok: false,
      error: { code: "INVALID_RANGE" },
    });
  });
});

describe("RemoveClip, RemoveAsset, RemoveTrack", () => {
  it("removes a clip and restores it on undo", () => {
    const p = must(add(setup(), "t_video", clip("c1", 0, 0, 100))).project;
    const res = must(applyCommand(p, { type: "RemoveClip", clipId: "c1" }));
    expect(findClip(res.project, "c1")).toBeUndefined();
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("blocks removing assets in use and tracks with clips", () => {
    const p = must(add(setup(), "t_video", clip("c1", 0, 0, 100))).project;
    expect(applyCommand(p, { type: "RemoveAsset", assetId: "asset_v" })).toMatchObject({
      ok: false,
      error: { code: "ASSET_IN_USE" },
    });
    expect(applyCommand(p, { type: "RemoveTrack", trackId: "t_video" })).toMatchObject({
      ok: false,
      error: { code: "TRACK_NOT_EMPTY" },
    });
  });

  it("reports missing targets", () => {
    const p = setup();
    expect(applyCommand(p, { type: "RemoveClip", clipId: "nope" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(applyCommand(p, { type: "RemoveAsset", assetId: "nope" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("SetAssetProxy", () => {
  it("sets the proxy path and undoes it", () => {
    const p = setup();
    const res = must(applyCommand(p, { type: "SetAssetProxy", assetId: "asset_v", proxyPath: "proxies/asset_v.mp4" }));
    expect(res.project.assets.find((a) => a.id === "asset_v")?.proxyPath).toBe("proxies/asset_v.mp4");
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("reports a missing asset", () => {
    expect(applyCommand(setup(), { type: "SetAssetProxy", assetId: "nope", proxyPath: null })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("purity", () => {  it("does not mutate the input project", () => {
    const p = setup();
    const snapshot = (JSON.parse(JSON.stringify(p)) as Project);
    must(add(p, "t_video", clip("c1", 0, 0, 100)));
    expect(p).toEqual(snapshot);
  });
});

describe("locked tracks", () => {
  it("rejects trim, split and remove on a locked track", () => {
    let p = must(add(setup(), "t_video", clip("c1", 0, 0, 100))).project;
    p = { ...p, tracks: p.tracks.map((t) => (t.id === "t_video" ? { ...t, locked: true } : t)) };
    const cmds: Command[] = [
      { type: "TrimClip", clipId: "c1", sourceOut: 50 },
      { type: "SplitClip", clipId: "c1", frame: 50, newClipId: "c2" },
      { type: "RemoveClip", clipId: "c1" },
    ];
    for (const cmd of cmds) {
      expect(applyCommand(p, cmd)).toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    }
  });
});

describe("AddTrack order", () => {
  it("rejects a duplicate order", () => {
    const res = applyCommand(setup(), { type: "AddTrack", track: track("t_extra", "video", { order: 0 }) });
    expect(res).toMatchObject({ ok: false, error: { code: "DUPLICATE_ORDER" } });
  });
});

describe("SetProjectFps", () => {
  it("changes the frame rate on an empty timeline and undoes it", () => {
    const p = setup();
    const res = must(applyCommand(p, { type: "SetProjectFps", fps: { num: 24, den: 1 } }));
    expect(res.project.settings.fps).toEqual({ num: 24, den: 1 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("is rejected once clips exist", () => {
    const p = must(add(setup(), "t_video", clip("c1", 0, 0, 10))).project;
    expect(applyCommand(p, { type: "SetProjectFps", fps: { num: 24, den: 1 } })).toMatchObject({
      ok: false,
      error: { code: "PROJECT_NOT_EMPTY" },
    });
  });
});

describe("image clips", () => {
  it("can be head-trimmed with the right edge fixed", () => {
    const p = must(add(setup(), "t_video", clip("c1", 10, 0, 100, "asset_i"))).project;
    const res = must(applyCommand(p, { type: "TrimClip", clipId: "c1", sourceIn: 20 }));
    expect(findClip(res.project, "c1")!.clip).toMatchObject({ timelineStart: 30, sourceIn: 20, sourceOut: 100 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });
});

describe("applyCommands", () => {
  it("stops at the first error and leaves the input untouched", () => {
    const p = setup();
    const res = applyCommands(p, [
      { type: "AddClip", trackId: "t_video", clip: clip("c1", 0, 0, 10) },
      { type: "RemoveClip", clipId: "missing" },
    ]);
    expect(res).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(findClip(p, "c1")).toBeUndefined();
  });

  it("returns an inverse that undoes the whole batch", () => {
    const p = setup();
    const res = must(
      applyCommands(p, [
        { type: "AddClip", trackId: "t_video", clip: clip("c1", 0, 0, 100) },
        { type: "SplitClip", clipId: "c1", frame: 40, newClipId: "c2" },
      ]),
    );
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });
});
