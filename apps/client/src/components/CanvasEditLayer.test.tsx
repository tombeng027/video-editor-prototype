// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { animatedTransform, clipCanvasRect, type Project } from "@ve/schema";
import { createEmptyProject } from "@ve/timeline-core";
import { PlayheadClock, type Scheduler } from "../clock.js";
import { CanvasEditLayer } from "./CanvasEditLayer.js";
import { NO_CROP, type CropControls } from "../cropEdit.js";

const fps = { num: 30, den: 1 };
const scheduler: Scheduler = { now: () => 0, request: () => 1, cancel: () => undefined };
const asset = (id: string) => ({
  id, kind: "video" as const, name: `${id}.mp4`, mediaMode: "reference" as const, sourcePath: `C:/${id}.mp4`, contentHash: id,
  durationFrames: 90, fps, width: 640, height: 360, hasAudio: false, proxyPath: null,
});
const project: Project = {
  ...createEmptyProject({ id: "p", name: "Canvas", fps, width: 640, height: 360 }),
  assets: [asset("bg"), asset("pip")],
  tracks: [
    { id: "base", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "bg", assetId: "bg", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true },
    ] },
    { id: "top", kind: "overlay", order: 1, muted: false, locked: false, clips: [
      { id: "pip", assetId: "pip", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true,
        transform: { x: 0.75, y: 0.25, scale: 0.25, opacity: 1 } },
    ] },
  ],
};

// The canvas is drawn 640x360 at the page origin, so client pixels map 1:1 to project pixels.
const pointer = (type: string, x: number, y: number, extra: { button?: number; altKey?: boolean } = {}) => {
  const event = new MouseEvent(type, { bubbles: true, button: extra.button ?? 0, clientX: x, clientY: y, altKey: extra.altKey ?? false });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
};

function setup(overrides: Partial<Parameters<typeof CanvasEditLayer>[0]> = {}) {
  const clock = new PlayheadClock(scheduler);
  clock.configure(fps, 90);
  const props = {
    project, clock, selectedClipId: null as string | null, snapping: true,
    onSelect: vi.fn(), onDraft: vi.fn(), onCommit: vi.fn(), onLayer: vi.fn(), ...overrides,
  };
  const view = render(<CanvasEditLayer {...props} />);
  const canvas = screen.getByLabelText(/^Canvas:/);
  return { ...props, clock, view, canvas };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    { left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("canvas editing", () => {
  const cropControls = (): CropControls => ({ active: true, mode: "free", onActive: vi.fn(), onMode: vi.fn(), onDraft: vi.fn(), onCommit: vi.fn() });
  it("disables constraint choices outside Crop and visibly marks the current shared constraint", () => {
    const crop = cropControls(), props = setup({ selectedClipId: "pip", cropControls: { ...crop, active: false } });
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    const free = screen.getByRole("menuitemradio", { name: "Free-form crop" });
    const locked = screen.getByRole("menuitemradio", { name: "Project aspect locked crop" });
    expect(free).toHaveProperty("disabled", true);
    expect(locked).toHaveProperty("disabled", true);
    expect(free.getAttribute("aria-checked")).toBe("true");
    expect(free.querySelector(".menu-choice-indicator")?.textContent).toBe("\u25cf");
    fireEvent.click(locked);
    expect(crop.onMode).not.toHaveBeenCalled();
    props.view.rerender(<CanvasEditLayer {...props} cropControls={crop} />);
    expect(locked).toHaveProperty("disabled", false);
    fireEvent.click(locked);
    expect(crop.onMode).toHaveBeenCalledWith("locked");
    props.view.rerender(<CanvasEditLayer {...props} cropControls={{ ...crop, mode: "locked" }} />);
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    const selected = screen.getByRole("menuitemradio", { name: "Project aspect locked crop" });
    expect(selected.getAttribute("aria-checked")).toBe("true");
    expect(selected.querySelector(".menu-choice-indicator")?.textContent).toBe("\u25cf");
    expect(screen.getByRole("menuitemradio", { name: "Free-form crop" }).getAttribute("aria-checked")).toBe("false");
  });
  it("cancels a resize when Crop is enabled and never sends transform edits during cropping", () => {
    const crop = cropControls();
    const props = setup({ selectedClipId: "pip", cropControls: { ...crop, active: false } });
    fireEvent(screen.getByLabelText("Resize from se corner"), pointer("pointerdown", 560, 135));
    fireEvent(props.canvas, pointer("pointermove", 600, 160));
    expect(props.onDraft).toHaveBeenCalled();
    props.view.rerender(<CanvasEditLayer {...props} cropControls={crop} />);
    expect(props.onDraft).toHaveBeenLastCalledWith("pip", null);
    fireEvent(props.canvas, pointer("pointermove", 620, 170));
    fireEvent(props.canvas, pointer("pointerup", 620, 170));
    expect(props.onCommit).not.toHaveBeenCalled();
    vi.mocked(props.onDraft).mockClear();
    fireEvent(props.canvas, pointer("pointerdown", 480, 90));
    fireEvent(props.canvas, pointer("pointermove", 500, 100));
    fireEvent(props.canvas, pointer("pointerup", 500, 100));
    expect(props.onDraft).not.toHaveBeenCalled();
    expect(props.onCommit).not.toHaveBeenCalled();
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    expect(screen.getByRole("menuitem", { name: "Fit to canvas" })).toHaveProperty("disabled", true);
  });
  it("portals the measured menu outside the clipped canvas, clamps to viewport and dismisses it", () => {
    const props = setup();
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(props.canvas.contains(menu)).toBe(false);
    expect(parseFloat(menu.style.left) + 640).toBeLessThanOrEqual(window.innerWidth);
    expect(parseFloat(menu.style.top) + 360).toBeLessThanOrEqual(window.innerHeight);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    fireEvent.scroll(window);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("crops an edge with a captured source mapping through live refits and commits once", () => {
    const crop = cropControls();
    const props = setup({ selectedClipId: "pip", cropControls: crop });
    expect(screen.queryByLabelText("Resize from se corner")).toBeNull();
    fireEvent(screen.getByLabelText("Crop from w edge"), pointer("pointerdown", 400, 90));
    fireEvent(props.canvas, pointer("pointermove", 416, 90));
    expect(crop.onDraft).toHaveBeenLastCalledWith("pip", { ...NO_CROP, left: expect.closeTo(0.1, 10) });
    const draft = structuredClone(project);
    draft.tracks[1]!.clips[0]!.crop = { ...NO_CROP, left: 0.1 };
    props.view.rerender(<CanvasEditLayer {...props} project={draft} />);
    const selection = screen.getByTestId("canvas-selection");
    expect((parseFloat(selection.style.left) + parseFloat(selection.style.width)) * 6.4).toBeCloseTo(560, 8);
    expect(parseFloat(selection.style.height) * 3.6).toBeCloseTo(90, 8);
    fireEvent(props.canvas, pointer("pointermove", 432, 90));
    expect(crop.onDraft).toHaveBeenLastCalledWith("pip", { ...NO_CROP, left: expect.closeTo(0.2, 10) });
    expect(crop.onCommit).not.toHaveBeenCalled();
    fireEvent(props.canvas, pointer("pointerup", 432, 90));
    expect(crop.onCommit).toHaveBeenCalledExactlyOnceWith("pip", { ...NO_CROP, left: expect.closeTo(0.2, 10) });
    expect(props.onCommit).not.toHaveBeenCalled();
  });
  it("maps a drag on an already cropped odd-pixel source without changing the source footprint", () => {
    const cropped = structuredClone(project);
    cropped.assets[1]!.width = 101; cropped.assets[1]!.height = 61;
    cropped.tracks[1]!.clips[0]!.crop = { left: 0.13, top: 0, right: 0.12, bottom: 0 };
    const crop = cropControls(), props = setup({ project: cropped, selectedClipId: "pip", cropControls: crop });
    const selection = screen.getByTestId("canvas-selection");
    const left = parseFloat(selection.style.left) * 6.4;
    const source = clipCanvasRect(cropped.tracks[1]!.clips[0]!.transform, cropped.settings, cropped.assets[1]);
    fireEvent(screen.getByLabelText("Crop from w edge"), pointer("pointerdown", left, 90));
    fireEvent(props.canvas, pointer("pointermove", left + source.width * 640 * 0.1, 90));
    fireEvent(props.canvas, pointer("pointerup", left + source.width * 640 * 0.1, 90));
    expect(crop.onCommit).toHaveBeenLastCalledWith("pip", { left: 0.23, top: 0, right: 0.12, bottom: 0 });
    expect(props.onCommit).not.toHaveBeenCalled();
  });
  it("uses both axes for free corners and pixel aspect locking for a vertical corner gesture", () => {
    const crop = cropControls();
    const props = setup({ selectedClipId: "pip", cropControls: crop });
    fireEvent(screen.getByLabelText("Crop from se edge"), pointer("pointerdown", 560, 135));
    fireEvent(props.canvas, pointer("pointermove", 544, 126));
    fireEvent(props.canvas, pointer("pointerup", 544, 126));
    expect(crop.onCommit).toHaveBeenLastCalledWith("pip", { ...NO_CROP, right: expect.closeTo(0.1, 10), bottom: expect.closeTo(0.1, 10) });
    crop.mode = "locked";
    const portrait = { ...project, settings: { ...project.settings, width: 360, height: 640 } };
    props.view.rerender(<CanvasEditLayer {...props} project={portrait} />);
    const selection = screen.getByTestId("canvas-selection");
    const right = (parseFloat(selection.style.left) + parseFloat(selection.style.width)) * 6.4;
    const bottom = (parseFloat(selection.style.top) + parseFloat(selection.style.height)) * 3.6;
    fireEvent(screen.getByLabelText("Crop from se edge"), pointer("pointerdown", right, bottom));
    fireEvent(props.canvas, pointer("pointermove", right, bottom - 5));
    fireEvent(props.canvas, pointer("pointerup", right, bottom - 5));
    const result = vi.mocked(crop.onCommit).mock.calls.at(-1)![1]!;
    expect((1 - result.left - result.right) * 640 / ((1 - result.top - result.bottom) * 360)).toBeCloseTo(360 / 640);
    expect(result.bottom).toBeGreaterThan(0);
  });
  it.each(["pointercancel", "lostpointercapture", "escape", "lock"])("cancels crop drafts on %s without committing", (reason) => {
    const crop = cropControls(), props = setup({ selectedClipId: "pip", cropControls: crop });
    fireEvent(screen.getByLabelText("Crop from w edge"), pointer("pointerdown", 400, 90));
    fireEvent(props.canvas, pointer("pointermove", 432, 90));
    if (reason === "escape") fireEvent.keyDown(props.canvas, { key: "Escape" });
    else if (reason === "lock") props.view.rerender(<CanvasEditLayer {...props} disabledReason="Resolve pending edit" />);
    else fireEvent(props.canvas, pointer(reason, 432, 90));
    expect(crop.onDraft).toHaveBeenLastCalledWith("pip", null);
    fireEvent(props.canvas, pointer("pointerup", 432, 90));
    expect(crop.onCommit).not.toHaveBeenCalled();
  });
  it("does not commit clicks or a crop drag returned to its start, and shares right-click choices", () => {
    const crop = cropControls(), props = setup({ selectedClipId: "pip", cropControls: crop });
    const handle = screen.getByLabelText("Crop from w edge");
    fireEvent(handle, pointer("pointerdown", 400, 90));
    fireEvent(props.canvas, pointer("pointerup", 400, 90));
    expect(crop.onCommit).not.toHaveBeenCalled();
    fireEvent(handle, pointer("pointerdown", 400, 90));
    fireEvent(props.canvas, pointer("pointermove", 432, 90));
    fireEvent(props.canvas, pointer("pointermove", 400, 90));
    fireEvent(props.canvas, pointer("pointerup", 400, 90));
    expect(crop.onCommit).not.toHaveBeenCalled();
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Project aspect locked crop" }));
    expect(crop.onMode).toHaveBeenCalledWith("locked");
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Exit crop mode" }));
    expect(crop.onActive).toHaveBeenCalledWith(false);
    props.view.rerender(<CanvasEditLayer {...props} disabledReason="Resolve pending edit" />);
    expect(screen.queryByLabelText("Crop from w edge")).toBeNull();
  });
  it("fits from the right-click menu and respects locked or disabled editing", () => {
    const props = setup();
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Fit to canvas" }));
    expect(props.onCommit).toHaveBeenCalledWith("pip", { x: 0.5, y: 0.5, scale: 1, opacity: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
    const locked = structuredClone(project);
    locked.tracks[1]!.locked = true;
    props.view.rerender(<CanvasEditLayer {...props} project={locked} />);
    fireEvent.contextMenu(props.canvas, { clientX: 480, clientY: 90 });
    expect(screen.getByRole("menuitem", { name: "Fit to canvas" })).toHaveProperty("disabled", true);
    props.view.rerender(<CanvasEditLayer {...props} disabledReason="Resolve pending edit." />);
    expect(screen.getByRole("menuitem", { name: "Fit to canvas" })).toHaveProperty("disabled", true);
  });

  it("keeps handles on the displayed zoomed picture after portrait resize/move and a landscape switch", () => {
    const portrait = structuredClone(project);
    portrait.settings = { ...portrait.settings, width: 360, height: 640 };
    const clip = portrait.tracks[1]!.clips[0]!;
    clip.transform = { x: 0.6, y: 0.4, scale: 0.5, opacity: 1 };
    clip.zoom = { version: 1, startPercent: 0, endPercent: 100, startScale: 1, endScale: 2 };
    const props = setup({ project: portrait, selectedClipId: "pip" });
    act(() => props.clock.seek(45));
    const check = (p: Project, frame: number) => {
      const current = p.tracks[1]!.clips[0]!;
      const displayed = animatedTransform(current.animations, 90, frame, current.transform, current.zoom);
      const rect = clipCanvasRect(displayed, p.settings, p.assets[1]);
      const selection = screen.getByTestId("canvas-selection");
      for (const [key, value] of Object.entries(rect)) {
        expect(parseFloat(selection.style[key as "left" | "top" | "width" | "height"])).toBeCloseTo(value * 100);
      }
    };
    check(portrait, 45);
    const landscape = { ...portrait, settings: { ...portrait.settings, width: 640, height: 360 } };
    props.view.rerender(<CanvasEditLayer {...props} project={landscape} />);
    check(landscape, 45);
    // At halfway through the zoom, the displayed scale is 0.75; doubling its radius saves base scale 1, not 1.5.
    fireEvent(screen.getByLabelText("Resize from se corner"), pointer("pointerdown", 624, 279));
    fireEvent(props.canvas, pointer("pointermove", 864, 414, { altKey: true }));
    fireEvent(props.canvas, pointer("pointerup", 864, 414));
    expect(props.onCommit).toHaveBeenLastCalledWith("pip", { x: 0.6, y: 0.4, scale: 1, opacity: 1 });
    act(() => props.clock.seek(90));
    check(landscape, 89);
  });

  it("uses cropped bounds for selection and hit-testing instead of the full source picture", () => {
    const cropped = structuredClone(project);
    cropped.tracks[1]!.clips[0]!.crop = { left: 0.25, right: 0.25, top: 0, bottom: 0 };
    const { canvas, onSelect } = setup({ project: cropped, selectedClipId: "pip" });
    const selection = screen.getByTestId("canvas-selection");
    expect(selection.style.width).toBe("12.5%");
    expect(selection.style.height).toBe("25%");
    fireEvent(canvas, pointer("pointerdown", 410, 90));
    fireEvent(canvas, pointer("pointerup", 410, 90));
    expect(onSelect).toHaveBeenLastCalledWith("bg");
    fireEvent(canvas, pointer("pointerdown", 480, 90));
    expect(onSelect).toHaveBeenLastCalledWith("pip");
  });

  it("uses the cropped aspect when snapping a proportional resize", () => {
    const cropped = structuredClone(project);
    cropped.tracks[1]!.clips[0]!.crop = { left: 0.25, right: 0.25, top: 0, bottom: 0 };
    const { canvas, onCommit } = setup({ project: cropped, selectedClipId: "pip" });
    const corner = screen.getByLabelText("Resize from se corner");
    fireEvent(corner, pointer("pointerdown", 520, 135));
    fireEvent(canvas, pointer("pointermove", 638.4, 268.2));
    fireEvent(canvas, pointer("pointerup", 638.4, 268.2));
    expect(onCommit).toHaveBeenCalledWith("pip", { x: 0.75, y: 0.25, scale: 1, opacity: 1 });
  });

  it("selects the top-most picture and saves one move with snapping to the canvas center", () => {
    const { canvas, onSelect, onDraft, onCommit } = setup();
    fireEvent(canvas, pointer("pointerdown", 480, 90));
    expect(onSelect).toHaveBeenCalledWith("pip");
    fireEvent(canvas, pointer("pointermove", 480 - 158, 90 + 89));
    expect(onDraft).toHaveBeenLastCalledWith("pip", { x: 0.5, y: 0.5, scale: 0.25, opacity: 1 });
    fireEvent(canvas, pointer("pointerup", 480 - 158, 90 + 89));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("pip", { x: 0.5, y: 0.5, scale: 0.25, opacity: 1 });
  });

  it("moves freely while Alt is held and only selects on a plain click", () => {
    const { canvas, onDraft, onCommit, onSelect } = setup();
    fireEvent(canvas, pointer("pointerdown", 100, 300));
    fireEvent(canvas, pointer("pointerup", 100, 300));
    expect(onSelect).toHaveBeenCalledWith("bg");
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent(canvas, pointer("pointerdown", 480, 90));
    fireEvent(canvas, pointer("pointermove", 480 - 158, 90 + 89, { altKey: true }));
    expect(onDraft).toHaveBeenLastCalledWith("pip", { x: 0.5031, y: 0.4972, scale: 0.25, opacity: 1 });
  });

  it("resizes from a corner around the picture's center", () => {
    const { canvas, onCommit } = setup({ selectedClipId: "pip" });
    const corner = screen.getByLabelText("Resize from se corner");
    // The picture is 160x90 centered at 480,90; dragging the corner twice as far from the center doubles it.
    fireEvent(corner, pointer("pointerdown", 560, 135));
    fireEvent(canvas, pointer("pointermove", 640, 180, { altKey: true }));
    fireEvent(canvas, pointer("pointerup", 640, 180, { altKey: true }));
    expect(onCommit).toHaveBeenCalledWith("pip", { x: 0.75, y: 0.25, scale: 0.5, opacity: 1 });
  });

  it("pauses playback before editing and hides the outline while playing", () => {
    const { canvas, clock, onSelect } = setup({ selectedClipId: "pip" });
    act(() => clock.play());
    expect(screen.queryByTestId("canvas-selection")).toBeNull();
    fireEvent(canvas, pointer("pointerdown", 480, 90));
    expect(clock.playing).toBe(false);
    expect(onSelect).toHaveBeenCalledWith("pip");
    expect(screen.getByTestId("canvas-selection")).toBeTruthy();
  });

  it("offers layer order on right-click, disabling moves that cannot apply", () => {
    const { canvas, onLayer, onSelect } = setup();
    fireEvent.contextMenu(canvas, { clientX: 480, clientY: 90 });
    expect(onSelect).toHaveBeenCalledWith("pip");
    expect(screen.getByRole("menuitem", { name: "Bring forward" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("menuitem", { name: "Bring to front" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Send backward" }));
    expect(onLayer).toHaveBeenCalledWith("pip", "backward");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("selects but does not move pictures when editing is unavailable", () => {
    const { canvas, onSelect, onDraft } = setup({ disabledReason: "Resolve the pending edit before changing the canvas." });
    fireEvent(canvas, pointer("pointerdown", 480, 90));
    fireEvent(canvas, pointer("pointermove", 300, 200));
    expect(onSelect).toHaveBeenCalledWith("pip");
    expect(onDraft).not.toHaveBeenCalled();
  });
});
