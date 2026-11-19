import { describe, expect, it } from "vitest";
import { ClipCropSchema, CommandSchema, ProjectSchema, type ClipCrop, type Command, type Project } from "@ve/schema";
import { applyCommands, validateProject } from "./reducer.js";
import { createEmptyProject } from "./project.js";
import { buildRenderPlan } from "./renderPlan.js";

const crop: ClipCrop = { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 };
const fixture = (): Project => ({
  ...createEmptyProject({ id: "p", name: "Crop", fps: { num: 30, den: 1 }, width: 1920, height: 1080, now: "2026-11-10T00:00:00.000Z" }),
  assets: [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "test.mp4",
    contentHash: "a", durationFrames: 300, fps: { num: 30, den: 1 }, width: 1920, height: 1080, hasAudio: true, proxyPath: null }],
  tracks: [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
    { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true },
  ] }],
});

function apply(project: Project, commands: Command[]) {
  const result = applyCommands(project, commands);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("crop data and commands", () => {
  it("passes crop through every layer and segment without changing timing or audio", () => {
    const project = fixture();
    project.tracks[0]!.clips[0]!.crop = crop;
    project.tracks[0]!.clips[0]!.speed = 2;
    project.tracks[0]!.clips[0]!.zoom = { version: 1, startPercent: 0, endPercent: 100, startScale: 1, endScale: 2 };
    project.tracks.push({ id: "top", kind: "overlay", order: 1, muted: false, locked: false, clips: [
      { ...project.tracks[0]!.clips[0]!, id: "over", timelineStart: 10, sourceOut: 20 },
    ] });
    const before = JSON.stringify(project);
    const plan = buildRenderPlan(project);
    expect(plan.segments.map((segment) => [segment.startFrame, segment.durationFrames])).toEqual([[0, 10], [10, 10], [20, 10]]);
    for (const segment of plan.segments) {
      if (segment.kind !== "clip") throw new Error("Expected visual segments.");
      for (const layer of segment.layers) {
        expect(layer.crop).toEqual(crop);
        expect(layer.speed).toBe(2);
        expect(layer.audioMuted).toBeUndefined();
        expect(layer.clipOffsetFrames).toBe(segment.startFrame - (layer.clipId === "over" ? 10 : 0));
      }
    }
    expect(JSON.stringify(project)).toBe(before);
  });

  it("preserves older projects without inserting a crop default", () => {
    const project = fixture();
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(reopened).toEqual(project);
    expect(reopened.tracks[0]!.clips[0]).not.toHaveProperty("crop");
    expect(validateProject(reopened)).toBeNull();
  });

  it.each([
    { left: 0, top: 0, right: 0, bottom: 0 },
    crop,
    { left: 0.9, top: 0.9, right: 0.049, bottom: 0.049 },
  ])("accepts bounded crop insets %j", (value) => {
    expect(ClipCropSchema.parse(value)).toEqual(value);
    expect(CommandSchema.parse({ type: "SetClipCrop", clipId: "c", crop: value }))
      .toEqual({ type: "SetClipCrop", clipId: "c", crop: value });
  });

  it.each([
    { ...crop, left: -0.01 },
    { ...crop, top: 0.91 },
    { ...crop, right: Number.NaN },
    { ...crop, bottom: Number.POSITIVE_INFINITY },
    { ...crop, left: 0.5, right: 0.45 },
    { ...crop, top: 0.5, bottom: 0.45 },
    { ...crop, left: 0.9, right: 0.1 },
  ])("rejects invalid crops in schemas, saved projects, insertion and direct commands %j", (value) => {
    const project = fixture();
    const before = fixture();
    const clip = { ...project.tracks[0]!.clips[0]!, crop: value };
    expect(ClipCropSchema.safeParse(value).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "SetClipCrop", clipId: "c", crop: value }).success).toBe(false);
    expect(applyCommands(project, [{ type: "SetClipCrop", clipId: "c", crop: value }]))
      .toMatchObject({ ok: false, error: { code: "INVALID_CROP" } });
    expect(applyCommands(project, [{ type: "RemoveClip", clipId: "c" }, { type: "AddClip", trackId: "t", clip }]))
      .toMatchObject({ ok: false, error: { code: "INVALID_CROP" } });
    expect(project).toEqual(before);
    project.tracks[0]!.clips[0] = clip;
    expect(ProjectSchema.safeParse(project).success).toBe(false);
    expect(validateProject(project)).toMatchObject({ code: "INVALID_CROP" });
  });

  it("rejects incomplete or null crop payloads", () => {
    for (const value of [null, {}, { left: 0, top: 0, right: 0 }]) {
      expect(CommandSchema.safeParse({ type: "SetClipCrop", clipId: "c", crop: value }).success).toBe(false);
    }
  });

  it("saves, reopens, replaces, resets, undoes and redoes without changing other clip data", () => {
    const project = fixture();
    const saved = apply(project, [{ type: "SetClipCrop", clipId: "c", crop }]);
    expect(project).toEqual(fixture());
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(saved.project)));
    expect(reopened.tracks[0]!.clips[0]).toEqual({ ...project.tracks[0]!.clips[0], crop });
    expect(validateProject(reopened)).toBeNull();
    const undone = apply(reopened, saved.inverse);
    expect(undone.project).toEqual(project);
    expect(apply(undone.project, undone.inverse).project).toEqual(reopened);
    const replaced = apply(reopened, [{ type: "SetClipCrop", clipId: "c", crop: { ...crop, left: 0 } }]);
    expect(apply(replaced.project, replaced.inverse).project).toEqual(reopened);
    const reset = apply(reopened, [{ type: "SetClipCrop", clipId: "c" }]);
    expect(reset.project).toEqual(project);
    expect(apply(reset.project, reset.inverse).project).toEqual(reopened);
  });

  it.each(["video", "overlay"] as const)("accepts crop on %s tracks, including during insertion", (kind) => {
    const project = fixture();
    project.tracks[0]!.kind = kind;
    const clip = { ...project.tracks[0]!.clips[0]!, crop };
    const result = apply(project, [{ type: "RemoveClip", clipId: "c" }, { type: "AddClip", trackId: "t", clip }]);
    expect(result.project.tracks[0]!.clips[0]!.crop).toEqual(crop);
    expect(validateProject(result.project)).toBeNull();
  });

  it("rejects missing clips and locked tracks, including resetting", () => {
    const project = fixture();
    expect(applyCommands(project, [{ type: "SetClipCrop", clipId: "missing", crop }]))
      .toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    project.tracks[0]!.locked = true;
    for (const command of [
      { type: "SetClipCrop", clipId: "c", crop },
      { type: "SetClipCrop", clipId: "c" },
    ] satisfies Command[]) {
      expect(applyCommands(project, [command])).toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    }
  });

  it("rejects cropping audio tracks via loading, insertion and commands", () => {
    const project = fixture();
    project.tracks[0]!.kind = "audio";
    for (const command of [
      { type: "SetClipCrop", clipId: "c", crop },
      { type: "SetClipCrop", clipId: "c" },
    ] satisfies Command[]) {
      expect(applyCommands(project, [command])).toMatchObject({ ok: false, error: { code: "INVALID_CROP" } });
    }
    const clip = { ...project.tracks[0]!.clips[0]!, crop };
    expect(applyCommands(project, [{ type: "RemoveClip", clipId: "c" }, { type: "AddClip", trackId: "t", clip }]))
      .toMatchObject({ ok: false, error: { code: "INVALID_CROP" } });
    project.tracks[0]!.clips[0] = clip;
    expect(validateProject(project)).toMatchObject({ code: "INVALID_CROP" });
  });

  it("preserves crop across movement, trim, speed, split and delete with exact Undo", () => {
    const project = apply(fixture(), [{ type: "SetClipCrop", clipId: "c", crop }]).project;
    for (const command of [
      { type: "MoveClip", clipId: "c", timelineStart: 10 },
      { type: "TrimClip", clipId: "c", sourceOut: 30 },
      { type: "SetClipSpeed", clipId: "c", speed: 2 },
      { type: "SplitClip", clipId: "c", frame: 30, newClipId: "right" },
      { type: "RemoveClip", clipId: "c" },
    ] satisfies Command[]) {
      const result = apply(project, [command]);
      for (const clip of result.project.tracks[0]!.clips) expect(clip.crop).toEqual(crop);
      expect(apply(result.project, result.inverse).project).toEqual(project);
    }
  });

  it("does not copy visual crop to split audio", () => {
    const project = apply(fixture(), [{ type: "SetClipCrop", clipId: "c", crop }]).project;
    project.tracks.push({ id: "audio", kind: "audio", order: 1, muted: false, locked: false, clips: [] });
    const result = apply(project, [{ type: "SplitAudio", clipId: "c", audioClipId: "sound", trackId: "audio" }]);
    expect(result.project.tracks[0]!.clips[0]!.crop).toEqual(crop);
    expect(result.project.tracks[1]!.clips[0]).not.toHaveProperty("crop");
    expect(validateProject(result.project)).toBeNull();
    expect(apply(result.project, result.inverse).project).toEqual(project);
  });
});
