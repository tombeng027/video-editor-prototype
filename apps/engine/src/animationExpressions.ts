import { animationEnvelopes, NORMAL_TRANSFORM, zoomExpression, zoomReach,
  type ClipAnimations, type ClipZoom, type Transform } from "@ve/schema";

/** FFmpeg uses segment-local frame counters; the catalog envelope and zoom stay clip-local. */
export function animationExpressions(animations: ClipAnimations | undefined, clipFrames: number, offset: number,
  frame: string, base: Transform = NORMAL_TRANSFORM, zoom?: ClipZoom) {
  const result = {
    x: String(base.x), y: String(base.y),
    scale: zoom ? `(${base.scale}*${zoomExpression(zoom, clipFrames, `(${frame})+${offset}`)})` : String(base.scale),
    opacity: String(base.opacity),
  };
  for (const envelope of animationEnvelopes(animations, clipFrames, { ...base, scale: base.scale * zoomReach(zoom) })) {
    const p = `clip(((${frame})+${offset}-${envelope.start})/${envelope.end - envelope.start},0,1)`;
    const smooth = `((${p})*(${p})*(3-2*(${p})))`;
    const weight = envelope.entering ? `(1-${smooth})` : smooth;
    for (const key of ["x", "y", "scale", "opacity"] as const) {
      if (envelope[key] === 0) continue;
      result[key] = key === "x" || key === "y"
        ? `(${result[key]}+${envelope[key]}*${weight})`
        : `(${result[key]}*(1+${envelope[key]}*${weight}))`;
    }
  }
  return result;
}
