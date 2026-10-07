import { describe, expect, it } from "vitest";
import type { Project } from "@ve/schema";
import { exportDisabledReason, saveLabel, timelineHasClips } from "./exportStatus.js";

const project = (kind: "video" | "audio", clips: number): Project =>
  ({
    tracks: [{ id: "t", kind, order: 0, muted: false, locked: false, clips: Array.from({ length: clips }, (_, i) => ({ id: `c${i}` })) }],
  }) as unknown as Project;

describe("export status helpers", () => {
  it("labels the save state", () => {
    expect(saveLabel("saved")).toBe("Autosaved");
    expect(saveLabel("saving")).toBe("Saving…");
    expect(saveLabel("error")).toBe("Save failed");
  });

  it("needs a non-audio clip to export", () => {
    expect(timelineHasClips(project("video", 0))).toBe(false);
    expect(timelineHasClips(project("audio", 2))).toBe(false);
    expect(timelineHasClips(project("video", 1))).toBe(true);
  });

  it("explains why export is disabled", () => {
    expect(exportDisabledReason(project("video", 0), 0)).toMatch(/Add a clip/);
    expect(exportDisabledReason(project("video", 1), 2)).toMatch(/offline/);
    expect(exportDisabledReason(project("video", 1), 0)).toBeNull();
  });
});