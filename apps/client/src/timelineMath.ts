import type { Rational } from "@ve/schema";
import { formatTimecode } from "@ve/timeline-core";

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 400;
export const DEFAULT_ZOOM = 60;

export const clampZoom = (pxPerSecond: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pxPerSecond));

export const framesToPx = (frames: number, fps: Rational, pxPerSecond: number): number =>
  (frames * fps.den * pxPerSecond) / fps.num;

/** Nearest whole frame for a pixel offset, never negative. */
export const pxToFrame = (px: number, fps: Rational, pxPerSecond: number): number =>
  Math.max(0, Math.round((px * fps.num) / (fps.den * pxPerSecond)));

export type SnapResult = { startFrame: number; guideFrame: number; distancePx: number };

/** Snaps either edge of a clip to the nearest timeline frame within a pixel tolerance. */
export function snapClipFrame(
  startFrame: number,
  durationFrames: number,
  candidates: readonly number[],
  fps: Rational,
  pxPerSecond: number,
  thresholdPx = 8,
): SnapResult | null {
  let best: SnapResult | null = null;
  for (const guideFrame of candidates) {
    for (const candidateStart of [guideFrame, guideFrame - durationFrames]) {
      if (candidateStart < 0) continue;
      const distancePx = Math.abs(framesToPx(candidateStart - startFrame, fps, pxPerSecond));
      if (distancePx <= thresholdPx && (!best || distancePx < best.distancePx)) {
        best = { startFrame: candidateStart, guideFrame, distancePx };
      }
    }
  }
  return best;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

export type Tick = { seconds: number; px: number; label: string };

/** Ruler ticks whose spacing is at least `minGapPx`, labelled with the whole-second timecode. */
export function rulerTicks(totalSeconds: number, fps: Rational, pxPerSecond: number, minGapPx = 70): Tick[] {
  const step = STEPS.find((s) => s * pxPerSecond >= minGapPx) ?? Math.ceil(minGapPx / (3600 * pxPerSecond)) * 3600;
  const ticks: Tick[] = [];
  for (let s = 0; s <= totalSeconds; s += step) {
    const timecode = formatTimecode(Math.ceil((s * fps.num) / fps.den), fps);
    ticks.push({ seconds: s, px: s * pxPerSecond, label: totalSeconds >= 3600 ? timecode.slice(0, -3) : timecode.slice(3, 8) });
  }
  return ticks;
}
