import { z } from "zod";
import { AssetSchema, ClipSchema, RationalSchema, TrackSchema } from "./project.js";

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SetProjectFps"), fps: RationalSchema }),
  z.object({ type: z.literal("AddAsset"), asset: AssetSchema }),
  z.object({ type: z.literal("RemoveAsset"), assetId: z.string() }),
  z.object({ type: z.literal("SetAssetProxy"), assetId: z.string(), proxyPath: z.string().nullable() }),
  z.object({ type: z.literal("AddTrack"), track: TrackSchema }),
  z.object({ type: z.literal("RemoveTrack"), trackId: z.string() }),
  z.object({ type: z.literal("AddClip"), trackId: z.string(), clip: ClipSchema }),
  z.object({
    type: z.literal("TrimClip"),
    clipId: z.string(),
    sourceIn: z.number().int().nonnegative().optional(),
    sourceOut: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("SplitClip"),
    clipId: z.string(),
    frame: z.number().int().nonnegative(),
    newClipId: z.string().min(1),
  }),
  z.object({ type: z.literal("RemoveClip"), clipId: z.string() }),
]);
export type Command = z.infer<typeof CommandSchema>;

export const COMMAND_ERROR_CODES = [
  "DUPLICATE_ID",
  "NOT_FOUND",
  "ASSET_IN_USE",
  "TRACK_NOT_EMPTY",
  "INVALID_RANGE",
  "OVERLAP",
  "TRACK_KIND_MISMATCH",
  "TRACK_LOCKED",
  "INVALID_TRANSFORM",
  "INVALID_FRAME",
  "DUPLICATE_ORDER",
  "PROJECT_NOT_EMPTY",
] as const;
export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export type CommandError = { code: CommandErrorCode; message: string };
