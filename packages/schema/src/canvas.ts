import { NORMAL_TRANSFORM } from "./animations.js";
import type { ClipCrop, Transform } from "./project.js";

/** A rectangle in fractions of the output frame: 0,0 is the top-left corner and 1,1 the bottom-right. */
export type CanvasRect = { left: number; top: number; width: number; height: number };

type Size = { width: number | null; height: number | null };

export const CANVAS_ASPECT_PRESETS = [
  { label: "16:9", width: 16, height: 9 },
  { label: "9:16", width: 9, height: 16 },
  { label: "1:1", width: 1, height: 1 },
  { label: "4:3", width: 4, height: 3 },
] as const;

/** Retains the long edge where possible, using exact-ratio, even dimensions for H.264. */
export function canvasSizeForAspect(frame: { width: number; height: number }, preset: (typeof CANVAS_ASPECT_PRESETS)[number]) {
  const units = Math.max(1, Math.floor(Math.max(frame.width, frame.height) / (2 * Math.max(preset.width, preset.height))));
  return { width: preset.width * units * 2, height: preset.height * units * 2 };
}

/** Source-relative crop window. Known dimensions use whole source pixels, matching FFmpeg's exact crop. */
export function cropWindow(crop: ClipCrop, media?: Size): CanvasRect {
  const width = media?.width, height = media?.height;
  return {
    left: width ? Math.floor(width * crop.left) / width : crop.left,
    top: height ? Math.floor(height * crop.top) / height : crop.top,
    width: width ? Math.max(1, Math.floor(width * (1 - crop.left - crop.right))) / width : 1 - crop.left - crop.right,
    height: height ? Math.max(1, Math.floor(height * (1 - crop.top - crop.bottom))) / height : 1 - crop.top - crop.bottom,
  };
}

/** Fit the original source, then trim its edges without enlarging the retained picture. */
export function fittedSize(frame: { width: number; height: number }, media?: Size, crop?: ClipCrop): { width: number; height: number } {
  const window = crop ? cropWindow(crop, media) : { width: 1, height: 1 };
  if (!media?.width || !media.height) return { width: window.width, height: window.height };
  const fit = Math.min(frame.width / media.width, frame.height / media.height);
  return { width: media.width * fit / frame.width * window.width, height: media.height * fit / frame.height * window.height };
}

/**
 * The transform stays anchored to the original source center; asymmetric crop only trims visible bounds.
 */
export function clipCanvasRect(transform: Transform | undefined, frame: { width: number; height: number }, media?: Size, crop?: ClipCrop): CanvasRect {
  const t = transform ?? NORMAL_TRANSFORM;
  const fitted = fittedSize(frame, media, crop);
  const width = fitted.width * t.scale, height = fitted.height * t.scale;
  const source = fittedSize(frame, media);
  const window = crop ? cropWindow(crop, media) : { left: 0, top: 0 };
  return { left: t.x + (window.left - 0.5) * source.width * t.scale,
    top: t.y + (window.top - 0.5) * source.height * t.scale, width, height };
}
