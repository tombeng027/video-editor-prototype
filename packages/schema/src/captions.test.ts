import { describe, expect, it } from "vitest";
import { CaptionCueSchema, captionCuesError } from "./captions.js";
import { parseStoredProject, ProjectSchema, SCHEMA_VERSION } from "./project.js";
import { CommandSchema } from "./commands.js";

const cue = { id: "cue", start: 0, end: 30, text: "Hello\nworld!" };
const legacy = {
  schemaVersion: 1, id: "p", name: "Legacy",
  settings: { fps: { num: 30000, den: 1001 }, width: 1920, height: 1080, fpsFromFirstImport: false },
  assets: [], tracks: [], createdAt: "created", updatedAt: "updated",
};

describe("caption cue schema", () => {
  it("preserves plain text, Unicode, whitespace and exclusive frame endpoints", () => {
    const value = { ...cue, text: "  Hello\n\u4e16\u754c <literal text>  " };
    expect(CaptionCueSchema.parse(value)).toEqual(value);
    expect(captionCuesError([cue, { ...cue, id: "next", start: 30, end: 60 }])).toBeNull();
    expect(captionCuesError([{ ...cue, id: "next", start: 30, end: 60 }, cue])).toBeNull();
  });
  it.each([
    { start: -1 }, { start: 0.1 }, { start: NaN }, { end: Infinity }, { end: Number.MAX_SAFE_INTEGER + 1 },
    { end: 0 }, { start: 30 }, { text: "" }, { text: " \n\t" }, { text: "x".repeat(2001) }, { id: "" },
  ])("rejects invalid cues %j", (change) => {
    expect(CaptionCueSchema.safeParse({ ...cue, ...change }).success).toBe(false);
    expect(CommandSchema.safeParse({ type: "AddCaptionCue", cue: { ...cue, ...change } }).success).toBe(false);
  });
  it("rejects overlap and duplicate IDs without mutating cue ordering", () => {
    const cues = [{ ...cue, id: "later", start: 20, end: 60 }, cue];
    const original = cues.map((item) => ({ ...item }));
    expect(captionCuesError(cues)).toContain("overlap");
    expect(captionCuesError([cue, { ...cue, start: 30, end: 60 }])).toContain("unique");
    expect(cues).toEqual(original);
  });
  it("validates all command shapes and optional exact-order restoration", () => {
    for (const command of [
      { type: "AddCaptionCue", cue }, { type: "AddCaptionCue", cue, index: 0 },
      { type: "SetCaptionCue", cue: { ...cue, text: "Edited", start: 1 } }, { type: "RemoveCaptionCue", cueId: "cue" },
    ]) expect(CommandSchema.parse(command)).toEqual(command);
    expect(CommandSchema.safeParse({ type: "AddCaptionCue", cue, index: -1 }).success).toBe(false);
  });
});

describe("saved project migration", () => {
  it("migrates only v1, without modifying its input or timestamps", () => {
    const before = JSON.stringify(legacy);
    expect(parseStoredProject(legacy)).toEqual({ ok: true, migrated: true,
      project: { ...legacy, schemaVersion: SCHEMA_VERSION, captionCues: [] } });
    expect(JSON.stringify(legacy)).toBe(before);
    expect(ProjectSchema.safeParse(legacy).success).toBe(false);
  });
  it("preserves existing optional media edits during migration", () => {
    const clip = { id: "c", assetId: "a", timelineStart: 10, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true,
      crop: { left: 0.1, right: 0, top: 0, bottom: 0 }, transform: { x: 0.6, y: 0.4, scale: 0.8, opacity: 0.7 },
      animations: { entrance: { id: "entrance.fade", version: 1, durationPercent: 20 } },
      zoom: { version: 1, startPercent: 0, endPercent: 100, startScale: 1, endScale: 2 } };
    const old = { ...legacy, assets: [{ id: "a", kind: "image", name: "Still", mediaMode: "reference", sourcePath: "test.png",
      contentHash: "fixture", durationFrames: 90, fps: null, width: 640, height: 360, hasAudio: false, proxyPath: null }],
    tracks: [{ id: "t", name: "Visual", kind: "video", order: 0, muted: false, locked: true, clips: [clip] }] };
    const result = parseStoredProject(old);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.project).toEqual({ ...old, schemaVersion: 2, captionCues: [] });
  });
  it("round-trips v2 captions and does not migrate API payloads implicitly", () => {
    const current = { ...legacy, schemaVersion: SCHEMA_VERSION, captionCues: [cue] };
    expect(parseStoredProject(current)).toEqual({ ok: true, migrated: false, project: current });
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(current)))).toEqual(current);
    expect(ProjectSchema.safeParse({ ...current, captionCues: undefined }).success).toBe(false);
  });
  it.each([0, 3, 999])("rejects unsupported version %s explicitly", (schemaVersion) => {
    expect(parseStoredProject({ ...legacy, schemaVersion })).toMatchObject({ ok: false, code: "UNSUPPORTED_PROJECT_VERSION" });
  });
  it("does not conceal malformed legacy/current projects or caption data labelled as v1", () => {
    expect(parseStoredProject({ ...legacy, tracks: null })).toMatchObject({ ok: false, code: "CORRUPT" });
    expect(parseStoredProject({ ...legacy, captionCues: [cue] })).toMatchObject({ ok: false, code: "CORRUPT" });
    expect(parseStoredProject({ ...legacy, schemaVersion: 2, captionCues: [{ ...cue, end: 0 }] }))
      .toMatchObject({ ok: false, code: "CORRUPT" });
    expect(parseStoredProject({ ...legacy, schemaVersion: "1" })).toMatchObject({ ok: false, code: "CORRUPT" });
  });
});
