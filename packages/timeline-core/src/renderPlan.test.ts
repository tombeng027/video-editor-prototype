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
  it("is empty for an empty timeline", () => {
    expect(buildRenderPlan(project([])).segments).toEqual([]);
    expect(buildRenderPlan(project([track("t", 0, [])])).totalFrames).toBe(0);
  });

  it("maps a single clip to one segment", () => {
    const plan = buildRenderPlan(project([track("t", 0, [clip("c", "a", 0, 30, 90)])]));
    expect(plan.totalFrames).toBe(60);
    expect(plan.segments).toEqual([{ kind: "clip", assetId: "a", startFrame: 0, durationFrames: 60, sourceInFrame: 30 }]);
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

  it("lets the highest-order track win and splits the lower clip around it", () => {
    const low = track("low", 0, [clip("l", "a", 0, 0, 90)]);
    const high = track("high", 1, [clip("h", "b", 30, 100, 130)]);
    const plan = buildRenderPlan(project([low, high]));
    expect(plan.segments).toEqual([
      { kind: "clip", assetId: "a", startFrame: 0, durationFrames: 30, sourceInFrame: 0 },
      { kind: "clip", assetId: "b", startFrame: 30, durationFrames: 30, sourceInFrame: 100 },
      { kind: "clip", assetId: "a", startFrame: 60, durationFrames: 30, sourceInFrame: 60 },
    ]);
  });

  it("ignores audio tracks and covers the segments exactly", () => {
    const plan = buildRenderPlan(
      project([track("v", 0, [clip("c", "a", 5, 0, 40)]), track("au", 1, [clip("x", "m", 0, 0, 500)], "audio")]),
    );
    expect(plan.totalFrames).toBe(45);
    expect(plan.segments.reduce((n, s) => n + s.durationFrames, 0)).toBe(plan.totalFrames);
    expect(planAssetIds(plan)).toEqual(["a"]);
  });
});
