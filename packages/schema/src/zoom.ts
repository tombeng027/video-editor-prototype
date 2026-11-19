import { z } from "zod";

export const ZOOM_SCALE_MIN = 0.25;
export const ZOOM_SCALE_MAX = 4;
const scale = z.number().min(ZOOM_SCALE_MIN).max(ZOOM_SCALE_MAX);

/**
 * A two-point zoom: the clip holds `startScale` until `startPercent` of its length, eases smoothly to
 * `endScale` at `endPercent`, then holds. Scales multiply the saved appearance zoom around its center.
 * Points normally sit within 0–100; a split can leave one outside so each half keeps the exact motion.
 */
export const ClipZoomSchema = z.strictObject({
  version: z.literal(1),
  startPercent: z.number().finite(),
  endPercent: z.number().finite(),
  startScale: scale,
  endScale: scale,
}).refine((zoom) => zoom.startPercent < zoom.endPercent, { message: "The zoom start point must come before its end point." });
export type ClipZoom = z.infer<typeof ClipZoomSchema>;

/** Zoom multiplier at a clip-local frame. Shared by preview and FFmpeg expressions. */
export function zoomFactor(zoom: ClipZoom | undefined, clipFrames: number, frame: number): number {
  if (!zoom) return 1;
  const start = clipFrames * zoom.startPercent / 100;
  const end = clipFrames * zoom.endPercent / 100;
  const p = Math.min(1, Math.max(0, (frame - start) / (end - start)));
  return zoom.startScale + (zoom.endScale - zoom.startScale) * p * p * (3 - 2 * p);
}

/** FFmpeg expression for `zoomFactor`; `frame` is the clip-local frame expression. */
export function zoomExpression(zoom: ClipZoom, clipFrames: number, frame: string): string {
  const start = clipFrames * zoom.startPercent / 100;
  const end = clipFrames * zoom.endPercent / 100;
  const p = `clip(((${frame})-(${start}))/${end - start},0,1)`;
  return `(${zoom.startScale}+${zoom.endScale - zoom.startScale}*(${p})*(${p})*(3-2*(${p})))`;
}

/** The larger of the two scales, used so slide animations still clear the canvas while zoomed. */
export function zoomReach(zoom: ClipZoom | undefined): number {
  return zoom ? Math.max(zoom.startScale, zoom.endScale, 1) : 1;
}

function rebase(zoom: ClipZoom, clipFrames: number, offset: number, frames: number): ClipZoom | undefined {
  const startPercent = (clipFrames * zoom.startPercent / 100 - offset) / frames * 100;
  const endPercent = (clipFrames * zoom.endPercent / 100 - offset) / frames * 100;
  // A half that never reaches the eased stretch only holds one scale.
  const held = endPercent <= 0 ? zoom.endScale : startPercent >= 100 ? zoom.startScale : undefined;
  if (held === undefined) return { ...zoom, startPercent, endPercent };
  return held === 1 ? undefined : { version: 1, startPercent: 0, endPercent: 100, startScale: held, endScale: held };
}

/** Splits a zoom at a clip-local frame so both halves show exactly the same scale per frame as before. */
export function splitZoom(zoom: ClipZoom, clipFrames: number, offset: number): [ClipZoom | undefined, ClipZoom | undefined] {
  return [rebase(zoom, clipFrames, 0, offset), rebase(zoom, clipFrames, offset, clipFrames - offset)];
}
