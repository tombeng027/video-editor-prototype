import { describe, expect, it } from "vitest";
import { ProjectSchema, type Command, type Project } from "@ve/schema";
import { applyCommands, validateProject } from "./reducer.js";
import { createEmptyProject } from "./project.js";
import { buildRenderPlan } from "./renderPlan.js";

const fixture = (hasAudio = true): Project => ({
  ...createEmptyProject({ id: "p", name: "Split audio", fps: { num: 30, den: 1 }, width: 64, height: 64 }),
  assets: [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "test.mp4",
    contentHash: "a", durationFrames: 300, fps: { num: 30, den: 1 }, width: 64, height: 64, hasAudio, proxyPath: null }],
  tracks: [
    { id: "v", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "a", timelineStart: 10, sourceIn: 30, sourceOut: 90, speed: 2, audioLinked: true },
    ] },
    { id: "music", kind: "audio", order: 1, muted: false, locked: false, clips: [] },
  ],
});
const split: Command = { type: "SplitAudio", clipId: "c", audioClipId: "sound", trackId: "music" };

describe("SplitAudio", () => {
  it("silences the video clip, adds an independent matching audio clip, and undoes exactly", () => {
    const original = fixture();
    const result = applyCommands(original, [split]);
    if (!result.ok) throw new Error(result.error.message);
    const [video, audio] = result.project.tracks;
    expect(video!.clips[0]!.audioLinked).toBe(false);
    expect(audio!.clips).toEqual([{ id: "sound", assetId: "a", timelineStart: 10, sourceIn: 30, sourceOut: 90, speed: 2, audioLinked: true }]);
    expect(validateProject(result.project)).toBeNull();
    expect(ProjectSchema.safeParse(result.project).success).toBe(true);
    const plan = buildRenderPlan(result.project);
    expect(plan.segments.find((segment) => segment.kind === "clip")).toMatchObject({ layers: [{ clipId: "c", audioMuted: true }] });
    expect(plan.audioClips).toMatchObject([{ clipId: "sound", startFrame: 10, sourceInFrame: 30, speed: 2 }]);
    const undone = applyCommands(result.project, result.inverse);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.project).toEqual(original);
  });

  it("rejects silent video, already-split clips, wrong tracks, overlaps and locks", () => {
    const code = (project: Project, command: Command = split) => {
      const result = applyCommands(project, [command]);
      return result.ok ? "ok" : result.error.code;
    };
    expect(code(fixture(false))).toBe("INVALID_AUDIO_SPLIT");
    const done = applyCommands(fixture(), [split]);
    if (!done.ok) throw new Error(done.error.message);
    expect(code(done.project, { ...split, audioClipId: "again" })).toBe("INVALID_AUDIO_SPLIT");
    expect(code(fixture(), { ...split, trackId: "v" })).toBe("INVALID_AUDIO_SPLIT");
    const busy = fixture();
    busy.tracks[1]!.clips.push({ id: "m", assetId: "a", timelineStart: 30, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true });
    expect(code(busy)).toBe("OVERLAP");
    const locked = fixture();
    locked.tracks[1]!.locked = true;
    expect(code(locked)).toBe("TRACK_LOCKED");
    expect(code(fixture(), { ...split, audioClipId: "c" })).toBe("DUPLICATE_ID");
  });
});

describe("SetClipVolume", () => {
  it("saves, plans, carries through splits, resets at 100% and undoes exactly", () => {
    const original = fixture();
    const set = applyCommands(original, [{ type: "SetClipVolume", clipId: "c", volume: 0.25 }]);
    if (!set.ok) throw new Error(set.error.message);
    expect(set.project.tracks[0]!.clips[0]!.volume).toBe(0.25);
    expect(validateProject(set.project)).toBeNull();
    expect(buildRenderPlan(set.project).segments.find((segment) => segment.kind === "clip"))
      .toMatchObject({ layers: [{ clipId: "c", volume: 0.25 }] });

    const halves = applyCommands(set.project, [{ type: "SplitClip", clipId: "c", frame: 20, newClipId: "right" }]);
    if (!halves.ok) throw new Error(halves.error.message);
    expect(halves.project.tracks[0]!.clips.map((clip) => clip.volume)).toEqual([0.25, 0.25]);

    const moved = applyCommands(set.project, [split]);
    if (!moved.ok) throw new Error(moved.error.message);
    expect(buildRenderPlan(moved.project).audioClips).toMatchObject([{ clipId: "sound", volume: 0.25 }]);

    const reset = applyCommands(set.project, [{ type: "SetClipVolume", clipId: "c", volume: 1 }]);
    if (!reset.ok) throw new Error(reset.error.message);
    expect(reset.project).toEqual(original);
    const undone = applyCommands(set.project, set.inverse);
    if (!undone.ok) throw new Error(undone.error.message);
    expect(undone.project).toEqual(original);
  });

  it("rejects out-of-range volume and locked tracks", () => {
    expect(applyCommands(fixture(), [{ type: "SetClipVolume", clipId: "c", volume: 1.5 }]))
      .toMatchObject({ ok: false, error: { code: "INVALID_VOLUME" } });
    const locked = fixture();
    locked.tracks[0]!.locked = true;
    expect(applyCommands(locked, [{ type: "SetClipVolume", clipId: "c", volume: 0.5 }]))
      .toMatchObject({ ok: false, error: { code: "TRACK_LOCKED" } });
  });
});
