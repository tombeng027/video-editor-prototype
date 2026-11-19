// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "@ve/timeline-core";
import { PlayheadClock } from "../clock.js";
import { timelineDuration } from "../playback.js";
import { PreviewCaptions } from "./PreviewCaptions.js";

afterEach(cleanup);
describe("Preview captions", () => {
  it("uses exclusive cue boundaries, gaps and plain multiline text without interpreting markup", () => {
    const project = { ...createEmptyProject({ id: "p", name: "Test", fps: { num: 30000, den: 1001 }, width: 1080, height: 1920 }),
      captionCues: [{ id: "one", start: 5, end: 10, text: "<b>Hello</b>\n世界" },
        { id: "two", start: 10, end: 12, text: "Adjacent" }, { id: "three", start: 15, end: 20, text: "Last" }] };
    const clock = new PlayheadClock();
    clock.configure(project.settings.fps, timelineDuration(project));
    const view = render(<PreviewCaptions project={project} clock={clock} />);
    const text = view.container.querySelector(".preview-caption-text")!;
    expect(text.textContent).toBe("");
    act(() => clock.seek(5));
    expect(text.textContent).toBe("<b>Hello</b>\n世界");
    expect(text.querySelector("b")).toBeNull();
    act(() => clock.seek(10));
    expect(text.textContent).toBe("Adjacent");
    act(() => clock.seek(12));
    expect(text.textContent).toBe("");
    act(() => clock.seek(19));
    expect(text.textContent).toBe("Last");
    act(() => clock.seek(20));
    expect(text.textContent).toBe("");
    expect(screen.getByLabelText("Preview captions").getAttribute("viewBox")).toBe("0 0 1080 1920");
    clock.dispose();
  });

  it("updates immediately when saved text/timing changes and includes caption-only duration", () => {
    const project = { ...createEmptyProject({ id: "p", name: "Test", fps: { num: 30, den: 1 }, width: 640, height: 360 }),
      captionCues: [{ id: "one", start: 0, end: 60, text: "Original" }] };
    expect(timelineDuration(project)).toBe(60);
    const clock = new PlayheadClock();
    clock.configure(project.settings.fps, 60);
    const view = render(<PreviewCaptions project={project} clock={clock} />);
    expect(view.container.textContent).toBe("Original");
    view.rerender(<PreviewCaptions project={{ ...project, captionCues: [{ ...project.captionCues[0]!, text: "Updated" }] }} clock={clock} />);
    expect(view.container.textContent).toBe("Updated");
    view.rerender(<PreviewCaptions project={{ ...project, captionCues: [] }} clock={clock} />);
    expect(view.container.textContent).toBe("");
    clock.dispose();
  });
});
