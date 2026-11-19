import { describe, expect, it } from "vitest";
import { ClipZoomSchema, ProjectSchema, splitZoom, zoomFactor, type ClipZoom, type Command, type Project } from "@ve/schema";
import { applyCommands, clipDuration, validateProject } from "./reducer.js";
import { createEmptyProject } from "./project.js";
import { buildRenderPlan } from "./renderPlan.js";

const zoom: ClipZoom = { version: 1, startPercent: 25, endPercent: 75, startScale: 1, endScale: 2 };
const fixture = (): Project => ({
  ...createEmptyProject({ id: "p", name: "Zoom", fps: { num: 30, den: 1 }, width: 64, height: 64 }),
  assets: [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "test.mp4",
    contentHash: "a", durationFrames: 300, fps: { num: 30, den: 1 }, width: 64, height: 64, hasAudio: false, proxyPath: null }],
  tracks: [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
    { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true },
  ] }],
});
function apply(project: Project, commands: Command[]) {
  const result = applyCommands(project, commands);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("two-point zoom", () => {
  it("holds, eases smoothly and holds again", () => {
    expect(zoomFactor(zoom, 60, 0)).toBe(1);
    expect(zoomFactor(zoom, 60, 15)).toBe(1);
    expect(zoomFactor(zoom, 60, 30)).toBeCloseTo(1.5);
    expect(zoomFactor(zoom, 60, 20)).toBeLessThan(1.5);
    expect(zoomFactor(zoom, 60, 45)).toBe(2);
    expect(zoomFactor(zoom, 60, 59)).toBe(2);
    expect(zoomFactor(undefined, 60, 30)).toBe(1);
    expect(ClipZoomSchema.safeParse({ ...zoom, endPercent: 25 }).success).toBe(false);
    expect(ClipZoomSchema.safeParse({ ...zoom, endScale: 5 }).success).toBe(false);
  });

  it("saves, reopens, undoes, redoes and removes a zoom", () => {
    const p = fixture();
    const result = apply(p, [{ type: "SetClipZoom", clipId: "c", zoom }]);
    expect(result.project.tracks[0]!.clips[0]).toEqual({ ...p.tracks[0]!.clips[0], zoom });
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(result.project)));
    expect(validateProject(reopened)).toBeNull();
    const undone = apply(reopened, result.inverse);
    expect(undone.project).toEqual(p);
    expect(apply(undone.project, undone.inverse).project).toEqual(result.project);
    const removed = apply(result.project, [{ type: "SetClipZoom", clipId: "c" }]);
    expect(removed.project).toEqual(p);
    expect(apply(removed.project, removed.inverse).project).toEqual(result.project);
  });

  it("rejects locked tracks, audio clips and reversed points", () => {
    const p = fixture(); p.tracks[0]!.locked = true;
    expect(applyCommands(p, [{ type: "SetClipZoom", clipId: "c", zoom }])).toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
    p.tracks[0]!.locked = false;
    expect(applyCommands(p, [{ type: "SetClipZoom", clipId: "c", zoom: { ...zoom, startPercent: 80 } }]))
      .toMatchObject({ ok: false, error: { code: "INVALID_ZOOM" } });
    p.tracks[0]!.kind = "audio"; p.assets[0]!.hasAudio = true;
    expect(applyCommands(p, [{ type: "SetClipZoom", clipId: "c", zoom }])).toMatchObject({ ok: false, error: { code: "INVALID_ZOOM" } });
    p.tracks[0]!.clips[0]!.zoom = zoom;
    expect(validateProject(p)).toMatchObject({ code: "INVALID_ZOOM" });
  });

  it("keeps points relative to the clip through trim and speed, with exact Undo", () => {
    const saved = apply(fixture(), [{ type: "SetClipZoom", clipId: "c", zoom }]).project;
    for (const command of [
      { type: "TrimClip", clipId: "c", sourceOut: 30 },
      { type: "SetClipSpeed", clipId: "c", speed: 2 },
    ] satisfies Command[]) {
      const result = apply(saved, [command]);
      expect(result.project.tracks[0]!.clips[0]!.zoom).toEqual(zoom);
      expect(apply(result.project, result.inverse).project).toEqual(saved);
    }
  });

  it("splits with the same scale on every frame, collapsing a half that only holds", () => {
    const saved = apply(fixture(), [{ type: "SetClipZoom", clipId: "c", zoom }]).project;
    for (const frame of [10, 15, 24, 45, 50]) {
      const split = apply(saved, [{ type: "SplitClip", clipId: "c", newClipId: "right", frame }]);
      const [left, right] = split.project.tracks[0]!.clips;
      for (let f = 0; f < 60; f++) {
        const scale = f < frame ? zoomFactor(left!.zoom, clipDuration(left!), f) : zoomFactor(right!.zoom, clipDuration(right!), f - frame);
        expect(scale, `split ${frame} frame ${f}`).toBeCloseTo(zoomFactor(zoom, 60, f), 9);
      }
      expect(split.project.tracks[0]!.clips.every((clip) => !clip.zoom || ClipZoomSchema.safeParse(clip.zoom).success)).toBe(true);
      expect(apply(split.project, split.inverse).project).toEqual(saved);
    }
    expect(splitZoom(zoom, 60, 10)).toEqual([undefined, { ...zoom, startPercent: 10, endPercent: 70 }]);
    expect(splitZoom(zoom, 60, 50)[1]).toEqual({ version: 1, startPercent: 0, endPercent: 100, startScale: 2, endScale: 2 });
  });

  it("passes zoom and clip-local offsets to every render segment", () => {
    const p = fixture(); p.tracks[0]!.clips[0]!.zoom = zoom;
    p.tracks.push({ id: "over", kind: "overlay", order: 1, muted: false, locked: false,
      clips: [{ ...p.tracks[0]!.clips[0]!, id: "top", timelineStart: 20, sourceOut: 10, zoom: undefined }] });
    const plan = buildRenderPlan(p);
    const layers = plan.segments.flatMap((segment) => segment.kind === "clip" ? [segment.layers[0]!] : []);
    expect(layers.map((layer) => [layer.clipOffsetFrames, layer.zoom])).toEqual([[0, zoom], [20, zoom], [30, zoom]]);
    expect(layers[0]!.animations).toBeUndefined();
  });
});
