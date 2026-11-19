import { ClipCropSchema, type ClipCrop } from "@ve/schema";

export type CropMode = "free" | "locked";
export type CropSide = keyof ClipCrop;
export const NO_CROP: ClipCrop = { left: 0, top: 0, right: 0, bottom: 0 };
export type CropControls = {
  active: boolean;
  mode: CropMode;
  draft?: { clipId: string; crop: ClipCrop } | null;
  offline?: ReadonlySet<string>;
  onActive: (active: boolean) => void;
  onMode: (mode: CropMode) => void;
  onDraft: (clipId: string, crop: ClipCrop | null) => void;
  onCommit: (clipId: string, crop?: ClipCrop) => void;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const tidy = (n: number) => Number(n.toFixed(12));
export function canLockCrop(media: { width: number; height: number }, frame: { width: number; height: number }): boolean {
  const ratio = frame.width * media.height / (frame.height * media.width);
  return Number.isFinite(ratio) && ratio >= 0.051 && ratio <= 1 / 0.051;
}

/** Locked mode adjusts the other dimension around its current source center. */
export function editCrop(crop: ClipCrop, side: CropSide, value: number, mode: CropMode,
  media: { width: number; height: number }, frame: { width: number; height: number }): ClipCrop {
  const opposite = { left: "right", right: "left", top: "bottom", bottom: "top" } as const;
  const next = { ...crop, [side]: tidy(clamp(value, 0, Math.min(0.9, 0.949 - crop[opposite[side]]))) };
  if (mode === "free") return ClipCropSchema.parse(next);
  const ratio = frame.width * media.height / (frame.height * media.width);
  const horizontal = side === "left" || side === "right";
  if (!canLockCrop(media, frame)) throw new RangeError("The project aspect ratio cannot fit within the crop limits for this source.");
  let w = horizontal ? 1 - next.left - next.right : (1 - next.top - next.bottom) * ratio;
  // Both dimensions must keep >5%, and no edge may discard more than 90%.
  const minW = Math.max(0.051, 0.051 * ratio), maxW = Math.min(1, ratio);
  w = clamp(w, minW, maxW);
  const h = w / ratio;
  const cx = clamp((1 + next.left - next.right) / 2, Math.max(w / 2, 0.1 - w / 2), Math.min(1 - w / 2, 0.9 + w / 2));
  const cy = clamp((1 + next.top - next.bottom) / 2, Math.max(h / 2, 0.1 - h / 2), Math.min(1 - h / 2, 0.9 + h / 2));
  const edge = (n: number) => tidy(clamp(n, 0, 0.9));
  return ClipCropSchema.parse({ left: edge(cx - w / 2), right: edge(1 - cx - w / 2),
    top: edge(cy - h / 2), bottom: edge(1 - cy - h / 2) });
}
