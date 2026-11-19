import { z } from "zod";

export const CaptionCueSchema = z.object({
  id: z.string().min(1),
  start: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  end: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  text: z.string().max(2000).refine((text) => text.trim().length > 0, "Caption text must not be blank."),
}).refine((cue) => cue.start < cue.end, "Caption start must be before its exclusive end.");
export type CaptionCue = z.infer<typeof CaptionCueSchema>;

/** One timeline-fixed lane; adjacent cues are allowed, overlapping cues are not. */
export function captionCuesError(cues: CaptionCue[]): string | null {
  const ids = new Set<string>();
  for (const cue of cues) {
    if (!CaptionCueSchema.safeParse(cue).success) return "Captions need nonblank text (up to 2000 characters) and safe whole-frame timing with start before end.";
    if (ids.has(cue.id)) return "Caption cue IDs must be unique.";
    ids.add(cue.id);
  }
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) return "Caption cues cannot overlap on the caption lane.";
  }
  return null;
}
