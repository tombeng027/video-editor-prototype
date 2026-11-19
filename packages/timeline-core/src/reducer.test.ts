import { describe, expect, it } from "vitest";
import type { Asset, Clip, Command, Project, Track } from "@ve/schema";
import { applyCommand, applyCommands, clipDuration, clipEnd, createEmptyProject, findClip, validateProject, type CommandResult } from "./index.js";

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

describe("clip speed", () => {
  it.each([0.25, 0.5, 1.33, 2, 4])("ripples all later same-track clips at %sx, preserving source ranges, gaps, other tracks and exact undo/redo", (speed) => {
    let original = setup();
    for (const c of [clip("c", 10, 0, 120), clip("n", 140, 0, 30), clip("last", 200, 30, 60)]) {
      original = must(add(original, "t_video", c)).project;
    }
    original = must(add(original, "t_audio", clip("music", 0, 0, 300, audio.id))).project;
    const changed = must(applyCommands(original, [{ type: "SetClipSpeed", clipId: "c", speed }]));
    const duration = Math.round(120 / speed);
    expect(findClip(changed.project, "c")!.clip).toEqual({ ...findClip(original, "c")!.clip, speed });
    expect(clipEnd(findClip(changed.project, "c")!.clip)).toBe(10 + duration);
    expect(findClip(changed.project, "n")!.clip.timelineStart).toBe(140 + duration - 120);
    expect(findClip(changed.project, "last")!.clip.timelineStart).toBe(200 + duration - 120);
    expect(changed.project.tracks[2]).toEqual(original.tracks[2]);
    const undo = must(applyCommands(changed.project, changed.inverse));
    expect(undo.project).toEqual(original);
    expect(must(applyCommands(undo.project, undo.inverse)).project).toEqual(changed.project);
  });

  it("supports audio-row speed, validates AddClip/load paths and rejects locked, invalid, image or overflowing edits atomically", () => {
    let p = must(add(setup(), "t_audio", clip("c", 0, 0, 120, audio.id))).project;
    expect(findClip(must(applyCommand(p, { type: "SetClipSpeed", clipId: "c", speed: 2 })).project, "c")!.clip.speed).toBe(2);
    for (const speed of [0, 4.1, NaN]) {
      expect(applyCommand(p, { type: "SetClipSpeed", clipId: "c", speed })).toMatchObject({ ok: false, error: { code: "INVALID_SPEED" } });
      expect(add(setup(), "t_video", { ...clip("bad", 0, 0, 30), speed })).toMatchObject({ ok: false });
    }
    p = must(add(p, "t_overlay", clip("still", 0, 0, 30, image.id))).project;
    expect(applyCommand(p, { type: "SetClipSpeed", clipId: "still", speed: 2 })).toMatchObject({ ok: false, error: { code: "INVALID_SPEED" } });
    expect(applyCommand(p, { type: "SetClipSpeed", clipId: "missing", speed: 2 })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const locked = must(applyCommand(p, { type: "SetTrackLocked", trackId: "t_audio", locked: true })).project;
    expect(applyCommand(locked, { type: "SetClipSpeed", clipId: "c", speed: 2 })).toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    const overflow = must(add(setup(), "t_video", clip("end", Number.MAX_SAFE_INTEGER - 30, 0, 30))).project;
    expect(applyCommands(overflow, [{ type: "SetClipSpeed", clipId: "end", speed: 0.25 }])).toMatchObject({ ok: false, error: { code: "INVALID_RANGE" } });
    expect(validateProject({ ...p, tracks: p.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({ ...clip, speed: 0 })) })) })).toMatchObject({ code: "INVALID_SPEED" });
    expect(clipDuration({ ...clip("tiny", 0, 0, 1), speed: 4 })).toBe(1);
  });

  it.each([0.25, 0.5, 1.33, 2, 4])("keeps split durations exact or explicitly rejects an unrepresentable source-frame cut at %sx", (speed) => {
    const c = { ...clip("c", 10, 0, 120), speed };
    const p = must(add(setup(), "t_video", c)).project;
    for (let offset = 1; offset < clipDuration(c); offset++) {
      const result = applyCommands(p, [{ type: "SplitClip", clipId: "c", frame: 10 + offset, newClipId: "right" }]);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FRAME");
        continue;
      }
      const left = findClip(result.project, "c")!.clip, right = findClip(result.project, "right")!.clip;
      expect(clipEnd(left)).toBe(right.timelineStart);
      expect(clipEnd(right)).toBe(clipEnd(c));
      expect(left.sourceOut).toBe(right.sourceIn);
      expect(must(applyCommands(result.project, result.inverse)).project).toEqual(p);
    }
  });

  it("maps head trims and overwrite trims through speed with exact snapshot undo and no overlaps", () => {
    let p = must(add(setup(), "t_video", { ...clip("c", 20, 0, 120), speed: 2 })).project;
    const head = must(applyCommands(p, [{ type: "TrimClip", clipId: "c", sourceIn: 30 }]));
    expect(findClip(head.project, "c")!.clip.timelineStart).toBe(35);
    expect(clipEnd(findClip(head.project, "c")!.clip)).toBe(80);
    expect(must(applyCommands(head.project, head.inverse)).project).toEqual(p);
    p = must(add(p, "t_video", { ...clip("n", 80, 0, 120), speed: 0.5 })).project;
    for (const command of [
      { type: "TrimClip", clipId: "c", sourceOut: 180 },
      { type: "MoveClip", clipId: "c", timelineStart: 50 },
    ] satisfies Command[]) {
      const changed = must(applyCommands(p, [command]));
      expect(findClip(changed.project, "n")!.clip).toMatchObject({ timelineStart: 110, sourceIn: 15, sourceOut: 120 });
      expect(must(applyCommands(changed.project, changed.inverse)).project).toEqual(p);
    }
  });

  it("moves an unrepresentable slow-motion neighbor intact and undoes ripple insertion at non-1x speed", () => {
    let p = must(add(setup(), "t_video", clip("c", 0, 0, 30))).project;
    p = must(add(p, "t_video", { ...clip("slow", 30, 0, 30), speed: 0.25 })).project;
    const extended = must(applyCommands(p, [{ type: "TrimClip", clipId: "c", sourceOut: 31 }]));
    expect(findClip(extended.project, "slow")!.clip).toMatchObject({ timelineStart: 31, sourceIn: 0, sourceOut: 30 });
    expect(must(applyCommands(extended.project, extended.inverse)).project).toEqual(p);
    const inserted = must(applyCommands(p, [{ type: "AddClip", trackId: "t_video", ripple: true,
      clip: { ...clip("fast", 10, 0, 60), speed: 2 } }]));
    expect(findClip(inserted.project, "fast")!.clip.timelineStart).toBe(10);
    expect(findClip(inserted.project, "c")!.clip.timelineStart).toBe(40);
    expect(findClip(inserted.project, "slow")!.clip.timelineStart).toBe(70);
    expect(must(applyCommands(inserted.project, inserted.inverse)).project).toEqual(p);
  });
});

describe("track names and locking", () => {
  it("can undo and redo adding a track that is already locked", () => {
    const original = setup();
    const added = must(applyCommand(original, { type: "AddTrack",
      track: track("locked", "audio", { order: 3, locked: true, name: "Music" }) }));
    const undone = must(applyCommands(added.project, added.inverse));
    expect(undone.project).toEqual(original);
    expect(must(applyCommands(undone.project, undone.inverse)).project).toEqual(added.project);
  });

  it.each(["t_video", "t_overlay", "t_audio"])("renames and locks %s with exact inverse restoration", (trackId) => {
    const original = setup();
    const renamed = must(applyCommand(original, { type: "SetTrackName", trackId, name: " B-roll " }));
    expect(renamed.project.tracks.find((track) => track.id === trackId)?.name).toBe("B-roll");
    const locked = must(applyCommand(renamed.project, { type: "SetTrackLocked", trackId, locked: true }));
    expect(locked.project.tracks.find((track) => track.id === trackId)?.locked).toBe(true);
    const unlocked = must(applyCommands(locked.project, locked.inverse));
    const restored = must(applyCommands(unlocked.project, renamed.inverse));
    expect(restored.project).toEqual(original);
    const redoneName = must(applyCommands(restored.project, restored.inverse));
    const redoneLock = must(applyCommands(redoneName.project, unlocked.inverse));
    expect(redoneLock.project).toEqual(locked.project);
    expect(original.tracks.find((track) => track.id === trackId)).not.toHaveProperty("name");
  });

  it("rejects invalid names and missing targets without mutation", () => {
    const original = setup();
    for (const name of ["", "  ", "x".repeat(81)]) {
      expect(applyCommand(original, { type: "SetTrackName", trackId: "t_video", name }))
        .toMatchObject({ ok: false, error: { code: "INVALID_TRACK_NAME" } });
    }
    for (const command of [
      { type: "SetTrackName", trackId: "missing", name: "Music" },
      { type: "SetTrackLocked", trackId: "missing", locked: true },
    ] satisfies Command[]) {
      expect(applyCommand(original, command)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    expect(original).toEqual(setup());
  });

  it.each(["t_video", "t_overlay", "t_audio"])("blocks clip changes and removal on locked %s but permits unlocking", (trackId) => {
    const assetId = trackId === "t_audio" ? audio.id : video.id;
    const occupied = must(add(setup(), trackId, clip("locked_clip", 0, 0, 60, assetId))).project;
    const locked = must(applyCommand(occupied, { type: "SetTrackLocked", trackId, locked: true })).project;
    for (const command of [
      { type: "AddClip", trackId, clip: clip("new", 60, 0, 30, assetId), ripple: true },
      { type: "RemoveClip", clipId: "locked_clip" },
      { type: "MoveClip", clipId: "locked_clip", timelineStart: 10 },
      { type: "TrimClip", clipId: "locked_clip", sourceOut: 30 },
      { type: "SplitClip", clipId: "locked_clip", frame: 30, newClipId: "split" },
      { type: "RemoveTrack", trackId },
    ] satisfies Command[]) {
      expect(applyCommand(locked, command)).toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    }
    const emptyLocked = must(applyCommand(setup(), { type: "SetTrackLocked", trackId, locked: true })).project;
    expect(applyCommand(emptyLocked, { type: "RemoveTrack", trackId }))
      .toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    const unlocked = must(applyCommand(locked, { type: "SetTrackLocked", trackId, locked: false })).project;
    expect(applyCommand(unlocked, { type: "RemoveClip", clipId: "locked_clip" }).ok).toBe(true);
    expect(applyCommand(locked, { type: "SetTrackName", trackId, name: "Locked media" }).ok).toBe(true);
  });

  it("rejects moving into a locked destination without changing either track", () => {
    const original = must(add(setup(), "t_video", clip("moving", 0, 0, 60))).project;
    const locked = must(applyCommand(original, { type: "SetTrackLocked", trackId: "t_overlay", locked: true })).project;
    expect(applyCommand(locked, { type: "MoveClip", clipId: "moving", timelineStart: 0, trackId: "t_overlay" }))
      .toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    expect(locked.tracks.find((track) => track.id === "t_video")?.clips).toHaveLength(1);
    expect(locked.tracks.find((track) => track.id === "t_overlay")?.clips).toHaveLength(0);
  });
});

describe("RelinkAsset", () => {
  it("preserves asset identity, metadata, proxies and timeline clips", () => {
    const p = must(add(setup(), "t_video", clip("video", 60, 20, 80))).project;
    const result = must(applyCommand(p, { type: "RelinkAsset", assetId: video.id, sourcePath: "D:\\Relocated\\v.mp4" }));
    expect(result.project.tracks).toEqual(p.tracks);
    expect(result.project.assets[0]).toEqual({ ...video, sourcePath: "D:\\Relocated\\v.mp4", mediaMode: "reference" });
    expect(result.inverse).toEqual([]);
    expect(applyCommand(p, { type: "RelinkAsset", assetId: "missing", sourcePath: "D:\\missing.mp4" }))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("AddClip", () => {
  it.each(["t_video", "t_overlay", "t_audio"])("ripples whole clips on %s and restores exact state with undo and redo", (trackId) => {
    const assetId = trackId === "t_audio" ? audio.id : video.id;
    let p = setup();
    for (const existing of [
      clip("before", 0, 0, 20, assetId),
      clip("overlapping", 30, 10, 60, assetId),
      clip("following", 80, 20, 50, assetId),
      clip("gap", 250, 0, 20, assetId),
    ]) p = must(add(p, trackId, existing)).project;
    const inserted = clip("new", 40, 0, 100, assetId);
    const result = must(applyCommands(p, [{ type: "AddClip", trackId, clip: inserted, ripple: true }]));
    const clips = result.project.tracks.find((track) => track.id === trackId)!.clips;
    expect(clips.map((clip) => [clip.id, clip.timelineStart])).toEqual([
      ["before", 0], ["new", 40], ["overlapping", 140], ["following", 190], ["gap", 250],
    ]);
    expect(findClip(result.project, "overlapping")!.clip).toMatchObject({ sourceIn: 10, sourceOut: 60 });
    const undone = must(applyCommands(result.project, result.inverse));
    expect(undone.project).toEqual(p);
    const redone = must(applyCommands(undone.project, undone.inverse));
    expect(redone.project).toEqual(result.project);
  });

  it("rejects ripple insertion on locked tracks and at an overflowing range", () => {
    const p = setup();
    const locked = { ...p, tracks: p.tracks.map((track) => ({ ...track, locked: true })) };
    expect(applyCommand(locked, { type: "AddClip", trackId: "t_video", clip: clip("new", 0, 0, 100), ripple: true }))
      .toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    const nearEnd = must(add(p, "t_video", clip("existing", Number.MAX_SAFE_INTEGER - 100, 0, 100))).project;
    expect(applyCommands(nearEnd, [{
      type: "AddClip", trackId: "t_video",
      clip: clip("new", Number.MAX_SAFE_INTEGER - 120, 0, 100), ripple: true,
    }])).toMatchObject({ ok: false, error: { code: "INVALID_RANGE" } });
    expect(findClip(nearEnd, "existing")!.clip.timelineStart).toBe(Number.MAX_SAFE_INTEGER - 100);
  });

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

  it("allows valid transforms on both visual track kinds but never audio", () => {
    const withT = { ...clip("c1", 0, 0, 10), transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 } };
    const p = setup();
    expect(add(p, "t_video", withT).ok).toBe(true);
    expect(add(p, "t_overlay", withT).ok).toBe(true);
    expect(add(p, "t_audio", withT)).toMatchObject({ ok: false, error: { code: "INVALID_TRANSFORM" } });
  });

  it("sets, resets and restores clip transforms through inverse commands without changing timing", () => {
    const original = must(add(setup(), "t_video", clip("c1", 0, 0, 90))).project;
    const transform = { x: 0.75, y: 0.5, scale: 0.5, opacity: 0.4 };
    const applied = must(applyCommand(original, { type: "SetClipTransform", clipId: "c1", transform }));
    expect(findClip(applied.project, "c1")?.clip).toEqual({ ...findClip(original, "c1")!.clip, transform });
    expect(validateProject(applied.project)).toBeNull();
    expect(must(applyCommands(applied.project, applied.inverse)).project).toEqual(original);
    const reset = must(applyCommand(applied.project, { type: "SetClipTransform", clipId: "c1" }));
    expect(findClip(reset.project, "c1")?.clip).not.toHaveProperty("transform");
    expect(must(applyCommands(reset.project, reset.inverse)).project).toEqual(applied.project);
    const split = must(applyCommand(applied.project, { type: "SplitClip", clipId: "c1", frame: 30, newClipId: "c2" }));
    expect(findClip(split.project, "c2")?.clip.transform).toEqual(transform);
    const moved = must(applyCommand(applied.project, { type: "MoveClip", clipId: "c1", timelineStart: 0, trackId: "t_overlay" }));
    expect(findClip(moved.project, "c1")?.clip.transform).toEqual(transform);
  });

  it("rejects missing, locked, audio and invalid transform edits atomically", () => {
    let p = must(add(setup(), "t_audio", clip("audio", 0, 0, 90))).project;
    p = must(add(p, "t_video", clip("visual", 0, 0, 90))).project;
    const transform = { x: 0.5, y: 0.5, scale: 2, opacity: 0.5 };
    expect(applyCommand(p, { type: "SetClipTransform", clipId: "missing", transform })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(applyCommand(p, { type: "SetClipTransform", clipId: "audio", transform })).toMatchObject({ ok: false, error: { code: "INVALID_TRANSFORM" } });
    expect(applyCommand(p, { type: "SetClipTransform", clipId: "visual", transform: { ...transform, scale: 0 } })).toMatchObject({ ok: false, error: { code: "INVALID_TRANSFORM" } });
    const locked = must(applyCommand(p, { type: "SetTrackLocked", trackId: "t_video", locked: true })).project;
    expect(applyCommand(locked, { type: "SetClipTransform", clipId: "visual" })).toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    const invalid = { ...p, tracks: p.tracks.map((track) => ({ ...track, clips: track.clips.map((clip) => ({ ...clip })) })) };
    findClip(invalid, "audio")!.clip.transform = transform;
    expect(validateProject(invalid)?.code).toBe("INVALID_TRANSFORM");
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

  it("trims the next clip's head when extending over part of it and undoes both changes", () => {
    let p = must(add(setup(), "t_video", clip("c1", 0, 0, 100))).project;
    p = must(add(p, "t_video", clip("c2", 100, 0, 50))).project;
    const res = must(applyCommand(p, { type: "TrimClip", clipId: "c1", sourceOut: 120 }));
    expect(findClip(res.project, "c1")!.clip).toMatchObject({ timelineStart: 0, sourceIn: 0, sourceOut: 120 });
    expect(findClip(res.project, "c2")!.clip).toMatchObject({ timelineStart: 120, sourceIn: 20, sourceOut: 50 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("moves fully covered clips intact and ripples following clips forward", () => {
    let p = must(add(setup(), "t_video", clip("c1", 0, 0, 30))).project;
    p = must(add(p, "t_video", clip("c2", 30, 0, 20))).project;
    p = must(add(p, "t_video", clip("c3", 50, 0, 20))).project;
    const res = must(applyCommand(p, { type: "TrimClip", clipId: "c1", sourceOut: 55 }));
    expect(findClip(res.project, "c1")!.clip).toMatchObject({ timelineStart: 0, sourceOut: 55 });
    expect(findClip(res.project, "c2")!.clip).toMatchObject({ timelineStart: 55, sourceIn: 0, sourceOut: 20 });
    expect(findClip(res.project, "c3")!.clip).toMatchObject({ timelineStart: 75, sourceIn: 0, sourceOut: 20 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("moves a next clip intact when the extension covers it exactly", () => {
    let p = must(add(setup(), "t_video", clip("c1", 0, 0, 30))).project;
    p = must(add(p, "t_video", clip("c2", 30, 0, 20))).project;
    const res = must(applyCommand(p, { type: "TrimClip", clipId: "c1", sourceOut: 50 }));
    expect(findClip(res.project, "c2")!.clip).toMatchObject({ timelineStart: 50, sourceIn: 0, sourceOut: 20 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("undoes a ripple followed by a partial head trim", () => {
    let p = must(add(setup(), "t_video", clip("c1", 0, 0, 30))).project;
    p = must(add(p, "t_video", clip("c2", 30, 0, 20))).project;
    p = must(add(p, "t_video", clip("c3", 50, 0, 50))).project;
    const res = must(applyCommand(p, { type: "TrimClip", clipId: "c1", sourceOut: 55 }));
    expect(findClip(res.project, "c2")!.clip).toMatchObject({ timelineStart: 55, sourceIn: 0, sourceOut: 20 });
    expect(findClip(res.project, "c3")!.clip).toMatchObject({ timelineStart: 75, sourceIn: 25, sourceOut: 50 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("moves a clip without changing its source range and provides an inverse", () => {
    const p = must(add(setup(), "t_video", clip("c1", 10, 20, 100))).project;
    const res = must(applyCommand(p, { type: "MoveClip", clipId: "c1", timelineStart: 40 }));
    expect(findClip(res.project, "c1")!.clip).toMatchObject({ timelineStart: 40, sourceIn: 20, sourceOut: 100 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("moves a visual clip to another visual track and allows layered overlap", () => {
    let p = must(add(setup(), "t_video", clip("c1", 110, 20, 100))).project;
    p = must(add(p, "t_video", clip("behind", 0, 0, 100))).project;
    const res = must(applyCommand(p, { type: "MoveClip", clipId: "c1", timelineStart: 40, trackId: "t_overlay" }));
    expect(findClip(res.project, "c1")!.track.id).toBe("t_overlay");
    expect(findClip(res.project, "c1")!.clip).toMatchObject({ timelineStart: 40, sourceIn: 20, sourceOut: 100 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("rejects cross-kind and overlapping audio-track moves", () => {
    let p = must(add(setup(), "t_audio", clip("a1", 0, 0, 40, "asset_a"))).project;
    p = must(add(p, "t_audio", clip("a2", 50, 0, 40, "asset_a"))).project;
    p = must(applyCommand(p, {
      type: "AddTrack",
      track: track("t_audio_2", "audio", { order: 3 }),
    })).project;
    expect(applyCommand(p, { type: "MoveClip", clipId: "a1", timelineStart: 60, trackId: "t_audio" }))
      .toMatchObject({ ok: false, error: { code: "OVERLAP" } });
    expect(applyCommand(p, { type: "MoveClip", clipId: "a1", timelineStart: 60, trackId: "t_video" }))
      .toMatchObject({ ok: false, error: { code: "TRACK_KIND_MISMATCH" } });
    const res = must(applyCommand(p, { type: "MoveClip", clipId: "a1", timelineStart: 60, trackId: "t_audio_2" }));
    expect(findClip(res.project, "a1")!.track.id).toBe("t_audio_2");
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("does not ripple a clip that ends before the moved clip's new position", () => {
    let p = must(add(setup(), "t_video", clip("c1", 0, 0, 30))).project;
    p = must(add(p, "t_video", clip("c2", 30, 0, 20))).project;
    const res = must(applyCommand(p, { type: "MoveClip", clipId: "c1", timelineStart: 50 }));
    expect(findClip(res.project, "c1")!.clip.timelineStart).toBe(50);
    expect(findClip(res.project, "c2")!.clip.timelineStart).toBe(30);
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("trims the next clip's head when moving backward into it and undoes both changes", () => {
    let p = must(add(setup(), "t_video", clip("c2", 90, 0, 90))).project;
    p = must(add(p, "t_video", clip("c1", 300, 0, 90))).project;
    const res = must(applyCommand(p, { type: "MoveClip", clipId: "c1", timelineStart: 60 }));
    expect(findClip(res.project, "c1")!.clip).toMatchObject({ timelineStart: 60, sourceIn: 0, sourceOut: 90 });
    expect(findClip(res.project, "c2")!.clip).toMatchObject({ timelineStart: 150, sourceIn: 60, sourceOut: 90 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("allows looping audio extensions and trims a following audio clip on a move", () => {
    let p = must(add(setup(), "t_audio", clip("a1", 0, 0, 400, "asset_a"))).project;
    p = must(add(p, "t_audio", clip("a2", 450, 0, 100, "asset_a"))).project;
    const res = must(applyCommand(p, { type: "MoveClip", clipId: "a1", timelineStart: 100 }));
    expect(findClip(res.project, "a1")!.clip).toMatchObject({ timelineStart: 100, sourceOut: 400 });
    expect(findClip(res.project, "a2")!.clip).toMatchObject({ timelineStart: 500, sourceIn: 50 });
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("mutes and restores a track", () => {
    const p = setup();
    const res = must(applyCommand(p, { type: "SetTrackMuted", trackId: "t_audio", muted: true }));
    expect(res.project.tracks.find((track) => track.id === "t_audio")?.muted).toBe(true);
    expect(must(applyCommands(res.project, res.inverse)).project).toEqual(p);
  });

  it("rejects trimming beyond the source", () => {
    let p = must(add(setup(), "t_video", clip("c1", 0, 0, 100))).project;
    p = must(add(p, "t_video", clip("c2", 100, 0, 50))).project;
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

describe("SwapTrackOrder", () => {
  it("swaps two visual layers and returns a working inverse", () => {
    const p = setup();
    const result = must(applyCommand(p, { type: "SwapTrackOrder", firstTrackId: "t_video", secondTrackId: "t_overlay" }));
    expect(result.project.tracks.find((track) => track.id === "t_video")?.order).toBe(1);
    expect(result.project.tracks.find((track) => track.id === "t_overlay")?.order).toBe(0);
    expect(must(applyCommands(result.project, result.inverse)).project).toEqual(p);
  });

  it("rejects audio tracks and missing tracks", () => {
    expect(applyCommand(setup(), { type: "SwapTrackOrder", firstTrackId: "t_video", secondTrackId: "t_audio" }))
      .toMatchObject({ ok: false, error: { code: "INVALID_TRACK_ORDER" } });
    expect(applyCommand(setup(), { type: "SwapTrackOrder", firstTrackId: "t_video", secondTrackId: "missing" }))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
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
