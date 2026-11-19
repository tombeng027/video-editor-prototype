import { describe, expect, it } from "vitest";
import { CommandSchema, ProjectSchema, HealthResponseSchema, TrackSchema } from "./index.js";

describe("schemas", () => {
  it("accepts forward clip speeds from 0.25x to 4x and rejects invalid speeds", () => {
    for (const speed of [0.25, 0.5, 1, 1.33, 2, 4]) {
      expect(CommandSchema.parse({ type: "SetClipSpeed", clipId: "c", speed })).toEqual({ type: "SetClipSpeed", clipId: "c", speed });
    }
    for (const speed of [0, -1, 0.249, 4.001, Infinity, NaN, "2"]) {
      expect(CommandSchema.safeParse({ type: "SetClipSpeed", clipId: "c", speed }).success).toBe(false);
    }
  });
  it("validates bounded static transforms and an explicit reset command", () => {
    const command = { type: "SetClipTransform", clipId: "clip", transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 } };
    expect(CommandSchema.parse(command)).toEqual(command);
    expect(CommandSchema.safeParse({ type: "SetClipTransform", clipId: "clip" }).success).toBe(true);
    for (const change of [{ scale: 0 }, { scale: 11 }, { opacity: 1.1 }, { x: Infinity }, { y: -11 }]) {
      expect(CommandSchema.safeParse({ ...command, transform: { ...command.transform, ...change } }).success).toBe(false);
    }
  });
  it("supports optional track names without migrating older projects and validates track settings", () => {
    const track = { id: "track", kind: "audio", order: 0, muted: false, locked: false, clips: [] };
    expect(TrackSchema.parse(track)).toEqual(track);
    expect(TrackSchema.parse({ ...track, name: " Voiceover " }).name).toBe("Voiceover");
    expect(CommandSchema.parse({ type: "SetTrackName", trackId: "track", name: " Music " }))
      .toEqual({ type: "SetTrackName", trackId: "track", name: "Music" });
    expect(CommandSchema.safeParse({ type: "SetTrackName", trackId: "track" }).success).toBe(true);
    for (const name of ["", "   ", "a".repeat(81)]) {
      expect(TrackSchema.safeParse({ ...track, name }).success).toBe(false);
      expect(CommandSchema.safeParse({ type: "SetTrackName", trackId: "track", name }).success).toBe(false);
    }
    expect(CommandSchema.safeParse({ type: "SetTrackLocked", trackId: "track", locked: true }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "SetTrackLocked", trackId: "track", locked: "true" }).success).toBe(false);
  });

  it("accepts a valid command and rejects an unknown one", () => {
    expect(CommandSchema.safeParse({ type: "RemoveClip", clipId: "c1" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "RelinkAsset", assetId: "asset", sourcePath: "C:\\Relocated\\video.mp4" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "RelinkAsset", assetId: "asset", sourcePath: "" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "MoveClip", clipId: "c1", timelineStart: 10 }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "MoveClip", clipId: "c1", timelineStart: 10, trackId: "overlay" }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "SetTrackMuted", trackId: "audio", muted: true }).success).toBe(true);
    expect(CommandSchema.safeParse({ type: "Explode", clipId: "c1" }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "SplitClip", clipId: "c1", frame: -1, newClipId: "c2" }).success).toBe(false);
  });

  it("preserves the optional ripple insertion flag", () => {
    const command = {
      type: "AddClip", trackId: "track",
      clip: { id: "clip", assetId: "asset", timelineStart: 10, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true },
      ripple: true,
    };
    expect(CommandSchema.parse(command)).toEqual(command);
    expect(CommandSchema.safeParse({ ...command, ripple: "true" }).success).toBe(false);
  });

  it("rejects projects with a wrong schema version or invalid fps", () => {
    const base = {
      schemaVersion: 2,
      id: "p",
      name: "n",
      settings: { fps: { num: 30, den: 1 }, width: 1920, height: 1080, fpsFromFirstImport: false },
      assets: [],
      tracks: [],
      captionCues: [],
      createdAt: "t",
      updatedAt: "t",
    };
    expect(ProjectSchema.safeParse(base).success).toBe(true);
    expect(ProjectSchema.safeParse({ ...base, schemaVersion: 3 }).success).toBe(false);
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
