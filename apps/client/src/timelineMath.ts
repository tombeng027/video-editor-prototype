import type { Rational } from "@ve/schema";
import { formatTimecode } from "@ve/timeline-core";

export const MIN_ZOOM = 10;
export const MAX_ZOOM = 400;
export const DEFAULT_ZOOM = 60;

export const clampZoom = (pxPerSecond: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pxPerSecond));

export const framesToPx = (frames: number, fps: Rational, pxPerSecond: number): number =>
  (frames * fps.den * pxPerSecond) / fps.num;

/** Nearest whole frame for a pixel offset, never negative. */
export const pxToFrame = (px: number, fps: Rational, pxPerSecond: number): number =>
  Math.max(0, Math.round((px * fps.num) / (fps.den * pxPerSecond)));

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

export type Tick = { seconds: number; px: number; label: string };

/** Ruler ticks whose spacing is at least `minGapPx`, labelled with the whole-second timecode. */
export function rulerTicks(totalSeconds: number, fps: Rational, pxPerSecond: number, minGapPx = 70): Tick[] {
  const step = STEPS.find((s) => s * pxPerSecond >= minGapPx) ?? STEPS[STEPS.length - 1]!;
  const ticks: Tick[] = [];
  for (let s = 0; s <= totalSeconds; s += step) {
    ticks.push({ seconds: s, px: s * pxPerSecond, label: formatTimecode(Math.round((s * fps.num) / fps.den), fps).slice(3, 8) });
  }
  return ticks;
}
