// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@ve/timeline-core";
import type { Project } from "@ve/schema";
import { NO_CROP, type CropControls } from "../cropEdit.js";
import { CropProperties } from "./CropProperties.js";

const project: Project = {
  ...createEmptyProject({ id: "p", name: "Crop", fps: { num: 30, den: 1 }, width: 640, height: 360 }),
  assets: [{ id: "a", kind: "video", name: "Video", mediaMode: "reference", sourcePath: "C:\\video.mp4",
    contentHash: "fixture", durationFrames: 90, fps: { num: 30, den: 1 }, width: 1920, height: 1080, hasAudio: true, proxyPath: null }],
  tracks: [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
    { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true },
  ] }],
};
const controls = (): CropControls => ({ active: false, mode: "free", onActive: vi.fn(), onMode: vi.fn(), onDraft: vi.fn(), onCommit: vi.fn() });
afterEach(cleanup);
describe("crop properties", () => {
  it("previews numeric changes, applies once, and resets through the same command callback", () => {
    const crop = controls();
    render(<CropProperties project={project} selectedClipId="c" controls={crop} />);
    fireEvent.change(screen.getByLabelText("Crop left (%)"), { target: { value: "20" } });
    expect(crop.onDraft).toHaveBeenLastCalledWith("c", { ...NO_CROP, left: 0.2 });
    expect(crop.onCommit).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "Clip crop" }));
    expect(crop.onCommit).toHaveBeenCalledExactlyOnceWith("c", { ...NO_CROP, left: 0.2 });
    fireEvent.click(screen.getByRole("button", { name: "Reset crop" }));
    expect(crop.onCommit).toHaveBeenLastCalledWith("c");
  });
  it("shows invalid input without sending a command, and cancels an unsaved draft", () => {
    const crop = controls();
    render(<CropProperties project={project} selectedClipId="c" controls={crop} />);
    fireEvent.change(screen.getByLabelText("Crop left (%)"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Crop right (%)"), { target: { value: "20" } });
    expect(screen.getByRole("alert").textContent).toContain("more than 5%");
    fireEvent.submit(screen.getByRole("form", { name: "Clip crop" }));
    expect(crop.onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel crop draft"));
    expect(crop.onDraft).toHaveBeenLastCalledWith("c", null);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Crop left (%)")).toHaveProperty("value", "0");
  });
  it("shares mode selection and reflects a canvas draft without submitting it", () => {
    const crop = controls();
    const view = render(<CropProperties project={project} selectedClipId="c" controls={crop} />);
    fireEvent.click(screen.getByRole("button", { name: "Crop mode" }));
    expect(crop.onActive).toHaveBeenCalledWith(true);
    expect(screen.getByLabelText("Crop constraint")).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Crop constraint"), { target: { value: "locked" } });
    expect(crop.onMode).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Crop mode status").textContent).toBe("Crop off: Free-form");
    view.rerender(<CropProperties project={project} selectedClipId="c" controls={{ ...crop, active: true }} />);
    expect(screen.getByLabelText("Crop constraint")).toHaveProperty("disabled", false);
    fireEvent.change(screen.getByLabelText("Crop constraint"), { target: { value: "locked" } });
    expect(crop.onMode).toHaveBeenCalledWith("locked");
    const portrait = { ...project, settings: { ...project.settings, width: 360, height: 640 } };
    view.rerender(<CropProperties project={portrait} selectedClipId="c" controls={{ ...crop, active: true, mode: "locked" }} />);
    expect(screen.getByLabelText("Crop mode status").textContent).toBe("Crop active: Project aspect locked");
    fireEvent.change(screen.getByLabelText("Crop top (%)"), { target: { value: "10" } });
    const draft = vi.mocked(crop.onDraft).mock.calls.at(-1)![1]!;
    expect((1 - draft.left - draft.right) * 1920 / ((1 - draft.top - draft.bottom) * 1080)).toBeCloseTo(360 / 640);
    view.rerender(<CropProperties project={portrait} selectedClipId="c" controls={{ ...crop, draft: { clipId: "c", crop: { ...NO_CROP, left: 0.15 } } }} />);
    expect(screen.getByLabelText("Crop left (%)")).toHaveProperty("value", "15");
    expect(crop.onCommit).not.toHaveBeenCalled();
  });
  it.each(["pending", "locked", "offline"])("blocks %s edits", (reason) => {
    const p = structuredClone(project), crop = controls();
    if (reason === "locked") p.tracks[0]!.locked = true;
    if (reason === "offline") crop.offline = new Set(["a"]);
    render(<CropProperties project={p} selectedClipId="c" controls={crop} disabledReason={reason === "pending" ? "Resolve pending edit" : undefined} />);
    expect(screen.getByLabelText("Crop left (%)").closest("fieldset")).toHaveProperty("disabled", true);
    fireEvent.submit(screen.getByRole("form", { name: "Clip crop" }));
    expect(crop.onCommit).not.toHaveBeenCalled();
  });
});
