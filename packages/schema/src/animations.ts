import { z } from "zod";
import type { Transform } from "./project.js";
import { zoomFactor, zoomReach, type ClipZoom } from "./zoom.js";

const EntranceIdSchema = z.enum(["entrance.fade", "entrance.zoom", "entrance.slide-left", "entrance.slide-right", "entrance.rise"]);
const ExitIdSchema = z.enum(["exit.fade", "exit.zoom", "exit.slide-left", "exit.slide-right", "exit.drop"]);
const frames = z.number().int().min(2).max(Number.MAX_SAFE_INTEGER);
const percent = z.number().gt(0).max(100);
// durationPercent rescales with trim/speed; durationFrames is the earlier fixed-length form, still readable.
const end = <T extends z.ZodType>(id: T) => z.union([
  z.strictObject({ id, version: z.literal(1), durationPercent: percent }),
  z.strictObject({ id, version: z.literal(1), durationFrames: frames }),
]);
export const ClipAnimationsSchema = z.strictObject({
  entrance: end(EntranceIdSchema).optional(),
  exit: end(ExitIdSchema).optional(),
}).refine((value) => percentOf(value.entrance) + percentOf(value.exit) <= 100 + 1e-9,
  { message: "Entrance and exit together cannot exceed 100% of the clip." });
function percentOf(saved: { durationPercent: number } | { durationFrames: number } | undefined) {
  return saved && "durationPercent" in saved ? saved.durationPercent : 0;
}
export type ClipAnimations = z.infer<typeof ClipAnimationsSchema>;
export type AnimationId = z.infer<typeof EntranceIdSchema> | z.infer<typeof ExitIdSchema>;
type AnimationDefinition = {
  id: AnimationId; version: 1; phase: "entrance" | "exit"; name: string;
  description: string; effect: "fade" | "zoom" | "left" | "right" | "down";
  defaultSeconds: number;
};
export const ANIMATION_CATALOG: readonly AnimationDefinition[] = [
  { id: "entrance.fade", version: 1, phase: "entrance", name: "Fade in", description: "Smoothly reveal the clip from transparent.", effect: "fade", defaultSeconds: 0.5 },
  { id: "entrance.zoom", version: 1, phase: "entrance", name: "Zoom in", description: "Grow from 80% to the saved clip size.", effect: "zoom", defaultSeconds: 0.5 },
  { id: "entrance.slide-left", version: 1, phase: "entrance", name: "Slide from left", description: "Move from fully outside the left canvas edge.", effect: "left", defaultSeconds: 0.5 },
  { id: "entrance.slide-right", version: 1, phase: "entrance", name: "Slide from right", description: "Move from fully outside the right canvas edge.", effect: "right", defaultSeconds: 0.5 },
  { id: "entrance.rise", version: 1, phase: "entrance", name: "Rise from below", description: "Move up from fully below the canvas.", effect: "down", defaultSeconds: 0.5 },
  { id: "exit.fade", version: 1, phase: "exit", name: "Fade out", description: "Smoothly hide the clip into transparency.", effect: "fade", defaultSeconds: 0.5 },
  { id: "exit.zoom", version: 1, phase: "exit", name: "Zoom out", description: "Shrink from the saved clip size to 80%.", effect: "zoom", defaultSeconds: 0.5 },
  { id: "exit.slide-left", version: 1, phase: "exit", name: "Slide to left", description: "Move fully outside the left canvas edge.", effect: "left", defaultSeconds: 0.5 },
  { id: "exit.slide-right", version: 1, phase: "exit", name: "Slide to right", description: "Move fully outside the right canvas edge.", effect: "right", defaultSeconds: 0.5 },
  { id: "exit.drop", version: 1, phase: "exit", name: "Drop downward", description: "Move fully below the canvas.", effect: "down", defaultSeconds: 0.5 },
];

export const NORMAL_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 1, opacity: 1 };

/** Whole-frame lengths for a clip. Percentages round to frames and the exit yields to the entrance. */
export function animationFrames(animations: ClipAnimations | undefined, clipFrames: number) {
  const length = (saved: ClipAnimations["entrance"] | ClipAnimations["exit"]) => !saved ? 0
    : "durationFrames" in saved ? saved.durationFrames : Math.round(clipFrames * saved.durationPercent / 100);
  const entrance = length(animations?.entrance);
  const exit = animations?.exit && "durationPercent" in animations.exit
    ? Math.max(0, Math.min(length(animations.exit), clipFrames - entrance)) : length(animations?.exit);
  return { entrance, exit };
}

export function animationDurationError(animations: ClipAnimations | undefined, clipFrames: number): string | undefined {
  const parsed = ClipAnimationsSchema.safeParse(animations ?? {});
  if (!parsed.success) {
    return parsed.error.issues.some((issue) => issue.code === "custom")
      ? "Entrance and exit together cannot exceed 100% of the clip."
      : "Choose a listed animation with a supported version and a length from 1% to 100% of the clip.";
  }
  const { entrance, exit } = animationFrames(parsed.data, clipFrames);
  if (entrance + exit > clipFrames) {
    return "Entrance and exit durations together cannot exceed the clip length. Shorten or remove an animation before trimming, splitting or speeding up this clip.";
  }
  return undefined;
}

/** Re-expresses a percentage so the effect keeps its frame length on a shorter split half. */
export function rescaleAnimation<T extends NonNullable<ClipAnimations["entrance"] | ClipAnimations["exit"]>>(
  saved: T, fromFrames: number, toFrames: number): T {
  if (!("durationPercent" in saved) || toFrames <= 0) return saved;
  return { ...saved, durationPercent: Math.min(100, Number((saved.durationPercent * fromFrames / toFrames).toFixed(6))) };
}

/** Shared normalized deltas and frame endpoints for preview and FFmpeg expression generation. */
export function animationEnvelopes(animations: ClipAnimations | undefined, clipFrames: number, base: Transform = NORMAL_TRANSFORM) {
  const lengths = animationFrames(animations, clipFrames);
  return (["entrance", "exit"] as const).flatMap((phase) => {
    const saved = animations?.[phase];
    if (!saved) return [];
    const definition = ANIMATION_CATALOG.find((item) => item.id === saved.id && item.version === saved.version);
    if (!definition) throw new Error("Unsupported animation preset or version.");
    const frames = lengths[phase];
    // A percentage of a very short clip can round below two frames; such an effect is not shown.
    if (frames < 2) return [];
    const start = phase === "entrance" ? 0 : clipFrames - frames;
    return [{
      start, end: start + frames - 1, entering: phase === "entrance",
      x: definition.effect === "left" ? -base.scale / 2 - base.x
        : definition.effect === "right" ? 1 + base.scale / 2 - base.x : 0,
      y: definition.effect === "down" ? 1 + base.scale / 2 - base.y : 0,
      scale: definition.effect === "zoom" ? -0.2 : 0,
      opacity: definition.effect === "fade" ? -1 : 0,
    }];
  });
}

export function animatedTransform(animations: ClipAnimations | undefined, clipFrames: number, frame: number,
  base: Transform = NORMAL_TRANSFORM, zoom?: ClipZoom): Transform {
  const result = { ...base, scale: base.scale * zoomFactor(zoom, clipFrames, frame) };
  for (const envelope of animationEnvelopes(animations, clipFrames, { ...base, scale: base.scale * zoomReach(zoom) })) {
    const p = Math.min(1, Math.max(0, (frame - envelope.start) / (envelope.end - envelope.start)));
    const smooth = p * p * (3 - 2 * p);
    const weight = envelope.entering ? 1 - smooth : smooth;
    result.x += envelope.x * weight;
    result.y += envelope.y * weight;
    result.scale *= 1 + envelope.scale * weight;
    result.opacity *= 1 + envelope.opacity * weight;
  }
  return result;
}
