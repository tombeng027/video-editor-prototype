import { describe, expect, it } from "vitest";
import { CANVAS_ASPECT_PRESETS, canvasSizeForAspect, CommandSchema, ProjectSchema, resolveExportSettings, type Project } from "@ve/schema";
import { applyCommands } from "./reducer.js";
import { buildRenderPlan } from "./renderPlan.js";
import { createEmptyProject } from "./project.js";

const fixture = (): Project => ({
  ...createEmptyProject({ id: "p", name: "Canvas", fps: { num: 30, den: 1 }, width: 1920, height: 1080, now: "2026-11-10T00:00:00.000Z" }),
  assets: [{ id: "a", name: "Still", kind: "image", mediaMode: "reference", sourcePath: "test.png",
    contentHash: "a", durationFrames: 150, fps: null, width: 1920, height: 1080, hasAudio: false, proxyPath: null }],
  tracks: [{ id: "t", kind: "video", order: 0, muted: false, locked: true, clips: [
    { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true,
      transform: { x: 0.6, y: 0.4, scale: 1.2, opacity: 0.8 }, crop: { left: 0.1, right: 0, top: 0, bottom: 0 } },
  ] }],
});

describe("project canvas aspect", () => {
  it.each(CANVAS_ASPECT_PRESETS)("sets $label on a populated project, preserves edits, and passes exact dimensions to export", (preset) => {
    const project = fixture();
    const size = canvasSizeForAspect(project.settings, preset);
    expect(Math.max(size.width, size.height)).toBe(1920);
    expect(size.width / size.height).toBe(preset.width / preset.height);
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
    const result = applyCommands(project, [{ type: "SetProjectCanvas", ...size }]);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.project.tracks).toEqual(project.tracks);
    expect(result.project.assets).toEqual(project.assets);
    expect(result.project.settings).toEqual({ ...project.settings, ...size });
    expect(project).toEqual(fixture());
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(result.project)));
    expect(buildRenderPlan(reopened)).toMatchObject(size);
    expect(resolveExportSettings(reopened.settings)).toMatchObject(size);
    const undone = applyCommands(reopened, result.inverse);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.project).toEqual(project);
    const redone = applyCommands(undone.project, undone.inverse);
    expect(redone).toMatchObject({ ok: true, project: result.project });
  });

  it("rounds nonstandard dimensions down to even exact ratios and keeps tiny sizes positive", () => {
    for (const preset of CANVAS_ASPECT_PRESETS) {
      for (const edge of [1, 17, 641, 1921]) {
        const size = canvasSizeForAspect({ width: edge, height: 1 }, preset);
        expect(size.width * preset.height).toBe(size.height * preset.width);
        expect(size.width % 2).toBe(0);
        expect(size.height % 2).toBe(0);
        expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid dimensions %s", (value) => {
    const project = fixture();
    for (const size of [{ width: value, height: 1080 }, { width: 1920, height: value }]) {
      const command = { type: "SetProjectCanvas", ...size } as const;
      expect(CommandSchema.safeParse(command).success).toBe(false);
      expect(applyCommands(project, [command])).toMatchObject({ ok: false, error: { code: "INVALID_CANVAS_SIZE" } });
    }
    expect(project).toEqual(fixture());
  });

  it("restores original custom odd dimensions exactly on Undo", () => {
    const project = fixture();
    project.settings.width = 641;
    project.settings.height = 359;
    const result = applyCommands(project, [{ type: "SetProjectCanvas", width: 640, height: 640 }]);
    if (!result.ok) throw new Error(result.error.message);
    expect(applyCommands(result.project, result.inverse)).toMatchObject({ ok: true, project });
  });
});
