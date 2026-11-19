import { describe, expect, it } from "vitest";
import { animatedTransform, clipCanvasRect, type Asset, type Clip, type Project } from "@ve/schema";
import { applyCommands, createEmptyProject } from "@ve/timeline-core";
import { canvasTransformToBase, fitToCanvasTransform, snapMove, snapScale, snapTargets, topmostAt } from "./canvasEdit.js";
import { planLayerClip, type LayerAction } from "./timelineOps.js";

const fps = { num: 30, den: 1 };
const asset: Asset = {
  id: "a", kind: "video", name: "a.mp4", mediaMode: "reference", sourcePath: "C:/a.mp4", contentHash: "h",
  durationFrames: 300, fps, width: 1280, height: 720, hasAudio: false, proxyPath: null,
};
const clip = (id: string, start: number, end: number) =>
  ({ id, assetId: "a", timelineStart: start, sourceIn: 0, sourceOut: end - start, speed: 1, audioLinked: true });

function project(layout: Record<string, Array<[string, number, number]>>): Project {
  const result = createEmptyProject({ id: "p", name: "P", fps, width: 1920, height: 1080 });
  result.assets = [asset];
  result.tracks = Object.entries(layout).map(([id, clips], order) => ({
    id, kind: order === 0 ? "video" : "overlay", order, muted: false, locked: false,
    clips: clips.map(([clipId, start, end]) => clip(clipId, start, end)),
  }));
  return result;
}

/** Visual track ids back to front, each with its clip ids. */
function stack(p: Project) {
  return p.tracks.filter((track) => track.kind !== "audio").sort((a, b) => a.order - b.order)
    .map((track) => `${track.id}:${track.clips.map((c) => c.id).join(",")}`);
}

function layer(p: Project, clipId: string, action: LayerAction) {
  const plan = planLayerClip(p, clipId, action, (prefix) => `${prefix}_new`);
  if (!plan.ok) return plan.message;
  const result = applyCommands(p, plan.commands);
  if (!result.ok) throw new Error(result.error.message);
  return stack(result.project);
}

describe("canvas geometry", () => {
  it("fits appearance while preserving opacity, crop and effects through the existing command and Undo", () => {
    const p = project({ base: [["c", 0, 90]] });
    const selected = p.tracks[0]!.clips[0]!;
    selected.transform = { x: 0.8, y: 0.2, scale: 2, opacity: 0.4 };
    selected.crop = { left: 0.1, top: 0, right: 0, bottom: 0 };
    selected.zoom = { version: 1, startPercent: 0, endPercent: 100, startScale: 1, endScale: 2 };
    selected.animations = { entrance: { id: "entrance.fade", version: 1, durationFrames: 15 } };
    const transform = fitToCanvasTransform(selected);
    expect(transform).toEqual({ x: 0.5, y: 0.5, scale: 1, opacity: 0.4 });
    const result = applyCommands(p, [{ type: "SetClipTransform", clipId: "c", transform }]);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.project.tracks[0]!.clips[0]).toEqual({ ...selected, transform });
    const undone = applyCommands(result.project, result.inverse);
    expect(undone).toMatchObject({ ok: true, project: p });
    if (!undone.ok) throw new Error(undone.error.message);
    expect(applyCommands(undone.project, undone.inverse)).toMatchObject({ ok: true, project: result.project });
    expect(fitToCanvasTransform(clip("new", 0, 90))).toEqual({ x: 0.5, y: 0.5, scale: 1, opacity: 1 });
  });

  it("maps animated zoom and slide geometry back to appearance without baking animation into it", () => {
    const saved: Clip = {
      ...clip("c", 0, 90), transform: { x: 0.6, y: 0.4, scale: 0.5, opacity: 0.8 },
      animations: { entrance: { id: "entrance.slide-left", version: 1, durationFrames: 30 } },
      zoom: { version: 1, startPercent: 0, endPercent: 100, startScale: 1, endScale: 2 },
    };
    for (const frame of [7, 29, 45, 89]) {
      const displayed = animatedTransform(saved.animations, 90, frame, saved.transform, saved.zoom);
      const desired = { ...displayed, x: displayed.x + 0.1, y: displayed.y - 0.05, scale: displayed.scale * 1.2 };
      const base = canvasTransformToBase(saved, frame, desired)!;
      const actual = animatedTransform(saved.animations, 90, frame, base, saved.zoom);
      expect(actual.x).toBeCloseTo(desired.x);
      expect(actual.y).toBeCloseTo(desired.y);
      expect(actual.scale).toBeCloseTo(desired.scale);
      expect(base.opacity).toBe(0.8);
    }
    const start = animatedTransform(saved.animations, 90, 0, saved.transform, saved.zoom);
    expect(canvasTransformToBase(saved, 0, start)).toBeNull();
  });

  it("fits media inside the frame, then scales around the center at x/y", () => {
    expect(clipCanvasRect(undefined, { width: 1920, height: 1080 }, { width: 1280, height: 720 }))
      .toEqual({ left: 0, top: 0, width: 1, height: 1 });
    const square = clipCanvasRect({ x: 0.75, y: 0.5, scale: 0.5, opacity: 1 }, { width: 1600, height: 900 }, { width: 80, height: 80 });
    expect(square.width).toBeCloseTo(0.28125);
    expect(square.height).toBeCloseTo(0.5);
    expect(square.left).toBeCloseTo(0.609375);
    expect(square.top).toBeCloseTo(0.25);
  });

  it("picks the top-most picture under the pointer", () => {
    const back = { left: 0, top: 0, width: 1, height: 1 }, front = { left: 0.5, top: 0.5, width: 0.25, height: 0.25 };
    expect(topmostAt([back, front], { x: 0.6, y: 0.6 })).toBe(1);
    expect(topmostAt([back, front], { x: 0.1, y: 0.1 })).toBe(0);
    expect(topmostAt([front], { x: 0.1, y: 0.1 })).toBe(-1);
  });
});

describe("snapping guides", () => {
  const threshold = { x: 0.01, y: 0.01 };
  it("snaps asymmetric cropped edges around the original source center after leaving Crop", () => {
    const rect = clipCanvasRect({ x: 0, y: 0, scale: 1, opacity: 1 }, { width: 640, height: 360 },
      { width: 640, height: 360 }, { left: 0.3, right: 0, top: 0.1, bottom: 0 });
    const result = snapScale({ x: 0.5, y: 0.5 },
      { x: rect.width / 2, y: rect.height / 2, left: rect.left, top: rect.top }, 0.995, { x: [1], y: [] }, threshold);
    expect(result.scale).toBeCloseTo(1);
    expect(result.guides.x).toBe(1);
  });
  it("snaps the closest edge or center to the frame and other pictures", () => {
    const other = { left: 0.6, top: 0.1, width: 0.2, height: 0.2 };
    const snapped = snapMove({ left: 0.595, top: 0.393, width: 0.2, height: 0.2 }, snapTargets([other]), threshold);
    expect(snapped.dx).toBeCloseTo(0.005);
    expect(snapped.guides.x).toBeCloseTo(0.6);
    expect(snapped.dy).toBeCloseTo(0.007);
    expect(snapped.guides.y).toBe(0.5);
    const free = snapMove({ left: 0.23, top: 0.33, width: 0.1, height: 0.1 }, snapTargets([]), threshold);
    expect(free).toEqual({ dx: 0, dy: 0, guides: { x: null, y: null } });
  });

  it("snaps a centered resize so an edge meets a guide", () => {
    const result = snapScale({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.995, snapTargets([]), threshold);
    expect(result.scale).toBeCloseTo(1);
    expect([0, 1]).toContain(result.guides.x);
    expect(snapScale({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.7, snapTargets([]), threshold))
      .toEqual({ scale: 0.7, guides: { x: null, y: null } });
  });
});

describe("layer order from the canvas", () => {
  it("moves a picture to the free track just in front of the picture it overlaps", () => {
    const p = project({ base: [["bg", 0, 90]], mid: [["m", 0, 90]], top: [] });
    expect(layer(p, "bg", "forward")).toEqual(["base:", "mid:m", "top:bg"]);
    expect(layer(p, "m", "backward")).toEqual(["track_new:m", "base:bg", "mid:", "top:"]);
  });

  it("inserts a new track at that spot when the neighbouring track is busy, as one batch", () => {
    const p = project({ base: [["bg", 0, 90]], mid: [["m", 0, 90]], top: [["t", 0, 90]] });
    expect(layer(p, "bg", "forward")).toEqual(["base:", "mid:m", "track_new:bg", "top:t"]);
    expect(layer(p, "bg", "front")).toEqual(["base:", "mid:m", "top:t", "track_new:bg"]);
    expect(layer(p, "t", "back")).toEqual(["track_new:t", "base:bg", "mid:m", "top:"]);
  });

  it("ignores clips at other times and refuses when nothing is in front or behind", () => {
    const p = project({ base: [["bg", 0, 90]], mid: [["later", 100, 150]], top: [["t", 0, 90]] });
    expect(layer(p, "t", "forward")).toBe("This picture is already in front.");
    expect(layer(p, "bg", "back")).toBe("This picture is already at the back.");
    expect(layer(p, "t", "backward")).toEqual(["track_new:t", "base:bg", "mid:later", "top:"]);
    expect(layer(p, "bg", "forward")).toEqual(["base:", "mid:later", "top:t", "track_new:bg"]);
    expect(planLayerClip(p, "missing", "forward")).toEqual({ ok: false, message: "Select a picture on the canvas first." });
    p.tracks[2]!.locked = true;
    expect(layer(p, "t", "backward")).toBe("Unlock the clip's track first.");
  });
});
