import { z } from "zod";
import { RationalSchema, type Project, type Rational } from "./project.js";

export const EXPORT_FRAME_RATES = [
  { value: "24", label: "24", num: 24, den: 1 },
  { value: "25", label: "25", num: 25, den: 1 },
  { value: "30", label: "30", num: 30, den: 1 },
  { value: "50", label: "50", num: 50, den: 1 },
  { value: "60", label: "60", num: 60, den: 1 },
  { value: "23.976", label: "23.976", num: 24000, den: 1001 },
  { value: "29.97", label: "29.97", num: 30000, den: 1001 },
  { value: "59.94", label: "59.94", num: 60000, den: 1001 },
] as const;

export const ExportSettingsSchema = z.strictObject({
  format: z.literal("mp4").default("mp4"),
  codec: z.literal("h264").default("h264"),
  frameRate: z.enum(["project", "24", "25", "30", "50", "60", "23.976", "29.97", "59.94"]).default("project"),
  resolution: z.enum(["project", "720p", "1080p", "4k"]).default("project"),
  quality: z.enum(["smaller", "standard", "high"]).default("standard"),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;
export const DEFAULT_EXPORT_SETTINGS: ExportSettings = ExportSettingsSchema.parse({});

export const ResolvedExportSettingsSchema = z.strictObject({
  format: z.literal("mp4"),
  codec: z.literal("h264"),
  width: z.number().int().min(2).multipleOf(2),
  height: z.number().int().min(2).multipleOf(2),
  fps: RationalSchema,
  quality: ExportSettingsSchema.shape.quality,
  crf: z.union([z.literal(18), z.literal(20), z.literal(23)]),
});
export type ResolvedExportSettings = z.infer<typeof ResolvedExportSettingsSchema>;
export type ExportProjectSettings = Pick<Project["settings"], "width" | "height" | "fps">;

export function resolveExportSettings(project: ExportProjectSettings, settings: ExportSettings = DEFAULT_EXPORT_SETTINGS): ResolvedExportSettings {
  const edge = { "720p": 1280, "1080p": 1920, "4k": 3840 };
  const scale = settings.resolution === "project" ? 1 : edge[settings.resolution] / Math.max(project.width, project.height);
  const even = (size: number) => Math.max(2, Math.floor(size / 2) * 2);
  const rate = EXPORT_FRAME_RATES.find((rate) => rate.value === settings.frameRate);
  return {
    format: "mp4", codec: "h264",
    width: even(project.width * scale), height: even(project.height * scale),
    fps: rate ? { num: rate.num, den: rate.den } : { ...project.fps },
    quality: settings.quality,
    crf: ({ smaller: 23, standard: 20, high: 18 } as const)[settings.quality],
  };
}

export function exportFrameRateLabel(fps: Rational): string {
  return fps.den === 1 ? String(fps.num) : `${(fps.num / fps.den).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} (${fps.num}/${fps.den})`;
}
