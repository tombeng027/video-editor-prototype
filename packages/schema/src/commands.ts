import { z } from "zod";
import { ClipAnimationsSchema } from "./animations.js";
import { ClipZoomSchema } from "./zoom.js";
import { CaptionCueSchema } from "./captions.js";
import { AssetSchema, CanvasSizeSchema, ClipCropSchema, ClipSchema, ClipSpeedSchema, ClipVolumeSchema, RationalSchema, TrackNameSchema, TrackSchema, TransformSchema } from "./project.js";

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("AddCaptionCue"), cue: CaptionCueSchema, index: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("SetCaptionCue"), cue: CaptionCueSchema }),
  z.object({ type: z.literal("RemoveCaptionCue"), cueId: z.string().min(1) }),
  z.object({ type: z.literal("SetProjectFps"), fps: RationalSchema }),
  CanvasSizeSchema.extend({ type: z.literal("SetProjectCanvas") }),
  z.object({ type: z.literal("AddAsset"), asset: AssetSchema }),
  z.object({ type: z.literal("RemoveAsset"), assetId: z.string() }),
  z.object({ type: z.literal("RelinkAsset"), assetId: z.string().min(1), sourcePath: z.string().min(1) }),
  z.object({ type: z.literal("SetAssetProxy"), assetId: z.string(), proxyPath: z.string().nullable() }),
  z.object({ type: z.literal("AddTrack"), track: TrackSchema }),
  z.object({ type: z.literal("RemoveTrack"), trackId: z.string() }),
  z.object({ type: z.literal("SetTrackMuted"), trackId: z.string(), muted: z.boolean() }),
  z.object({ type: z.literal("SetTrackName"), trackId: z.string(), name: TrackNameSchema.optional() }),
  z.object({ type: z.literal("SetTrackLocked"), trackId: z.string(), locked: z.boolean() }),
  z.object({ type: z.literal("SwapTrackOrder"), firstTrackId: z.string(), secondTrackId: z.string() }),
  z.object({ type: z.literal("AddClip"), trackId: z.string(), clip: ClipSchema, ripple: z.boolean().optional() }),
  z.object({
    type: z.literal("MoveClip"),
    clipId: z.string(),
    timelineStart: z.number().int().nonnegative(),
    trackId: z.string().optional(),
  }),
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
  z.object({ type: z.literal("SetClipTransform"), clipId: z.string(), transform: TransformSchema.optional() }),
  z.object({ type: z.literal("SetClipCrop"), clipId: z.string(), crop: ClipCropSchema.optional() }),
  z.object({ type: z.literal("SetClipSpeed"), clipId: z.string(), speed: ClipSpeedSchema }),
  z.object({ type: z.literal("SetClipAnimations"), clipId: z.string(), animations: ClipAnimationsSchema.optional() }),
  z.object({ type: z.literal("SetClipZoom"), clipId: z.string(), zoom: ClipZoomSchema.optional() }),
  z.object({ type: z.literal("SetClipVolume"), clipId: z.string(), volume: ClipVolumeSchema.optional() }),
  // Moves a video clip's sound to a new independent clip on an audio track and silences the video clip.
  z.object({ type: z.literal("SplitAudio"), clipId: z.string(), audioClipId: z.string(), trackId: z.string() }),
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
  "INVALID_CROP",
  "INVALID_CAPTION",
  "INVALID_CANVAS_SIZE",
  "INVALID_SPEED",
  "INVALID_ANIMATION",
  "INVALID_ZOOM",
  "INVALID_VOLUME",
  "INVALID_AUDIO_SPLIT",
  "INVALID_FRAME",
  "DUPLICATE_ORDER",
  "INVALID_TRACK_ORDER",
  "INVALID_TRACK_NAME",
  "PROJECT_NOT_EMPTY",
  "RELINK_INVALID_FILE",
  "RELINK_MISMATCH",
] as const;
export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export type CommandError = { code: CommandErrorCode; message: string };
