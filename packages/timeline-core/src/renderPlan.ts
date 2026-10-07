import type { Project, Rational } from "@ve/schema";
import { clipEnd } from "./reducer.js";

export type RenderSegment =
  | { kind: "clip"; assetId: string; startFrame: number; durationFrames: number; sourceInFrame: number }
  | { kind: "gap"; startFrame: number; durationFrames: number };

export type RenderPlan = {
  fps: Rational;
  width: number;
  height: number;
  totalFrames: number;
  segments: RenderSegment[];
};

/**
 * Flattens the timeline into back-to-back segments, the same way the preview picks what to show:
 * at each frame the highest-order non-audio track wins, and uncovered stretches become gaps.
 * Audio-track clips are not rendered yet, matching the preview.
 */
export function buildRenderPlan(project: Project): RenderPlan {
  const tracks = project.tracks.filter((t) => t.kind !== "audio").sort((a, b) => b.order - a.order);
  const clips = tracks.flatMap((t) => t.clips.map((clip) => ({ clip, rank: tracks.indexOf(t) })));
  const base = {
    fps: project.settings.fps,
    width: project.settings.width,
    height: project.settings.height,
  };
  if (clips.length === 0) return { ...base, totalFrames: 0, segments: [] };

  const totalFrames = Math.max(...clips.map(({ clip }) => clipEnd(clip)));
  const cuts = [...new Set([0, totalFrames, ...clips.flatMap(({ clip }) => [clip.timelineStart, clipEnd(clip)])])].sort(
    (a, b) => a - b,
  );

  const segments: RenderSegment[] = [];
  let currentClipId: string | null = null;
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    const top = clips
      .filter(({ clip }) => clip.timelineStart <= start && clipEnd(clip) >= end)
      .sort((a, b) => a.rank - b.rank)[0]?.clip;
    const last = segments[segments.length - 1];
    if (!top) {
      if (last?.kind === "gap") last.durationFrames += end - start;
      else segments.push({ kind: "gap", startFrame: start, durationFrames: end - start });
      currentClipId = null;
    } else if (last?.kind === "clip" && currentClipId === top.id) {
      last.durationFrames += end - start;
    } else {
      segments.push({
        kind: "clip",
        assetId: top.assetId,
        startFrame: start,
        durationFrames: end - start,
        sourceInFrame: top.sourceIn + (start - top.timelineStart),
      });
      currentClipId = top.id;
    }
  }
  return { ...base, totalFrames, segments };
}

/** Ids of the assets a plan needs, in first-use order. */
export function planAssetIds(plan: RenderPlan): string[] {
  return [...new Set(plan.segments.flatMap((s) => (s.kind === "clip" ? [s.assetId] : [])))];
}
