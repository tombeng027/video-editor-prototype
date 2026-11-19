// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@ve/schema";
import { createEmptyProject } from "@ve/timeline-core";
import { ClipProperties, pickBarHandle } from "./ClipProperties.js";

const project: Project = {
  ...createEmptyProject({ id: "p", name: "Properties", fps: { num: 30, den: 1 }, width: 640, height: 360 }),
  assets: [{ id: "a", kind: "video", name: "Video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
    contentHash: "fixture", durationFrames: 300, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: true, proxyPath: null }],
  tracks: [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
    { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true },
    { id: "other", assetId: "a", timelineStart: 90, sourceIn: 30, sourceOut: 60, speed: 1, audioLinked: true },
  ] }],
};
afterEach(cleanup);
const props = () => ({ project, selectedClipId: "c", onTrim: vi.fn(), onTransform: vi.fn(), onSpeed: vi.fn(), onAnimations: vi.fn() });
const expand = (section: "Trim" | "Appearance") => {
  const summary = screen.getByText(section, { selector: "summary" });
  if (!summary.closest("details")!.open) fireEvent.click(summary);
};
const change = (label: string, value: string) => {
  expand(label.startsWith("Source") ? "Trim" : "Appearance");
  fireEvent.change(screen.getByRole("spinbutton", { name: label }), { target: { value } });
};

describe("Clip properties", () => {
  it("disables appearance changes while Crop mode is active", () => {
    const p = props(), cropControls = { active: true, mode: "free" as const,
      onActive: vi.fn(), onMode: vi.fn(), onDraft: vi.fn(), onCommit: vi.fn() };
    const view = render(<ClipProperties {...p} cropControls={cropControls} />);
    expand("Appearance");
    const form = screen.getByRole("form", { name: "Clip appearance" });
    expect(form.querySelector("fieldset")).toHaveProperty("disabled", true);
    fireEvent.submit(form);
    expect(p.onTransform).not.toHaveBeenCalled();
    view.rerender(<ClipProperties {...p} cropControls={{ ...cropControls, active: false }} />);
    expect(form.querySelector("fieldset")).toHaveProperty("disabled", false);
  });
  it("defaults animation length to 0.5 seconds as a share of the clip and flags lengths too short to show", () => {
    const p = props();
    const view = render(<ClipProperties {...p} />);
    fireEvent.click(screen.getByText("Animations", { selector: "summary" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Entrance animation" }), { target: { value: "entrance.fade" } });
    expect((screen.getByRole("spinbutton", { name: "Entrance length (% of clip)" }) as HTMLInputElement).value).toBe("17");
    expect(screen.getByText(/0\.50 s \(15 frames\)/)).toBeDefined();
    fireEvent.submit(screen.getByRole("form", { name: "Clip animations" }));
    expect(p.onAnimations).toHaveBeenLastCalledWith("c", { entrance: { id: "entrance.fade", version: 1, durationPercent: 17 } });
    view.rerender(<ClipProperties {...p} selectedClipId="other" />);
    fireEvent.click(screen.getByText("Animations", { selector: "summary" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Entrance animation" }), { target: { value: "entrance.fade" } });
    expect((screen.getByRole("spinbutton", { name: "Entrance length (% of clip)" }) as HTMLInputElement).value).toBe("50");
    const lowRate = structuredClone(project); lowRate.settings.fps = { num: 1, den: 1 };
    view.rerender(<ClipProperties {...p} project={lowRate} />);
    fireEvent.click(screen.getByText("Animations", { selector: "summary" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Entrance animation" }), { target: { value: "entrance.fade" } });
    expect((screen.getByRole("spinbutton", { name: "Entrance length (% of clip)" }) as HTMLInputElement).value).toBe("1");
    expect(screen.getByText(/Too short to show/)).toBeDefined();
  });
  it("offers five presets per end plus None, shares at most 100% between ends and applies only on confirmation", () => {
    const p = props(); render(<ClipProperties {...p} />);
    fireEvent.click(screen.getByText("Animations", { selector: "summary" }));
    const entrance = screen.getByRole("combobox", { name: "Entrance animation" });
    const exit = screen.getByRole("combobox", { name: "Exit animation" });
    expect(entrance.querySelectorAll("option")).toHaveLength(6);
    expect(exit.querySelectorAll("option")).toHaveLength(6);
    fireEvent.change(entrance, { target: { value: "entrance.zoom" } });
    fireEvent.change(exit, { target: { value: "exit.fade" } });
    fireEvent.click(screen.getByRole("button", { name: "Increase Entrance length (% of clip)" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Exit length (% of clip)" }), { target: { value: "40" } });
    expect(screen.getByRole("spinbutton", { name: "Entrance length (% of clip)" }).getAttribute("max")).toBe("60");
    expect(screen.getByRole("spinbutton", { name: "Exit length (% of clip)" }).getAttribute("max")).toBe("82");
    // One shared bar: the exit handle grows leftward from the right edge and stops at the entrance handle.
    const exitHandle = screen.getByRole("slider", { name: "Exit length (% of clip) slider" });
    fireEvent.keyDown(exitHandle, { key: "ArrowLeft" });
    expect((screen.getByRole("spinbutton", { name: "Exit length (% of clip)" }) as HTMLInputElement).value).toBe("41");
    fireEvent.keyDown(exitHandle, { key: "Home" });
    expect((screen.getByRole("spinbutton", { name: "Exit length (% of clip)" }) as HTMLInputElement).value).toBe("82");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Exit length (% of clip)" }), { target: { value: "40" } });
    expect(p.onAnimations).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "Clip animations" }));
    expect(p.onAnimations).toHaveBeenCalledExactlyOnceWith("c", {
      entrance: { id: "entrance.zoom", version: 1, durationPercent: 18 },
      exit: { id: "exit.fade", version: 1, durationPercent: 40 },
    });
    p.onAnimations.mockClear();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Exit length (% of clip)" }), { target: { value: "90" } });
    fireEvent.submit(screen.getByRole("form", { name: "Clip animations" }));
    expect(screen.getByRole("alert").textContent).toContain("cannot exceed 100%");
    expect(p.onAnimations).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Exit length (% of clip)" }), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("form", { name: "Clip animations" }));
    expect(screen.getByRole("alert").textContent).toContain("1% to 100%");
  });
  it("keeps both animation handles reachable when they meet: dragging left moves entrance, right moves exit", () => {
    const p = props(); render(<ClipProperties {...p} />);
    fireEvent.click(screen.getByText("Animations", { selector: "summary" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Entrance animation" }), { target: { value: "entrance.fade" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Exit animation" }), { target: { value: "exit.fade" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Entrance length (% of clip)" }), { target: { value: "70" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Exit length (% of clip)" }), { target: { value: "30" } });
    const bar = document.querySelector<HTMLElement>(".range-bar")!;
    // 16px thumb inset on each side: clientX 8..108 maps to 0..100%.
    Object.defineProperty(bar, "getBoundingClientRect", { value: () => ({ left: 0, width: 116, top: 0, height: 28, right: 116, bottom: 28 }) });
    const value = (name: string) => (screen.getByRole("spinbutton", { name }) as HTMLInputElement).value;
    fireEvent.pointerDown(bar, { button: 0, clientX: 78, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 58, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 58, pointerId: 1 });
    expect([value("Entrance length (% of clip)"), value("Exit length (% of clip)")]).toEqual(["50", "30"]);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Entrance length (% of clip)" }), { target: { value: "70" } });
    fireEvent.pointerDown(bar, { button: 0, clientX: 78, pointerId: 2 });
    fireEvent.pointerMove(bar, { clientX: 98, pointerId: 2 });
    fireEvent.pointerUp(bar, { clientX: 98, pointerId: 2 });
    expect([value("Entrance length (% of clip)"), value("Exit length (% of clip)")]).toEqual(["70", "10"]);
    // Pressing the empty track moves the nearer handle there.
    fireEvent.pointerDown(bar, { button: 0, clientX: 18, pointerId: 3 });
    fireEvent.pointerUp(bar, { clientX: 18, pointerId: 3 });
    expect(value("Entrance length (% of clip)")).toBe("10");
    expect(pickBarHandle(99, 100, 100, 5)).toBe("undecided");
    expect(pickBarHandle(10, 30, 90, 5)).toBe("start");
    expect(pickBarHandle(80, 30, 90, 5)).toBe("end");
    expect(pickBarHandle(50, undefined, 90, 5)).toBe("end");
    expect(p.onAnimations).not.toHaveBeenCalled();
  });
  it("shows earlier fixed-length animations as a percentage, removes explicitly, blocks locked/pending changes and hides for audio", () => {
    const animated = structuredClone(project);
    animated.tracks[0]!.clips[0]!.animations = { entrance: { id: "entrance.fade", version: 1, durationFrames: 15 } };
    const p = props(), view = render(<ClipProperties {...p} project={animated} />);
    fireEvent.click(screen.getByText("Animations", { selector: "summary" }));
    expect((screen.getByRole("spinbutton", { name: "Entrance length (% of clip)" }) as HTMLInputElement).value).toBe("16.67");
    fireEvent.click(screen.getByRole("button", { name: "Remove animations" }));
    expect(p.onAnimations).toHaveBeenCalledExactlyOnceWith("c");
    p.onAnimations.mockClear();
    view.rerender(<ClipProperties {...p} project={animated} disabledReason="Edit pending" />);
    fireEvent.submit(screen.getByRole("form", { name: "Clip animations" }));
    expect(p.onAnimations).not.toHaveBeenCalled();
    const audio = structuredClone(project); audio.tracks[0]!.kind = "audio";
    view.rerender(<ClipProperties {...p} project={audio} />);
    expect(screen.queryByRole("form", { name: "Clip animations" })).toBeNull();
  });
  it("applies validated clip speed only on confirmation and disables speed for locked/pending edits", () => {
    const p = props(), view = render(<ClipProperties {...p} />);
    const changeSpeed = (value: string) => fireEvent.change(screen.getByRole("spinbutton", { name: "Clip speed (x)" }), { target: { value } });
    changeSpeed("2");
    expect(p.onSpeed).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "Clip speed" }));
    expect(p.onSpeed).toHaveBeenCalledExactlyOnceWith("c", 2);
    p.onSpeed.mockClear();
    for (const value of ["", "0", "0.24", "4.01"]) {
      changeSpeed(value);
      fireEvent.submit(screen.getByRole("form", { name: "Clip speed" }));
      expect(screen.getByRole("alert").textContent).toContain("0.25x to 4x");
    }
    changeSpeed("0.25");
    view.rerender(<ClipProperties {...p} disabledReason="Edit pending" />);
    fireEvent.submit(screen.getByRole("form", { name: "Clip speed" }));
    expect(p.onSpeed).not.toHaveBeenCalled();
    view.rerender(<ClipProperties {...p} project={{ ...project, tracks: project.tracks.map((track) => ({ ...track, locked: true })) }} />);
    fireEvent.submit(screen.getByRole("form", { name: "Clip speed" }));
    expect(p.onSpeed).not.toHaveBeenCalled();
    view.rerender(<ClipProperties {...p} project={{ ...project, assets: project.assets.map((asset) => ({ ...asset, kind: "image" })) }} />);
    expect(screen.queryByRole("form", { name: "Clip speed" })).toBeNull();
  });
  it("saves speed from the slider on release, and combines -/+ bursts into one edit", async () => {
    vi.useFakeTimers();
    try {
      const p = props(); render(<ClipProperties {...p} />);
      const speedSlider = screen.getByRole("slider", { name: "Clip speed (x) slider" });
      fireEvent.change(speedSlider, { target: { value: "2.5" } });
      expect(p.onSpeed).not.toHaveBeenCalled();
      fireEvent.pointerUp(speedSlider);
      fireEvent.blur(speedSlider);
      expect(p.onSpeed).toHaveBeenCalledExactlyOnceWith("c", 2.5);
      p.onSpeed.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Increase Clip speed (x)" }));
      fireEvent.click(screen.getByRole("button", { name: "Increase Clip speed (x)" }));
      expect(p.onSpeed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      expect(p.onSpeed).toHaveBeenCalledExactlyOnceWith("c", 2.6);
    } finally { vi.useRealTimers(); }
  });
  it("adds a two-point zoom, previews drafts live, saves on release and sets points at the playhead", async () => {
    const onZoom = vi.fn(), onZoomPreview = vi.fn();
    let playhead = 80;
    const p = { ...props(), onZoom, onZoomPreview, playheadFrame: () => playhead };
    const view = render(<ClipProperties {...p} />);
    fireEvent.click(screen.getByText("Zoom", { selector: "summary" }));
    // jsdom queues the details toggle event.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("button", { name: "Add zoom" }));
    const added = { version: 1, startPercent: 25, endPercent: 75, startScale: 1, endScale: 1.5 };
    expect(onZoom).toHaveBeenLastCalledWith("c", added);
    const saved = structuredClone(project);
    saved.tracks[0]!.clips[0]!.zoom = added as never;
    view.rerender(<ClipProperties {...p} project={saved} />);
    expect(screen.getByText("Zoom", { selector: "summary" }).closest("details")!.open).toBe(true);
    const endScale = screen.getByRole("slider", { name: "End scale (%) slider" });
    fireEvent.change(endScale, { target: { value: "200" } });
    expect(onZoomPreview).toHaveBeenLastCalledWith("c", { ...added, endScale: 2 });
    expect(onZoom).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(endScale);
    expect(onZoom).toHaveBeenLastCalledWith("c", { ...added, endScale: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Set start at playhead" }));
    expect(screen.getByRole("alert").textContent).toMatch(/before the end/);
    playhead = 9;
    fireEvent.click(screen.getByRole("button", { name: "Set start at playhead" }));
    expect(onZoom).toHaveBeenLastCalledWith("c", { ...added, startPercent: 10, endScale: 2 });
    playhead = 200;
    fireEvent.click(screen.getByRole("button", { name: "Set end at playhead" }));
    expect(screen.getByRole("alert").textContent).toMatch(/inside this clip/);
    const endHandle = screen.getByRole("slider", { name: "Zoom end point (% of clip) slider" });
    fireEvent.keyDown(endHandle, { key: "Home" });
    expect(onZoomPreview).toHaveBeenLastCalledWith("c", expect.objectContaining({ startPercent: 10, endPercent: 11 }));
    fireEvent.click(screen.getByRole("button", { name: "Remove zoom" }));
    expect(onZoomPreview).toHaveBeenLastCalledWith("c", null);
    expect(onZoom).toHaveBeenLastCalledWith("c", undefined);
    view.rerender(<ClipProperties {...p} project={saved} selectedClipId="other" />);
    expect(screen.getByText("Zoom", { selector: "summary" }).closest("details")!.open).toBe(false);
  });
  it("starts compact and independently expands or collapses sections without editing or losing drafts", () => {
    const p = props(), view = render(<ClipProperties {...p} />);
    const sections = view.container.querySelectorAll("details");
    expect(Array.from(sections).every((section) => !section.open)).toBe(true);
    expand("Appearance");
    change("Zoom (%)", "175");
    expect(sections[1]!.open).toBe(false);
    fireEvent.click(screen.getByText("Appearance", { selector: "summary" }));
    expect(sections[0]!.open).toBe(false);
    expand("Appearance");
    expect((screen.getByRole("spinbutton", { name: "Zoom (%)" }) as HTMLInputElement).value).toBe("175");
    fireEvent.click(screen.getByText("Animations", { selector: "summary" }));
    expect(Array.from(sections).every((section) => section.open)).toBe(true);
    expect(p.onTransform).not.toHaveBeenCalled();
  });
  it("explains selection, missing clips and planned features without sending edits", () => {
    const p = props(), view = render(<ClipProperties {...p} selectedClipId={null} />);
    expect(screen.getByText(/Select a timeline clip/)).toBeDefined();
    view.rerender(<ClipProperties {...p} selectedClipId="gone" />);
    expect(screen.queryByRole("form")).toBeNull();
    view.rerender(<ClipProperties {...p} />);
    expect(screen.getByText(/1x/)).toBeDefined();
    expect(p.onTransform).not.toHaveBeenCalled();
  });

  it("previews slider drags live and saves once on release; rapid -/+ clicks combine into one saved edit", () => {
    vi.useFakeTimers();
    try {
      const onAppearancePreview = vi.fn();
      const p = { ...props(), onAppearancePreview }, view = render(<ClipProperties {...p} />);
      expand("Appearance");
      const slider = screen.getByRole("slider", { name: "Zoom (%) slider" });
      expect(slider.getAttribute("min")).toBe("10");
      expect(slider.getAttribute("max")).toBe("400");
      fireEvent.change(slider, { target: { value: "140" } });
      fireEvent.change(slider, { target: { value: "150" } });
      expect(onAppearancePreview).toHaveBeenLastCalledWith("c", { x: 0.5, y: 0.5, scale: 1.5, opacity: 1 });
      expect(p.onTransform).not.toHaveBeenCalled();
      fireEvent.pointerUp(slider);
      expect(p.onTransform).toHaveBeenCalledExactlyOnceWith("c", { x: 0.5, y: 0.5, scale: 1.5, opacity: 1 });
      p.onTransform.mockClear();
      view.rerender(<ClipProperties {...p} selectedClipId="other" />);
      expand("Appearance");
      for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole("button", { name: "Decrease Opacity (%)" }));
      expect(onAppearancePreview).toHaveBeenLastCalledWith("other", { x: 0.5, y: 0.5, scale: 1, opacity: 0.97 });
      expect(p.onTransform).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);
      expect(p.onTransform).toHaveBeenCalledExactlyOnceWith("other", { x: 0.5, y: 0.5, scale: 1, opacity: 0.97 });
      p.onTransform.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Increase Center X (%)" }));
      view.rerender(<ClipProperties {...p} selectedClipId={null} />);
      expect(p.onTransform).toHaveBeenCalledExactlyOnceWith("other", { x: 0.51, y: 0.5, scale: 1, opacity: 0.97 });
    } finally { vi.useRealTimers(); }
  });

  it("drops an unreleased preview when the selection changes without saving", () => {
    const onAppearancePreview = vi.fn();
    const p = { ...props(), onAppearancePreview }, view = render(<ClipProperties {...p} />);
    expand("Appearance");
    fireEvent.change(screen.getByRole("slider", { name: "Opacity (%) slider" }), { target: { value: "30" } });
    view.rerender(<ClipProperties {...p} selectedClipId="other" />);
    expect(onAppearancePreview).toHaveBeenLastCalledWith("c", null);
    expect(p.onTransform).not.toHaveBeenCalled();
  });

  it("applies appearance only on confirmation, normalizes percentages and resets explicitly", () => {
    const p = props(), view = render(<ClipProperties {...p} />);
    change("Zoom (%)", "150"); change("Center X (%)", "75"); change("Opacity (%)", "25");
    expect(p.onTransform).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "Clip appearance" }));
    expect(p.onTransform).toHaveBeenCalledExactlyOnceWith("c", { x: 0.75, y: 0.5, scale: 1.5, opacity: 0.25 });
    const updated = structuredClone(project);
    updated.tracks[0]!.clips[0]!.transform = { x: 0.75, y: 0.5, scale: 1.5, opacity: 0.25 };
    view.rerender(<ClipProperties {...p} project={updated} />);
    expand("Appearance");
    fireEvent.click(screen.getByRole("button", { name: "Reset appearance" }));
    expect(p.onTransform).toHaveBeenLastCalledWith("c");
    expect((screen.getByRole("spinbutton", { name: "Zoom (%)" }) as HTMLInputElement).value).toBe("100");
  });

  it("validates appearance bounds and does not autosave each keystroke", () => {
    const p = props(); render(<ClipProperties {...p} />);
    change("Zoom (%)", "0");
    fireEvent.submit(screen.getByRole("form", { name: "Clip appearance" }));
    expect(screen.getByRole("alert").textContent).toContain("zoom 1 to 1000%");
    expect(p.onTransform).not.toHaveBeenCalled();
  });

  it("resets drafts when selection or confirmed clip values change, and blocks locked/pending edits", () => {
    const p = props(), view = render(<ClipProperties {...p} />);
    change("Zoom (%)", "170");
    view.rerender(<ClipProperties {...p} selectedClipId="other" />);
    expand("Appearance");
    expect((screen.getByRole("spinbutton", { name: "Zoom (%)" }) as HTMLInputElement).value).toBe("100");
    const locked = structuredClone(project);
    locked.tracks[0]!.locked = true;
    view.rerender(<ClipProperties {...p} project={locked} />);
    expand("Appearance");
    fireEvent.submit(screen.getByRole("form", { name: "Clip appearance" }));
    expect(screen.getByText(/Unlock this track/)).toBeDefined();
    expect((screen.getByRole("spinbutton", { name: "Zoom (%)" }) as HTMLInputElement).disabled ||
      screen.getByRole("spinbutton", { name: "Zoom (%)" }).closest("fieldset")?.disabled).toBe(true);
    view.rerender(<ClipProperties {...p} disabledReason="Edit pending" />);
    fireEvent.submit(screen.getByRole("form", { name: "Clip appearance" }));
    expect(p.onTransform).not.toHaveBeenCalled();
  });

  it("leaves trimming to the timeline and offers no visual appearance controls for audio-row clips", () => {
    const audio = structuredClone(project); audio.tracks[0]!.kind = "audio";
    render(<ClipProperties {...props()} project={audio} />);
    expect(screen.queryByRole("form", { name: "Clip trim" })).toBeNull();
    expect(screen.getByRole("form", { name: "Clip speed" })).toBeDefined();
    expect(screen.queryByRole("form", { name: "Clip appearance" })).toBeNull();
  });
});
