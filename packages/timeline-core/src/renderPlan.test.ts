import { describe, expect, it } from "vitest";
import type { Clip, Project, Track } from "@ve/schema";
import { buildRenderPlan, createEmptyProject, planAssetIds } from "./index.js";

const fps = { num: 30, den: 1 };
const clip = (id: string, assetId: string, timelineStart: number, sourceIn: number, sourceOut: number): Clip => ({
  id,
  assetId,
  timelineStart,
  sourceIn,
  sourceOut,
  speed: 1,
  audioLinked: true,
});
const track = (id: string, order: number, clips: Clip[], kind: Track["kind"] = "video"): Track => ({
  id,
  kind,
  order,
  muted: false,
  locked: false,
  clips,
});
const project = (tracks: Track[]): Project => ({
  ...createEmptyProject({ id: "p", name: "p", fps, width: 1280, height: 720 }),
  tracks,
});

describe("buildRenderPlan", () => {
  it("maps speed-adjusted source offsets across visual cuts and independent audio lengths", () => {
    const plan = buildRenderPlan(project([
      track("low", 0, [{ ...clip("slow", "a", 0, 30, 90), speed: 0.5 }]),
      track("top", 1, [{ ...clip("fast", "b", 30, 0, 60), speed: 2 }], "overlay"),
      track("audio", 2, [{ ...clip("music", "m", 15, 60, 180), speed: 4 }], "audio"),
    ]));
    expect(plan.totalFrames).toBe(120);
    const layers = plan.segments.flatMap((s) => s.kind === "clip" ? s.layers : []);
    expect(layers.filter((l) => l.clipId === "slow").map((l) => [l.sourceInFrame, l.speed])).toEqual([[30, 0.5], [45, 0.5], [60, 0.5]]);
    expect(plan.audioClips[0]).toMatchObject({ startFrame: 15, durationFrames: 30, sourceInFrame: 60, speed: 4 });
  });
  it("carries clip transforms across every render segment without changing source offsets", () => {
    const transform = { x: 0.75, y: 0.25, scale: 2, opacity: 0.5 };
    const p = project([
      track("bottom", 0, [{ ...clip("c", "a", 0, 30, 120), transform }]),
      track("top", 1, [clip("b", "b", 30, 0, 30)], "overlay"),
    ]);
    const plan = buildRenderPlan(p);
    const layers = plan.segments.flatMap((segment) => segment.kind === "clip" ? segment.layers.filter((layer) => layer.clipId === "c") : []);
    expect(layers.map((layer) => layer.sourceInFrame)).toEqual([30, 60, 90]);
    expect(layers.every((layer) => layer.transform === transform)).toBe(true);
  });
  it("is empty for an empty timeline", () => {
    expect(buildRenderPlan(project([])).segments).toEqual([]);
    expect(buildRenderPlan(project([track("t", 0, [])])).totalFrames).toBe(0);
  });

  it("maps a single clip to one segment", () => {
    const plan = buildRenderPlan(project([track("t", 0, [clip("c", "a", 0, 30, 90)])]));
    expect(plan.totalFrames).toBe(60);
    expect(plan.segments).toEqual([{
      kind: "clip", assetId: "a", startFrame: 0, durationFrames: 60, sourceInFrame: 30,
      layers: [{ assetId: "a", sourceInFrame: 30, clipId: "c" }],
    }]);
  });

  it("keeps back-to-back clips of the same asset as separate segments", () => {
    const plan = buildRenderPlan(project([track("t", 0, [clip("c1", "a", 0, 0, 30), clip("c2", "a", 30, 30, 60)])]));
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[1]).toMatchObject({ startFrame: 30, sourceInFrame: 30, durationFrames: 30 });
  });

  it("fills leading and middle gaps", () => {
    const plan = buildRenderPlan(project([track("t", 0, [clip("c1", "a", 10, 0, 20), clip("c2", "b", 50, 5, 15)])]));
    expect(plan.segments.map((s) => [s.kind, s.startFrame, s.durationFrames])).toEqual([
      ["gap", 0, 10],
      ["clip", 10, 20],
      ["gap", 30, 20],
      ["clip", 50, 10],
    ]);
    expect(plan.totalFrames).toBe(60);
  });

  it("keeps overlapping visual clips as back-to-front layers", () => {
    const low = track("low", 0, [clip("l", "a", 0, 0, 90)]);
    const high = track("high", 1, [clip("h", "b", 30, 100, 130)]);
    const plan = buildRenderPlan(project([low, high]));
    expect(plan.segments).toEqual([
      { kind: "clip", assetId: "a", startFrame: 0, durationFrames: 30, sourceInFrame: 0,
        layers: [{ assetId: "a", sourceInFrame: 0, clipId: "l" }] },
      { kind: "clip", assetId: "b", startFrame: 30, durationFrames: 30, sourceInFrame: 100,
        layers: [{ assetId: "a", sourceInFrame: 30, clipId: "l" }, { assetId: "b", sourceInFrame: 100, clipId: "h" }] },
      { kind: "clip", assetId: "a", startFrame: 60, durationFrames: 30, sourceInFrame: 60,
        layers: [{ assetId: "a", sourceInFrame: 60, clipId: "l" }] },
    ]);
  });

  it("includes audio clips in usage and extends the timeline beyond visual footage", () => {
    const plan = buildRenderPlan(
      project([track("v", 0, [clip("c", "a", 5, 0, 40)]), track("au", 1, [clip("x", "m", 0, 0, 500)], "audio")]),
    );
    expect(plan.totalFrames).toBe(500);
    expect(plan.segments.reduce((n, s) => n + s.durationFrames, 0)).toBe(plan.totalFrames);
    expect(plan.audioClips).toEqual([{ assetId: "m", clipId: "x", startFrame: 0, durationFrames: 500, sourceInFrame: 0 }]);
    expect(planAssetIds(plan)).toEqual(["a", "m"]);
  });

  it("renders a black visual bed for audio-only timelines and keeps muted audio length", () => {
    const muted = { ...track("au", 0, [clip("x", "m", 15, 0, 60)], "audio"), muted: true };
    const plan = buildRenderPlan(project([muted]));
    expect(plan.totalFrames).toBe(75);
    expect(plan.segments).toEqual([{ kind: "gap", startFrame: 0, durationFrames: 75 }]);
    expect(plan.audioClips).toEqual([]);
    expect(planAssetIds(plan)).toEqual([]);
  });

  it("includes every overlapping layer in compositing order and asset usage", () => {
    const plan = buildRenderPlan(project([
      track("bottom", 0, [clip("b", "background", 0, 0, 60)]),
      track("top", 1, [clip("t", "still", 15, 0, 30)], "overlay"),
    ]));
    expect(plan.segments[1]).toMatchObject({
      kind: "clip",
      startFrame: 15,
      durationFrames: 30,
      layers: [
        { assetId: "background", sourceInFrame: 15 },
        { assetId: "still", sourceInFrame: 0 },
      ],
    });
    expect(planAssetIds(plan)).toEqual(["background", "still"]);
  });
});
