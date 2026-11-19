import { z } from "zod";
import { ClipAnimationsSchema } from "./animations.js";
import { ClipZoomSchema } from "./zoom.js";
import { CaptionCueSchema } from "./captions.js";

export const SCHEMA_VERSION = 2 as const;

export const RationalSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});
export type Rational = z.infer<typeof RationalSchema>;

const frames = z.number().int().nonnegative();

export const TransformSchema = z.object({
  x: z.number().min(-10).max(10),
  y: z.number().min(-10).max(10),
  scale: z.number().min(0.01).max(10),
  opacity: z.number().min(0).max(1),
});
export type Transform = z.infer<typeof TransformSchema>;

export const ClipCropSchema = z.object({
  left: z.number().min(0).max(0.9),
  top: z.number().min(0).max(0.9),
  right: z.number().min(0).max(0.9),
  bottom: z.number().min(0).max(0.9),
}).refine((crop) => crop.left + crop.right < 0.95 && crop.top + crop.bottom < 0.95, {
  message: "Crop must retain more than 5% of the source width and height.",
});
export type ClipCrop = z.infer<typeof ClipCropSchema>;

export const CanvasSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const AssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "audio", "image"]),
  name: z.string(),
  mediaMode: z.enum(["reference", "copy"]),
  sourcePath: z.string(),
  contentHash: z.string(),
  // Native frames in `fps`; audio uses a 1000/1 (millisecond) timebase;
  // images have fps null and this is the default clip length in project frames.
  durationFrames: z.number().int().positive(),
  fps: RationalSchema.nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  hasAudio: z.boolean(),
  proxyPath: z.string().nullable(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const ClipSpeedSchema = z.number().min(0.25).max(4);
/** Linear gain for the clip's own sound; omitted means 1 (100%). */
export const ClipVolumeSchema = z.number().min(0).max(1);

export const ClipSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  timelineStart: frames,
  sourceIn: frames,
  sourceOut: frames,
  speed: ClipSpeedSchema,
  audioLinked: z.boolean(),
  linkedClipId: z.string().optional(),
  transform: TransformSchema.optional(),
  crop: ClipCropSchema.optional(),
  animations: ClipAnimationsSchema.optional(),
  zoom: ClipZoomSchema.optional(),
  volume: ClipVolumeSchema.optional(),
});
export type Clip = z.infer<typeof ClipSchema>;

export const TrackKindSchema = z.enum(["video", "overlay", "audio"]);
export type TrackKind = z.infer<typeof TrackKindSchema>;
export const TrackNameSchema = z.string().trim().min(1).max(80);

export const TrackSchema = z.object({
  id: z.string().min(1),
  name: TrackNameSchema.optional(),
  kind: TrackKindSchema,
  order: z.number().int().nonnegative(),
  muted: z.boolean(),
  locked: z.boolean(),
  clips: z.array(ClipSchema),
});
export type Track = z.infer<typeof TrackSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  settings: z.object({
    fps: RationalSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fpsFromFirstImport: z.boolean(),
  }),
  assets: z.array(AssetSchema),
  tracks: z.array(TrackSchema),
  captionCues: z.array(CaptionCueSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

const LegacyProjectSchema = ProjectSchema.omit({ captionCues: true }).extend({ schemaVersion: z.literal(1) });

/** Only saved-project loading migrates v1; API payloads must use the current schema. */
export function parseStoredProject(input: unknown):
  | { ok: true; project: Project; migrated: boolean }
  | { ok: false; code: "CORRUPT" | "UNSUPPORTED_PROJECT_VERSION"; message: string } {
  const version = z.object({ schemaVersion: z.number().int() }).safeParse(input);
  if (!version.success) return { ok: false, code: "CORRUPT", message: "Project schema version is missing or invalid." };
  if (version.data.schemaVersion !== 1 && version.data.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, code: "UNSUPPORTED_PROJECT_VERSION", message: `Project schema version ${version.data.schemaVersion} is not supported. Use an app that supports this project version; no files were changed.` };
  }
  if (version.data.schemaVersion === 1) {
    if (typeof input === "object" && input !== null && "captionCues" in input) {
      return { ok: false, code: "CORRUPT", message: "Version-1 projects cannot contain caption cues." };
    }
    const legacy = LegacyProjectSchema.safeParse(input);
    if (!legacy.success) return { ok: false, code: "CORRUPT", message: `Invalid project fields: ${legacy.error.issues[0]?.message}` };
    return { ok: true, migrated: true, project: { ...legacy.data, schemaVersion: SCHEMA_VERSION, captionCues: [] } };
  }
  const current = ProjectSchema.safeParse(input);
  return current.success ? { ok: true, migrated: false, project: current.data }
    : { ok: false, code: "CORRUPT", message: `Invalid project fields: ${current.error.issues[0]?.message}` };
}

export const EditListSchema = z.object({
  sourceAssetId: z.string().min(1),
  segments: z.array(
    z.object({
      sourceIn: frames,
      sourceOut: frames,
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type EditList = z.infer<typeof EditListSchema>;

export const CandidateSchema = z.object({
  id: z.string().min(1),
  sourceAssetId: z.string().min(1),
  edit: EditListSchema,
  createdAt: z.string(),
});
export type Candidate = z.infer<typeof CandidateSchema>;
