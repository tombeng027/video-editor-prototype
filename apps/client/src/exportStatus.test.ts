import { describe, expect, it } from "vitest";
import type { Project, Track } from "@ve/schema";
import { createEmptyProject } from "@ve/timeline-core";
import { exportDisabledReason, saveLabel, timelineHasClips } from "./exportStatus.js";

const track = (id: string, kind: Track["kind"], order: number, assetId: string, start = 0): Track => ({
  id, kind, order, muted: false, locked: false,
  clips: [{ id: `${id}-clip`, assetId, timelineStart: start, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true }],
});
const project = (...tracks: Track[]): Project => ({
  ...createEmptyProject({ id: "p", name: "Demo", fps: { num: 30, den: 1 }, width: 640, height: 360 }),
  assets: [...new Set(tracks.flatMap((t) => t.clips.map((c) => c.assetId)))].map((id) => ({
    id, kind: "video", name: id, mediaMode: "reference", sourcePath: `C:\\${id}.mp4`,
    contentHash: id, durationFrames: 30, fps: { num: 30, den: 1 }, width: 640, height: 360,
    hasAudio: true, proxyPath: null,
  })),
  tracks,
});

describe("export status helpers", () => {
  it("labels the save state", () => {
    expect(saveLabel("saved")).toBe("Autosaved");
    expect(saveLabel("saving")).toBe("Saving…");
    expect(saveLabel("error")).toBe("Save failed");
    expect(saveLabel("unknown")).toBe("Save unconfirmed");
    expect(saveLabel("recovered")).toBe("Backup loaded");
  });

  it("needs a non-audio clip to export", () => {
    expect(timelineHasClips(project())).toBe(false);
    expect(timelineHasClips(project(track("audio", "audio", 0, "a")))).toBe(false);
    expect(timelineHasClips(project(track("video", "video", 0, "v")))).toBe(true);
    expect(exportDisabledReason(project(), new Set())).toMatch(/Add a clip/);
  });

  it("blocks used missing media, including audio rows, but permits unused and muted-audio assets", () => {
    const p = project(track("video", "video", 0, "v"), track("audio", "audio", 1, "a"));
    expect(exportDisabledReason(p, new Set(["v"]))).toMatch(/offline/);
    expect(exportDisabledReason(p, new Set(["a"]))).toMatch(/offline/);
    expect(exportDisabledReason(p, new Set(["unused"]))).toBeNull();
    expect(exportDisabledReason(p, new Set())).toBeNull();
    p.tracks[1]!.muted = true;
    expect(exportDisabledReason(p, new Set(["a"]))).toBeNull();
  });

  it("matches render-plan layers including stacked clips and uncovered gaps", () => {
    const p = project(track("bottom", "video", 0, "lower"), track("top", "overlay", 1, "visible"),
      track("later", "video", 2, "later", 60));
    // Lower layers stay in the plan because transforms and opacity can reveal them.
    expect(exportDisabledReason(p, new Set(["lower"]))).toMatch(/offline/);
    expect(exportDisabledReason(p, new Set(["visible"]))).toMatch(/offline/);
    expect(exportDisabledReason(p, new Set(["later"]))).toMatch(/offline/);
  });
});
