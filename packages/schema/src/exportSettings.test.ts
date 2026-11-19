import { describe, expect, it } from "vitest";
import { StartExportRequestSchema } from "./api.js";
import { DEFAULT_EXPORT_SETTINGS, ExportSettingsSchema, resolveExportSettings } from "./exportSettings.js";

const project = { width: 1920, height: 1080, fps: { num: 30000, den: 1001 } };
describe("export settings", () => {
  it("preserves existing output defaults and does not mutate project settings", () => {
    const before = { ...project, fps: { ...project.fps } };
    expect(StartExportRequestSchema.parse({})).toEqual({});
    expect(resolveExportSettings(project)).toEqual({
      format: "mp4", codec: "h264", width: 1920, height: 1080, fps: project.fps, quality: "standard", crf: 20,
    });
    expect(project).toEqual(before);
  });
  it.each([
    ["720p", 1280, 720], ["1080p", 1920, 1080], ["4k", 3840, 2160],
  ] as const)("fits %s for landscape, portrait and square", (resolution, width, height) => {
    const settings = { ...DEFAULT_EXPORT_SETTINGS, resolution };
    expect(resolveExportSettings(project, settings)).toMatchObject({ width, height });
    expect(resolveExportSettings({ ...project, width: 1080, height: 1920 }, settings)).toMatchObject({ width: height, height: width });
    expect(resolveExportSettings({ ...project, width: 1000, height: 1000 }, settings)).toMatchObject({ width, height: width });
  });
  it("rounds dimensions to even pixels and scales unusual aspect ratios without stretching", () => {
    expect(resolveExportSettings({ ...project, width: 1281, height: 721 })).toMatchObject({ width: 1280, height: 720 });
    const output = resolveExportSettings({ ...project, width: 2048, height: 858 },
      { ...DEFAULT_EXPORT_SETTINGS, resolution: "720p" });
    expect(output).toMatchObject({ width: 1280, height: 536 });
  });
  it.each([
    ["60", 60, 1], ["23.976", 24000, 1001], ["29.97", 30000, 1001], ["59.94", 60000, 1001],
  ] as const)("resolves exact rate %s", (frameRate, num, den) => {
    expect(resolveExportSettings(project, { ...DEFAULT_EXPORT_SETTINGS, frameRate }).fps).toEqual({ num, den });
  });
  it.each([["smaller", 23], ["standard", 20], ["high", 18]] as const)("maps %s quality to CRF %s", (quality, crf) => {
    expect(resolveExportSettings(project, { ...DEFAULT_EXPORT_SETTINGS, quality }).crf).toBe(crf);
  });
  it.each([
    { codec: "hevc" }, { format: "webm" }, { frameRate: "120" }, { resolution: "8k" },
    { quality: "lossless" }, { width: 200 }, null,
  ])("rejects unsupported settings %j", (settings) => {
    expect(ExportSettingsSchema.safeParse(settings).success).toBe(false);
    expect(StartExportRequestSchema.safeParse({ settings }).success).toBe(false);
  });
});
