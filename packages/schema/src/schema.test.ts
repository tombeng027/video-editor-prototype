import { describe, expect, it } from "vitest";
import { CommandSchema, ProjectSchema, HealthResponseSchema } from "./index.js";

describe("schemas", () => {
  it("accepts a valid command and rejects an unknown one", () => {
    expect(CommandSchema.safeParse({ type: "RemoveClip", clipId: "c1" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "Explode", clipId: "c1" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "SplitClip", clipId: "c1", frame: -1, newClipId: "c2" }).success).toBe(false);
  });

  it("rejects projects with a wrong schema version or invalid fps", () => {
    const base = {
      schemaVersion: 1,
      id: "p",
      name: "n",
      settings: { fps: { num: 30, den: 1 }, width: 1920, height: 1080, fpsFromFirstImport: false },
      assets: [],
      tracks: [],
      createdAt: "t",
      updatedAt: "t",
    };
    expect(ProjectSchema.safeParse(base).success).toBe(true);
    expect(ProjectSchema.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false);
    expect(
      ProjectSchema.safeParse({ ...base, settings: { ...base.settings, fps: { num: 30, den: 0 } } }).success,
    ).toBe(false);
  });

  it("validates a health response", () => {
    expect(
      HealthResponseSchema.safeParse({
        ok: true,
        version: "0.1.0",
        components: [{ name: "engine", status: "ok" }],
      }).success,
    ).toBe(true);
  });
});
