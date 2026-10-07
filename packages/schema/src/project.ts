import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

export const RationalSchema = z.object({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
});
export type Rational = z.infer<typeof RationalSchema>;

const frames = z.number().int().nonnegative();

export const TransformSchema = z.object({
  x: z.number(),
  y: z.number(),
  scale: z.number().positive(),
  opacity: z.number().min(0).max(1),
});
export type Transform = z.infer<typeof TransformSchema>;

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

export const ClipSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  timelineStart: frames,
  sourceIn: frames,
  sourceOut: frames,
  speed: z.literal(1),
  audioLinked: z.boolean(),
  linkedClipId: z.string().optional(),
  transform: TransformSchema.optional(),
});
export type Clip = z.infer<typeof ClipSchema>;

export const TrackKindSchema = z.enum(["video", "overlay", "audio"]);
export type TrackKind = z.infer<typeof TrackKindSchema>;

export const TrackSchema = z.object({
  id: z.string().min(1),
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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

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
