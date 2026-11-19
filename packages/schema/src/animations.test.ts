import { describe, expect, it } from "vitest";
import { ANIMATION_CATALOG, animationDurationError, animationEnvelopes, animationFrames, animatedTransform, ClipAnimationsSchema,
  NORMAL_TRANSFORM, rescaleAnimation } from "./animations.js";
import { ClipSchema, ProjectSchema } from "./project.js";

describe("animation catalog", () => {
  it("has five versioned options per end, stable unique IDs and a half-second default", () => {
    expect(ANIMATION_CATALOG.filter((item) => item.phase === "entrance")).toHaveLength(5);
    expect(ANIMATION_CATALOG.filter((item) => item.phase === "exit")).toHaveLength(5);
    expect(new Set(ANIMATION_CATALOG.map((item) => item.id)).size).toBe(10);
    for (const item of ANIMATION_CATALOG) {
      expect(item.version).toBe(1);
      expect(item.defaultSeconds).toBe(0.5);
      expect(item.description.length).toBeGreaterThan(10);
    }
  });
  it("rejects unknown IDs, versions, wrong phases and one-frame effects", () => {
    for (const entrance of [
      { id: "entrance.new", version: 1, durationFrames: 15 },
      { id: "entrance.fade", version: 2, durationFrames: 15 },
      { id: "exit.fade", version: 1, durationFrames: 15 },
      { id: "entrance.fade", version: 1, durationFrames: 1 },
    ]) expect(ClipAnimationsSchema.safeParse({ entrance }).success).toBe(false);
    expect(animationDurationError({ entrance: { id: "entrance.fade", version: 1, durationFrames: 15 },
      exit: { id: "exit.fade", version: 1, durationFrames: 15 } }, 29)).toContain("cannot exceed");
  });
  it("keeps all effects at saved appearance between animation windows and has exact endpoints", () => {
    const base = { x: 0.7, y: 0.4, scale: 1.5, opacity: 0.6 };
    for (const item of ANIMATION_CATALOG) {
      const animations = ClipAnimationsSchema.parse({ [item.phase]: { id: item.id, version: 1, durationFrames: 15 } });
      expect(animatedTransform(animations, 60, item.phase === "entrance" ? 14 : 45, base)).toEqual(base);
      const away = animatedTransform(animations, 60, item.phase === "entrance" ? 0 : 59, base);
      if (item.effect === "fade") expect(away.opacity).toBe(0);
      if (item.effect === "zoom") expect(away.scale).toBeCloseTo(1.2);
      if (item.effect === "left") expect(away.x + away.scale / 2).toBeCloseTo(0);
      if (item.effect === "right") expect(away.x - away.scale / 2).toBeCloseTo(1);
      if (item.effect === "down") expect(away.y - away.scale / 2).toBeCloseTo(1);
    }
    expect(animatedTransform(undefined, 60, 0)).toEqual(NORMAL_TRANSFORM);
  });
  it("uses smoothstep at frame endpoints with non-overlapping windows", () => {
    const animations = ClipAnimationsSchema.parse({
      entrance: { id: "entrance.fade", version: 1, durationFrames: 5 },
      exit: { id: "exit.zoom", version: 1, durationFrames: 5 },
    });
    expect(animatedTransform(animations, 10, 1).opacity).toBe(0.15625);
    expect(animatedTransform(animations, 10, 2).opacity).toBe(0.5);
    expect(animatedTransform(animations, 10, 4)).toEqual(NORMAL_TRANSFORM);
    expect(animatedTransform(animations, 10, 5)).toEqual(NORMAL_TRANSFORM);
    expect(animatedTransform(animations, 10, 9).scale).toBe(0.8);
  });
  it("retains saved animation data in clip/project schemas while older clips remain compatible", () => {
    const clip = { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true };
    expect(ClipSchema.parse(clip)).toEqual(clip);
    const animations = { entrance: { id: "entrance.fade", version: 1, durationFrames: 15 } };
    expect(ClipSchema.parse({ ...clip, animations }).animations).toEqual(animations);
    expect(ProjectSchema.shape.tracks.element.shape.clips.element.shape.animations).toBeDefined();
  });
  it("resolves percentage lengths against the clip, caps the combined share and skips effects too short to show", () => {
    for (const durationPercent of [0, -1, 100.5, Number.NaN]) {
      expect(ClipAnimationsSchema.safeParse({ entrance: { id: "entrance.fade", version: 1, durationPercent } }).success).toBe(false);
    }
    expect(ClipAnimationsSchema.safeParse({ entrance: { id: "entrance.fade", version: 1, durationPercent: 10, durationFrames: 4 } }).success).toBe(false);
    const over = { entrance: { id: "entrance.fade", version: 1, durationPercent: 60 }, exit: { id: "exit.fade", version: 1, durationPercent: 41 } } as const;
    expect(animationDurationError(over, 60)).toContain("100%");
    const animations = ClipAnimationsSchema.parse({
      entrance: { id: "entrance.fade", version: 1, durationPercent: 25 },
      exit: { id: "exit.zoom", version: 1, durationPercent: 75 },
    });
    expect(animationFrames(animations, 60)).toEqual({ entrance: 15, exit: 45 });
    // Rounding cannot push the two windows past the clip: the exit yields.
    expect(animationFrames({ entrance: { id: "entrance.fade", version: 1, durationPercent: 50.5 },
      exit: { id: "exit.fade", version: 1, durationPercent: 49.5 } }, 3)).toEqual({ entrance: 2, exit: 1 });
    expect(animationDurationError(animations, 1)).toBeUndefined();
    expect(animatedTransform(animations, 120, 29).opacity).toBe(1);
    expect(animatedTransform(animations, 120, 0).opacity).toBe(0);
    expect(animationEnvelopes({ entrance: { id: "entrance.fade", version: 1, durationPercent: 1 } }, 60)).toEqual([]);
    expect(rescaleAnimation({ id: "entrance.fade", version: 1, durationPercent: 20 }, 60, 30)).toEqual({ id: "entrance.fade", version: 1, durationPercent: 40 });
    expect(rescaleAnimation({ id: "entrance.fade", version: 1, durationPercent: 80 }, 60, 30).durationPercent).toBe(100);
  });
});
