import { describe, expect, it } from "vitest";
import type { Command, Project } from "@ve/schema";
import { createEmptyProject } from "./project.js";
import { applyCommand, applyCommands, validateProject } from "./reducer.js";

const cue = { id: "cue", start: 0, end: 30, text: "Hello" };
const fixture = () => createEmptyProject({ id: "p", name: "Captions", fps: { num: 30, den: 1 }, width: 640, height: 360,
  now: "2026-11-10T00:00:00.000Z" });
function apply(project: Project, commands: Command[]) {
  const result = applyCommands(project, commands);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("caption cue commands", () => {
  it("adds, edits text/timing, removes and exactly undoes/redoes a single caption lane", () => {
    const project = fixture();
    const added = apply(project, [{ type: "AddCaptionCue", cue }]);
    expect(added.project.captionCues).toEqual([cue]);
    expect(apply(added.project, added.inverse).project).toEqual(project);
    const edited = apply(added.project, [{ type: "SetCaptionCue", cue: { ...cue, start: 10, end: 40, text: "New\ntext" } }]);
    expect(edited.project.captionCues[0]).toEqual({ ...cue, start: 10, end: 40, text: "New\ntext" });
    const undone = apply(edited.project, edited.inverse);
    expect(undone.project).toEqual(added.project);
    expect(apply(undone.project, undone.inverse).project).toEqual(edited.project);
    const removed = apply(edited.project, [{ type: "RemoveCaptionCue", cueId: cue.id }]);
    expect(removed.project.captionCues).toEqual([]);
    expect(apply(removed.project, removed.inverse).project).toEqual(edited.project);
    expect(project.captionCues).toEqual([]);
  });
  it("restores original array order even when cues are not stored chronologically", () => {
    const project = fixture();
    project.captionCues = [{ ...cue, id: "last", start: 90, end: 120 }, cue, { ...cue, id: "middle", start: 30, end: 60 }];
    const removed = apply(project, [{ type: "RemoveCaptionCue", cueId: cue.id }]);
    expect(apply(removed.project, removed.inverse).project).toEqual(project);
  });
  it("allows adjacency and caption-only timelines but rejects overlaps atomically", () => {
    const project = fixture(), before = JSON.stringify(project);
    const commands: Command[] = [{ type: "AddCaptionCue", cue },
      { type: "AddCaptionCue", cue: { ...cue, id: "overlap", start: 29, end: 60 } }];
    expect(applyCommands(project, commands)).toMatchObject({ ok: false, error: { code: "INVALID_CAPTION" } });
    expect(JSON.stringify(project)).toBe(before);
    const added = apply(project, [{ type: "AddCaptionCue", cue }, { type: "AddCaptionCue", cue: { ...cue, id: "adjacent", start: 30, end: 60 } }]);
    expect(validateProject(added.project)).toBeNull();
    expect(applyCommands(added.project, [{ type: "SetCaptionCue", cue: { ...cue, end: 31 } }]))
      .toMatchObject({ ok: false, error: { code: "INVALID_CAPTION" } });
  });
  it("rejects missing cues, bad insert indices and invalid values in direct reducer calls", () => {
    const project = fixture();
    expect(applyCommand(project, { type: "SetCaptionCue", cue })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(applyCommand(project, { type: "RemoveCaptionCue", cueId: "missing" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(applyCommand(project, { type: "AddCaptionCue", cue, index: 1 })).toMatchObject({ ok: false, error: { code: "INVALID_CAPTION" } });
    for (const change of [{ text: " " }, { start: 0.5 }, { end: Number.MAX_SAFE_INTEGER + 1 }, { end: 0 }]) {
      expect(applyCommand(project, { type: "AddCaptionCue", cue: { ...cue, ...change } }))
        .toMatchObject({ ok: false, error: { code: "INVALID_CAPTION" } });
    }
  });
  it("uses the project-wide ID namespace in both directions", () => {
    const project = fixture();
    project.tracks = [{ id: "track", kind: "video", order: 0, muted: false, locked: false, clips: [] }];
    expect(applyCommands(project, [{ type: "AddCaptionCue", cue: { ...cue, id: "track" } }]))
      .toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } });
    project.captionCues = [cue];
    expect(applyCommands(project, [{ type: "AddTrack", track: { ...project.tracks[0]!, id: "cue", order: 1 } }]))
      .toMatchObject({ ok: false, error: { code: "DUPLICATE_ID" } });
    project.captionCues = [{ ...cue, id: "track" }];
    expect(validateProject(project)?.code).toBe("DUPLICATE_ID");
  });
  it("keeps manual cues timeline-fixed through media edits and prevents frame-rate reinterpretation", () => {
    const project = fixture();
    project.assets = [{ id: "asset", name: "Still", kind: "image", mediaMode: "reference", sourcePath: "test.png",
      contentHash: "fixture", durationFrames: 90, fps: null, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    project.tracks = [{ id: "track", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "clip", assetId: "asset", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true },
    ] }];
    project.captionCues = [cue];
    const cueEdit = apply(project, [{ type: "SetCaptionCue", cue: { ...cue, text: "Reworded" } }]);
    expect(cueEdit.project.tracks).toEqual(project.tracks);
    expect(cueEdit.project.assets).toEqual(project.assets);
    const changed = apply(project, [{ type: "MoveClip", clipId: "clip", timelineStart: 20 },
      { type: "TrimClip", clipId: "clip", sourceOut: 60 }, { type: "RemoveClip", clipId: "clip" }]);
    expect(changed.project.captionCues).toEqual([cue]);
    expect(changed.project.assets).toEqual(project.assets);
    expect(applyCommands(changed.project, [{ type: "SetProjectFps", fps: { num: 60, den: 1 } }]))
      .toMatchObject({ ok: false, error: { code: "PROJECT_NOT_EMPTY" } });
    const empty = apply(changed.project, [{ type: "RemoveCaptionCue", cueId: "cue" }, { type: "SetProjectFps", fps: { num: 60, den: 1 } }]);
    expect(empty.project.settings.fps.num).toBe(60);
  });
  it("rejects invalid loaded relations before any command runs", () => {
    const project = fixture();
    project.captionCues = [cue, { ...cue, id: "second", start: 29, end: 60 }];
    expect(validateProject(project)?.code).toBe("INVALID_CAPTION");
    expect(applyCommands(project, [])).toMatchObject({ ok: false, error: { code: "INVALID_CAPTION" } });
  });
});
