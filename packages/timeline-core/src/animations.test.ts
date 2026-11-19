import { describe, expect, it } from "vitest";
import type { ClipAnimations, Command, Project } from "@ve/schema";
import { ProjectSchema } from "@ve/schema";
import { applyCommands, clipDuration, validateProject } from "./reducer.js";
import { createEmptyProject } from "./project.js";
import { buildRenderPlan } from "./renderPlan.js";

const animations: ClipAnimations = {
  entrance: { id: "entrance.fade", version: 1, durationFrames: 15 },
  exit: { id: "exit.slide-left", version: 1, durationFrames: 15 },
};
const fixture = (): Project => ({
  ...createEmptyProject({ id: "p", name: "Animations", fps: { num: 30, den: 1 }, width: 64, height: 64 }),
  assets: [{ id: "a", name: "Image", kind: "image", mediaMode: "reference", sourcePath: "test.png",
    contentHash: "a", durationFrames: 90, fps: null, width: 64, height: 64, hasAudio: false, proxyPath: null }],
  tracks: [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
    { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true },
  ] }],
});
function apply(project: Project, commands: Command[]) {
  const result = applyCommands(project, commands);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}
describe("clip animation commands", () => {
  it("saves/reopens animations, preserves edits and supports exact inverse/redo and removal", () => {
    const p = fixture();
    const result = apply(p, [{ type: "SetClipAnimations", clipId: "c", animations }]);
    expect(result.project.tracks[0]!.clips[0]).toEqual({ ...p.tracks[0]!.clips[0], animations });
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(result.project)));
    expect(validateProject(reopened)).toBeNull();
    const undone = apply(reopened, result.inverse);
    expect(undone.project).toEqual(p);
    expect(apply(undone.project, undone.inverse).project).toEqual(result.project);
    const removed = apply(result.project, [{ type: "SetClipAnimations", clipId: "c" }]);
    expect(removed.project).toEqual(p);
    expect(apply(removed.project, removed.inverse).project).toEqual(result.project);
  });
  it("rejects locked/audio clips and effects too long for a short clip", () => {
    const p = fixture(); p.tracks[0]!.locked = true;
    expect(applyCommands(p, [{ type: "SetClipAnimations", clipId: "c", animations }])).toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    p.tracks[0]!.locked = false; p.tracks[0]!.kind = "audio"; p.assets[0]!.kind = "audio"; p.assets[0]!.hasAudio = true;
    expect(applyCommands(p, [{ type: "SetClipAnimations", clipId: "c", animations }])).toMatchObject({ ok: false, error: { code: "INVALID_ANIMATION" } });
    const short = fixture(); short.tracks[0]!.clips[0]!.sourceOut = 20;
    expect(applyCommands(short, [{ type: "SetClipAnimations", clipId: "c", animations }])).toMatchObject({ ok: false, error: { code: "INVALID_ANIMATION" } });
  });
  it("rejects trims and speed changes that would leave effects too long, atomically", () => {
    const p = fixture(); p.assets[0]!.kind = "video"; p.assets[0]!.fps = p.settings.fps;
    const saved = apply(p, [{ type: "SetClipAnimations", clipId: "c", animations }]).project;
    for (const command of [
      { type: "TrimClip", clipId: "c", sourceOut: 20 },
      { type: "SetClipSpeed", clipId: "c", speed: 4 },
    ] satisfies Command[]) {
      expect(applyCommands(saved, [command])).toMatchObject({ ok: false, error: { code: "INVALID_ANIMATION" } });
    }
    expect(clipDuration(saved.tracks[0]!.clips[0]!)).toBe(60);
    const trimmed = apply(saved, [{ type: "TrimClip", clipId: "c", sourceOut: 45 }]);
    expect(apply(trimmed.project, trimmed.inverse).project).toEqual(saved);
  });
  it("keeps entrance left/exit right when splitting with exact Undo/Redo, rejecting short halves", () => {
    const p = apply(fixture(), [{ type: "SetClipAnimations", clipId: "c", animations }]).project;
    expect(applyCommands(p, [{ type: "SplitClip", clipId: "c", newClipId: "right", frame: 5 }])).toMatchObject({ ok: false, error: { code: "INVALID_ANIMATION" } });
    const split = apply(p, [{ type: "SplitClip", clipId: "c", newClipId: "right", frame: 30 }]);
    expect(split.project.tracks[0]!.clips.map((clip) => clip.animations)).toEqual([{ entrance: animations.entrance }, { exit: animations.exit }]);
    const undo = apply(split.project, split.inverse);
    expect(undo.project).toEqual(p);
    expect(apply(undo.project, undo.inverse).project).toEqual(split.project);
  });
  it("retains clip-local offsets when other layers cut the render into segments", () => {
    const p = fixture(); p.tracks[0]!.clips[0]!.animations = animations;
    p.tracks.push({ id: "over", kind: "overlay", order: 1, muted: false, locked: false,
      clips: [{ ...p.tracks[0]!.clips[0]!, id: "top", timelineStart: 7, sourceOut: 7, animations: undefined }] });
    const plan = buildRenderPlan(p);
    expect(plan.segments.filter((segment) => segment.kind === "clip").map((segment) => segment.layers[0]!.clipOffsetFrames)).toEqual([0, 7, 14]);
    expect(plan.segments[0]!.kind === "clip" && plan.segments[0]!.layers[0]).toMatchObject({ animations, clipDurationFrames: 60 });
  });
  it("rejects ripple head trims that leave a neighbor's animations too long, without changing either clip", () => {
    const p = fixture();
    p.tracks[0]!.clips.push({ ...p.tracks[0]!.clips[0]!, id: "neighbor",
      timelineStart: 60, sourceOut: 60, animations });
    const before = JSON.stringify(p);
    for (const command of [
      { type: "TrimClip", clipId: "c", sourceOut: 100 },
      { type: "MoveClip", clipId: "c", timelineStart: 40 },
    ] satisfies Command[]) {
      expect(applyCommands(p, [command])).toMatchObject({ ok: false, error: { code: "INVALID_ANIMATION" } });
      expect(JSON.stringify(p)).toBe(before);
    }
    const moved = apply(p, [{ type: "MoveClip", clipId: "c", timelineStart: 10 }]);
    expect(apply(moved.project, moved.inverse).project).toEqual(p);
  });
  it("rescales percentage animations with trim and speed instead of rejecting them, and keeps on-screen length on split", () => {
    const percent: ClipAnimations = {
      entrance: { id: "entrance.fade", version: 1, durationPercent: 25 },
      exit: { id: "exit.slide-left", version: 1, durationPercent: 25 },
    };
    const p = fixture(); p.assets[0]!.kind = "video"; p.assets[0]!.fps = p.settings.fps;
    const saved = apply(p, [{ type: "SetClipAnimations", clipId: "c", animations: percent }]).project;
    for (const command of [
      { type: "TrimClip", clipId: "c", sourceOut: 4 },
      { type: "SetClipSpeed", clipId: "c", speed: 4 },
    ] satisfies Command[]) {
      const result = apply(saved, [command]);
      expect(result.project.tracks[0]!.clips[0]!.animations).toEqual(percent);
      expect(apply(result.project, result.inverse).project).toEqual(saved);
    }
    const split = apply(saved, [{ type: "SplitClip", clipId: "c", newClipId: "right", frame: 20 }]);
    expect(split.project.tracks[0]!.clips.map((clip) => clip.animations)).toEqual([
      { entrance: { ...percent.entrance, durationPercent: 75 } },
      { exit: { ...percent.exit, durationPercent: 37.5 } },
    ]);
    const tiny = apply(saved, [{ type: "SplitClip", clipId: "c", newClipId: "right", frame: 5 }]);
    expect(tiny.project.tracks[0]!.clips[0]!.animations?.entrance).toMatchObject({ durationPercent: 100 });
    expect(apply(tiny.project, tiny.inverse).project).toEqual(saved);
  });
});
