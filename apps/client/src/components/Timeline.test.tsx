// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@ve/schema";
import { createEmptyProject } from "@ve/timeline-core";
import { PlayheadClock } from "../clock.js";
import { Timeline } from "./Timeline.js";
import { ASSET_DRAG_TYPE } from "../assets.js";

const fps = { num: 30, den: 1 };
const pointerEvent = (type: string, values: { button?: number; pointerId?: number; clientX: number; clientY?: number }) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: values.button ?? 0,
    clientX: values.clientX,
    clientY: values.clientY ?? 0,
  });
  if (values.pointerId !== undefined) Object.defineProperty(event, "pointerId", { value: values.pointerId });
  return event;
};
const project: Project = {
  ...createEmptyProject({ id: "p", name: "Timeline", fps, width: 640, height: 360 }),
  assets: [{
    id: "a", kind: "video", name: "clip.mp4", mediaMode: "reference", sourcePath: "C:\\clip.mp4",
    contentHash: "a", durationFrames: 90, fps, width: 640, height: 360, hasAudio: false, proxyPath: "proxy.mp4",
  }],
  tracks: [
    { id: "base", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true },
    ] },
    { id: "overlay", kind: "overlay", order: 1, muted: false, locked: false, clips: [] },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
});

describe("Timeline visual editing", () => {
  it("shares horizontal scroll, zoom, playhead and caption-only playback duration with the caption lane", () => {
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const p = { ...project, tracks: [], captionCues: [{ id: "cue", start: 300, end: 600, text: "Beyond media" }] };
    const view = render(<Timeline project={p} clock={clock} selectedClipId={null} offline={new Set()}
      message={null} onSelect={vi.fn()} onSplit={vi.fn()} onDelete={vi.fn()} onTrim={vi.fn()}
      onAddVisualTrack={vi.fn()} onReorderVisualTrack={vi.fn()} onCaptionCommands={vi.fn().mockResolvedValue(true)} />);
    expect(clock.length).toBe(600);
    expect(screen.getByRole("button", { name: "Play" })).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Expand captions" }));
    fireEvent.click(screen.getByRole("button", { name: "Select caption: Beyond media" }));
    expect(clock.frame).toBe(300);
    const box = screen.getByRole("region", { name: "Timeline scroll area" });
    fireEvent.scroll(box, { target: { scrollLeft: 100 } });
    const axis = view.container.querySelector<HTMLElement>(".caption-axis-content")!;
    expect(axis.style.transform).toBe("translateX(-100px)");
    expect(view.container.querySelector<HTMLElement>(".caption-block")!.style.left).toBe("760px");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(view.container.querySelector<HTMLElement>(".caption-block")!.style.left).toBe("1060px");
    clock.dispose();
  });
  it("pauses and steps with transport buttons, updates timecode and disables steps for an empty timeline", () => {
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const props = { clock, selectedClipId: null, offline: new Set<string>(), message: null,
      onSelect: vi.fn(), onSplit: vi.fn(), onDelete: vi.fn(), onTrim: vi.fn(),
      onAddVisualTrack: vi.fn(), onReorderVisualTrack: vi.fn() };
    const view = render(<Timeline {...props} project={project} />);
    act(() => { clock.seek(29); clock.play(); });
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(clock.playing).toBe(false);
    expect(clock.frame).toBe(30);
    expect(screen.getByLabelText("Playhead time").textContent).toBe("00:00:01:00");
    fireEvent.click(screen.getByRole("button", { name: "Previous frame" }));
    expect(clock.frame).toBe(29);
    expect(screen.getByLabelText("Playhead time").textContent).toBe("00:00:00:29");
    view.rerender(<Timeline {...props} project={{ ...project, tracks: [] }} />);
    expect(screen.getByRole("button", { name: "Previous frame" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Next frame" }).hasAttribute("disabled")).toBe(true);
    clock.dispose();
  });

  it.each(["left", "right"])("sizes a 2x clip by timeline duration and converts %s trim drags into source frames", (edge) => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const fast = structuredClone(project);
    fast.tracks[0]!.clips[0]!.speed = 2;
    const onTrim = vi.fn();
    const view = render(<Timeline project={fast} clock={clock} selectedClipId="c" offline={new Set()}
      message={null} onSelect={vi.fn()} onSplit={vi.fn()} onDelete={vi.fn()} onTrim={onTrim}
      onAddVisualTrack={vi.fn()} onReorderVisualTrack={vi.fn()} />);
    const content = view.container.querySelector(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    expect(view.container.querySelector<HTMLElement>('[data-clip-id="c"]')!.style.width).toBe("90px");
    const handle = view.container.querySelector<HTMLElement>(`[data-trim-handle="${edge}"]`)!;
    const start = edge === "left" ? 160 : 250;
    const end = start + (edge === "left" ? 20 : -20);
    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 1, clientX: start }));
    fireEvent(handle, pointerEvent("pointermove", { pointerId: 1, clientX: end }));
    fireEvent(handle, pointerEvent("pointerup", { pointerId: 1, clientX: end }));
    expect(onTrim).toHaveBeenCalledExactlyOnceWith("c", edge === "left" ? 20 : 0, edge === "left" ? 90 : 70);
    clock.dispose();
  });
  const navigationFixture = () => {
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const long = structuredClone(project);
    long.assets[0]!.durationFrames = 10800 * 30;
    long.tracks[0]!.clips[0]!.sourceOut = 10800 * 30;
    const onTrim = vi.fn(), onMoveClip = vi.fn();
    const view = render(<Timeline project={long} clock={clock} selectedClipId={null} offline={new Set()}
      message={null} onSelect={vi.fn()} onSplit={vi.fn()} onDelete={vi.fn()} onTrim={onTrim}
      onMoveClip={onMoveClip} onAddVisualTrack={vi.fn()} onReorderVisualTrack={vi.fn()} />);
    const box = screen.getByRole("region", { name: "Timeline scroll area" });
    const content = view.container.querySelector<HTMLElement>(".tl-content")!;
    Object.defineProperty(box, "clientWidth", { configurable: true, value: 900 });
    Object.defineProperty(box, "scrollWidth", { configurable: true, get: () => Number.parseFloat(content.style.width) });
    return { clock, box, content, onTrim, onMoveClip, long };
  };

  it("suspends follow on manual horizontal scrolling during playback until explicitly resumed", () => {
    const { clock, box } = navigationFixture();
    const follow = screen.getByRole("button", { name: "Follow playhead" });
    act(() => { clock.play(); clock.seek(30 * 60); });
    expect(box.scrollLeft).toBeGreaterThan(0);
    fireEvent.scroll(box);
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    const autoLeft = box.scrollLeft;
    // A scrollbar can move before the browser delivers its scroll event.
    box.scrollLeft = autoLeft + 10000;
    act(() => clock.seek(30 * 61));
    expect(box.scrollLeft).toBe(autoLeft + 10000);
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    fireEvent.scroll(box);
    act(() => { clock.pause(); clock.play(); clock.seek(30 * 62); });
    expect(box.scrollLeft).toBe(autoLeft + 10000);
    expect(clock.playing).toBe(true);
    fireEvent.click(follow);
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    expect(box.scrollLeft).toBe(62 * 60 - 48);
    fireEvent.scroll(box);
    act(() => clock.seek(30 * 100));
    expect(box.scrollLeft).toBe(100 * 60 - 48);
    fireEvent.click(follow);
    const stopped = box.scrollLeft;
    act(() => clock.seek(30 * 200));
    expect(box.scrollLeft).toBe(stopped);
    clock.dispose();
  });

  it("distinguishes vertical scrolling from horizontal wheel, scrollbar and keyboard navigation", () => {
    const { clock, box } = navigationFixture();
    const follow = screen.getByRole("button", { name: "Follow playhead" });
    fireEvent.wheel(box, { deltaY: 100 });
    box.scrollTop = 100;
    fireEvent.scroll(box);
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    fireEvent.wheel(box, { deltaX: 100 });
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(follow);
    fireEvent.wheel(box, { shiftKey: true, deltaY: 100 });
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(follow);
    box.focus();
    expect(document.activeElement).toBe(box);
    box.scrollLeft = 800;
    fireEvent.scroll(box);
    expect(follow.getAttribute("aria-pressed")).toBe("false");
    act(() => clock.play());
    expect(box.scrollLeft).toBe(800);
    clock.dispose();
  });

  it("fits three hours, preserves playback/edits and keeps zoom anchored without disabling follow", () => {
    const { clock, box, content, onTrim, onMoveClip, long } = navigationFixture();
    act(() => { clock.seek(30 * 7200); clock.play(); });
    const follow = screen.getByRole("button", { name: "Follow playhead" });
    const frame = clock.frame;
    fireEvent.click(screen.getByRole("button", { name: "Fit timeline" }));
    expect(Number.parseFloat(content.style.width) + 80).toBeLessThanOrEqual(900);
    expect(box.scrollLeft).toBe(0);
    expect(clock.frame).toBe(frame);
    expect(clock.playing).toBe(true);
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(content.querySelectorAll(".tl-tick")).some((tick) => tick.textContent === "02:00:00")).toBe(true);
    const oldZoom = (Number.parseFloat(content.style.width) - 160) / 10805;
    const beforeX = 160 + 7200 * oldZoom - box.scrollLeft;
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const newZoom = (Number.parseFloat(content.style.width) - 160) / 10805;
    expect(160 + 7200 * newZoom - box.scrollLeft).toBeCloseTo(beforeX);
    fireEvent.scroll(box);
    expect(follow.getAttribute("aria-pressed")).toBe("true");
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect((screen.getByRole("button", { name: "Zoom out" }) as HTMLButtonElement).disabled).toBe(true);
    expect(clock.frame).toBe(frame);
    expect(clock.playing).toBe(true);
    expect(onTrim).not.toHaveBeenCalled();
    expect(onMoveClip).not.toHaveBeenCalled();
    expect(long.tracks[0]!.clips[0]!.sourceOut).toBe(10800 * 30);
    clock.dispose();
  });

  it("anchors zoom at the viewport center when browsing away from the paused playhead", () => {
    const { clock, box, content } = navigationFixture();
    box.scrollLeft = 10000;
    fireEvent.scroll(box);
    const center = 160 + (900 - 160) / 2;
    const seconds = (10000 + center - 160) / 60;
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    const zoom = (Number.parseFloat(content.style.width) - 160) / 10805;
    expect(160 + seconds * zoom - box.scrollLeft).toBeCloseTo(center);
    expect(screen.getByRole("button", { name: "Follow playhead" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Follow playhead" }));
    expect(box.scrollLeft).toBe(0);
    expect(clock.frame).toBe(0);
    expect(clock.playing).toBe(false);
    clock.dispose();
  });

  it("shows custom audio labels and prevents dragging or trimming locked clips", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onMoveClip = vi.fn(), onTrim = vi.fn(), onLockTrack = vi.fn();
    const locked: Project = { ...project, tracks: [{
      ...project.tracks[0]!, kind: "audio", name: "Voiceover", locked: true,
    }] };
    const view = render(<Timeline project={locked} clock={clock} selectedClipId="c" selectedTrackId="base"
      offline={new Set()} message={null} onSelect={vi.fn()} onSplit={vi.fn()} onDelete={vi.fn()}
      onTrim={onTrim} onMoveClip={onMoveClip} onLockTrack={onLockTrack}
      onAddVisualTrack={vi.fn()} onReorderVisualTrack={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Select audio track 1" }).textContent).toBe("[L] Voiceover");
    expect(screen.queryByRole("button", { name: "Trim start of clip.mp4" })).toBeNull();
    const clip = view.container.querySelector('[data-clip-id="c"]')!;
    fireEvent(clip, pointerEvent("pointerdown", { clientX: 180, pointerId: 1 }));
    const content = view.container.querySelector(".tl-content")!;
    fireEvent(content, pointerEvent("pointermove", { clientX: 240, pointerId: 1 }));
    fireEvent(content, pointerEvent("pointerup", { clientX: 240, pointerId: 1 }));
    expect(onMoveClip).not.toHaveBeenCalled();
    expect(onTrim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Unlock track" }));
    expect(onLockTrack).toHaveBeenCalledExactlyOnceWith("base", false);
    clock.dispose();
  });

  it("edits selected track names, validates whitespace, resets on selection and toggles locks", () => {
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onRenameTrack = vi.fn(), onLockTrack = vi.fn();
    const props = {
      project, clock, selectedClipId: null, selectedTrackId: "overlay", offline: new Set<string>(),
      message: null, onSelect: vi.fn(), onSplit: vi.fn(), onDelete: vi.fn(), onTrim: vi.fn(),
      onAddVisualTrack: vi.fn(), onReorderVisualTrack: vi.fn(), onRenameTrack, onLockTrack,
    };
    const view = render(<Timeline {...props} />);
    const name = screen.getByRole("textbox", { name: "Track name" }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: " B-roll " } });
    fireEvent.submit(screen.getByRole("form", { name: "Selected track settings" }));
    expect(onRenameTrack).toHaveBeenCalledExactlyOnceWith("overlay", "B-roll");
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("form", { name: "Selected track settings" }));
    expect(screen.getByRole("alert").textContent).toContain("1-80");
    expect(onRenameTrack).toHaveBeenCalledOnce();
    fireEvent.keyDown(name, { key: "Escape" });
    expect(name.value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lock track" }));
    expect(onLockTrack).toHaveBeenCalledExactlyOnceWith("overlay", true);
    const locked = { ...project, tracks: project.tracks.map((track) =>
      track.id === "overlay" ? { ...track, name: "B-roll", locked: true } : track) };
    view.rerender(<Timeline {...props} project={locked} />);
    expect(name.value).toBe("B-roll");
    expect(screen.getByRole("button", { name: "Select overlay track 1" }).textContent).toBe("[L] B-roll");
    expect((screen.getByRole("button", { name: "Remove overlay track 1" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Unlock track" }));
    expect(onLockTrack).toHaveBeenLastCalledWith("overlay", false);
    view.rerender(<Timeline {...props} selectedTrackId="base" mutationsDisabled />);
    expect(name.value).toBe("");
    expect(name.disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Lock track" }) as HTMLButtonElement).disabled).toBe(true);
    clock.dispose();
  });

  it("drops assets at the pointer time on the target row, not the selected row", () => {
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onDropAsset = vi.fn();
    const props = {
      project, clock, selectedClipId: null, selectedTrackId: "base", offline: new Set<string>(),
      message: null, onSelect: vi.fn(), onSplit: vi.fn(), onDelete: vi.fn(), onTrim: vi.fn(),
      onAddVisualTrack: vi.fn(), onReorderVisualTrack: vi.fn(), onDropAsset,
    };
    const view = render(<Timeline {...props} />);
    const content = view.container.querySelector<HTMLElement>(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: -100, right: 900, top: 0, bottom: 500, width: 1000, height: 500, x: -100, y: 0, toJSON: () => ({}),
    });
    const lane = view.container.querySelector<HTMLElement>('[data-track-id="overlay"]')!;
    const dataTransfer = { types: [ASSET_DRAG_TYPE], getData: vi.fn().mockReturnValue("a"), dropEffect: "none" };
    const drag = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 180 });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      return event;
    };
    act(() => clock.play());
    fireEvent(lane, drag("dragover"));
    expect(clock.playing).toBe(false);
    expect(dataTransfer.dropEffect).toBe("copy");
    expect(content.querySelector<HTMLElement>(".tl-snap-guide")?.style.left).toBe("280px");
    fireEvent(lane, drag("drop"));
    expect(onDropAsset).toHaveBeenCalledExactlyOnceWith("a", 60, "overlay");
    expect(content.querySelector(".tl-snap-guide")).toBeNull();
    view.rerender(<Timeline {...props} mutationsDisabled />);
    fireEvent(lane, drag("drop"));
    expect(onDropAsset).toHaveBeenCalledOnce();
    clock.dispose();
  });

  it("removes empty visual and audio tracks but disables removal for tracks containing clips", () => {
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const withAudio: Project = {
      ...project,
      tracks: [...project.tracks, {
        id: "audio-track", kind: "audio", order: 2, muted: false, locked: false, clips: [],
      }],
    };
    const onRemoveTrack = vi.fn();
    render(
      <Timeline
        project={withAudio}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onAddVisualTrack={vi.fn()}
        onRemoveTrack={onRemoveTrack}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const removeEmptyVisual = screen.getByRole("button", { name: "Remove overlay track 1" });
    const removeOccupiedVisual = screen.getByRole("button", { name: "Remove video track 2" });
    const removeEmptyAudio = screen.getByRole("button", { name: "Remove audio track 1" });
    expect((removeEmptyVisual as HTMLButtonElement).disabled).toBe(false);
    expect((removeOccupiedVisual as HTMLButtonElement).disabled).toBe(true);
    expect((removeEmptyAudio as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(removeEmptyVisual);
    fireEvent.click(removeEmptyAudio);
    expect(onRemoveTrack.mock.calls).toEqual([["overlay"], ["audio-track"]]);
    clock.dispose();
  });

  it("selects tracks from their labels and selects a row when clicking it", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onSelectTrack = vi.fn();
    const view = render(
      <Timeline
        project={project}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSelectTrack={onSelectTrack}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select overlay track 1" }));
    expect(onSelectTrack).toHaveBeenLastCalledWith("overlay");
    const lane = view.container.querySelector<HTMLElement>('[data-track-id="base"]')!;
    fireEvent(lane, pointerEvent("pointerdown", { pointerId: 20, clientX: 180, clientY: 100 }));
    expect(onSelectTrack).toHaveBeenLastCalledWith("base");
    expect(lane.dataset.trackSelected).toBe("false");
    clock.dispose();
  });

  it("marks zoom points on clips, follows the Properties draft and keeps selection on empty clicks", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const zoomed = structuredClone(project);
    zoomed.tracks[0]!.clips[0]!.zoom = { version: 1, startPercent: 20, endPercent: 120, startScale: 1, endScale: 1.5 };
    const onSelect = vi.fn();
    const props = {
      project: zoomed, clock, selectedClipId: "c", offline: new Set<string>(), message: null, onSelect,
      onSplit: vi.fn(), onDelete: vi.fn(), onTrim: vi.fn(), onAddVisualTrack: vi.fn(), onReorderVisualTrack: vi.fn(),
    };
    const view = render(<Timeline {...props} />);
    expect(screen.getByTestId("zoom-start-c").style.left).toBe("20%");
    expect(screen.queryByTestId("zoom-end-c")).toBeNull();
    expect(screen.getByTestId("zoom-markers-c").getAttribute("aria-label")).toBe("Zoom 100% → 150%");
    view.rerender(<Timeline {...props} zoomDraft={{ clipId: "c", zoom: { version: 1, startPercent: 10, endPercent: 60, startScale: 1, endScale: 2 } }} />);
    expect(screen.getByTestId("zoom-start-c").style.left).toBe("10%");
    expect(screen.getByTestId("zoom-end-c").style.left).toBe("60%");
    view.rerender(<Timeline {...props} zoomDraft={{ clipId: "c", zoom: null }} />);
    expect(screen.queryByTestId("zoom-markers-c")).toBeNull();
    const lane = view.container.querySelector<HTMLElement>('[data-track-id="overlay"]')!;
    fireEvent(lane, pointerEvent("pointerdown", { pointerId: 21, clientX: 400, clientY: 100 }));
    expect(onSelect).not.toHaveBeenCalled();
    clock.dispose();
  });

  it("keeps clicks on clips as scrubs without committing a move", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onMoveClip = vi.fn();
    const view = render(
      <Timeline
        project={project}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onMoveClip={onMoveClip}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector(".tl-content")!;
    clock.play();
    expect(clock.playing).toBe(true);
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    const clip = view.container.querySelector<HTMLElement>('[data-clip-id="c"]')!;
    fireEvent(clip, pointerEvent("pointerdown", { pointerId: 9, clientX: 220 }));
    expect(clock.playing).toBe(false);
    fireEvent(clip, pointerEvent("pointerup", { pointerId: 9, clientX: 220 }));
    expect(clock.frame).toBe(30);
    expect(onMoveClip).not.toHaveBeenCalled();
    clock.dispose();
  });

  it("moves an audio clip and previews same-row head trimming during the drag", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const audioProject: Project = {
      ...project,
      assets: [...project.assets, {
        id: "music", kind: "audio", name: "music.wav", mediaMode: "reference", sourcePath: "C:\\music.wav",
        contentHash: "music", durationFrames: 900, fps, width: null, height: null, hasAudio: true, proxyPath: null,
      }],
      tracks: [...project.tracks, {
        id: "audio-track", kind: "audio", order: 2, muted: false, locked: false, clips: [
          { id: "sound", assetId: "music", timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true },
          { id: "sound-next", assetId: "music", timelineStart: 30, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true },
        ],
      }],
    };
    const onMoveClip = vi.fn();
    const view = render(
      <Timeline
        project={audioProject}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onMoveClip={onMoveClip}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    const clip = view.container.querySelector<HTMLElement>('[data-clip-id="sound"]')!;
    fireEvent(clip, pointerEvent("pointerdown", { pointerId: 7, clientX: 170 }));
    fireEvent(clip, pointerEvent("pointermove", { pointerId: 7, clientX: 190 }));
    expect(view.container.querySelector<HTMLElement>('[data-clip-id="sound"]')?.style.left).toBe("180px");
    expect(view.container.querySelector<HTMLElement>('[data-clip-id="sound-next"]')?.style.left).toBe("240px");
    fireEvent(clip, pointerEvent("pointerup", { pointerId: 7, clientX: 190 }));
    expect(onMoveClip).toHaveBeenCalledOnce();
    expect(onMoveClip).toHaveBeenCalledWith("sound", 10, "audio-track");
    clock.dispose();
  });

  it("drags a visual clip and snaps its end to another track with a guide", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const withOverlay: Project = {
      ...project,
      tracks: project.tracks.map((track) => track.id === "overlay"
        ? { ...track, clips: [{
          id: "overlay-clip", assetId: "a", timelineStart: 110, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true,
        }] }
        : track),
    };
    const onMoveClip = vi.fn();
    const view = render(
      <Timeline
        project={withOverlay}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onMoveClip={onMoveClip}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    const clip = view.container.querySelector<HTMLElement>('[data-clip-id="c"]')!;
    fireEvent(clip, pointerEvent("pointerdown", { pointerId: 8, clientX: 170 }));
    fireEvent(clip, pointerEvent("pointermove", { pointerId: 8, clientX: 216 }));
    expect(view.container.querySelector<HTMLElement>('[data-clip-id="c"]')?.style.left).toBe("200px");
    expect(view.container.querySelector<HTMLElement>(".tl-snap-guide")?.style.left).toBe("380px");
    fireEvent(clip, pointerEvent("pointerup", { pointerId: 8, clientX: 216 }));
    expect(onMoveClip).toHaveBeenCalledOnce();
    expect(onMoveClip).toHaveBeenCalledWith("c", 20, "base");
    clock.dispose();
  });

  it("drags a clip to another visual track and previews its new row", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onMoveClip = vi.fn();
    const view = render(
      <Timeline
        project={project}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onMoveClip={onMoveClip}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector<HTMLElement>(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    const overlayLane = view.container.querySelector<HTMLElement>('[data-track-id="overlay"]')!;
    const baseLane = view.container.querySelector<HTMLElement>('[data-track-id="base"]')!;
    vi.spyOn(overlayLane, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 23, bottom: 75, width: 1000, height: 52, x: 0, y: 23, toJSON: () => ({}),
    });
    vi.spyOn(baseLane, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 75, bottom: 127, width: 1000, height: 52, x: 0, y: 75, toJSON: () => ({}),
    });
    const clip = view.container.querySelector<HTMLElement>('[data-clip-id="c"]')!;
    fireEvent(clip, pointerEvent("pointerdown", { pointerId: 12, clientX: 170, clientY: 90 }));
    fireEvent(clip, pointerEvent("pointermove", { pointerId: 12, clientX: 190, clientY: 50 }));
    expect(view.container.querySelector('[data-track-id="overlay"] [data-clip-id="c"]')).not.toBeNull();
    expect(view.container.querySelector<HTMLElement>('[data-clip-id="c"]')?.style.left).toBe("180px");
    fireEvent(content, pointerEvent("pointerup", { pointerId: 12, clientX: 190, clientY: 50 }));
    expect(onMoveClip).toHaveBeenCalledWith("c", 10, "overlay");
    clock.dispose();
  });

  it("auto-scrolls and grows the timeline when dragging a clip past its visible end", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onMoveClip = vi.fn();
    const onTrim = vi.fn();
    const audioProject: Project = {
      ...project,
      assets: [...project.assets, {
        id: "music", kind: "audio", name: "music.wav", mediaMode: "reference", sourcePath: "C:\\music.wav",
        contentHash: "music", durationFrames: 900, fps: null, width: null, height: null, hasAudio: true, proxyPath: null,
      }],
      tracks: [...project.tracks, {
        id: "audio-track", kind: "audio", order: 2, muted: false, locked: false, clips: [
          { id: "audio-clip", assetId: "music", timelineStart: 60, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true },
        ],
      }],
    };
    const view = render(
      <Timeline
        project={audioProject}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={onTrim}
        onMoveClip={onMoveClip}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector<HTMLElement>(".tl-content")!;
    const scroller = view.container.querySelector<HTMLElement>(".tl-scroll")!;
    Object.defineProperty(scroller, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(scroller, "scrollWidth", {
      configurable: true,
      get: () => Number.parseFloat(content.style.width),
    });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 300, top: 0, bottom: 500, width: 300, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    vi.spyOn(content, "getBoundingClientRect").mockImplementation(() => ({
      left: -scroller.scrollLeft,
      right: Number.parseFloat(content.style.width) - scroller.scrollLeft,
      top: 0,
      bottom: 500,
      width: Number.parseFloat(content.style.width),
      height: 500,
      x: -scroller.scrollLeft,
      y: 0,
      toJSON: () => ({}),
    }));
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const initialWidth = Number.parseFloat(content.style.width);
    const clip = view.container.querySelector<HTMLElement>('[data-clip-id="c"]')!;
    fireEvent(clip, pointerEvent("pointerdown", { pointerId: 10, clientX: 170 }));
    fireEvent(clip, pointerEvent("pointermove", { pointerId: 10, clientX: 295 }));
    const widthBeforeAutoScroll = Number.parseFloat(content.style.width);
    expect(widthBeforeAutoScroll).toBeGreaterThan(initialWidth);
    act(() => nextFrame?.(16));
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    expect(Number.parseFloat(content.style.width)).toBeGreaterThan(widthBeforeAutoScroll);
    fireEvent(clip, pointerEvent("pointerup", { pointerId: 10, clientX: 295 }));
    expect(onMoveClip).toHaveBeenCalledOnce();
    expect(onMoveClip.mock.calls[0]?.[1]).toBeGreaterThan(0);

    const audioHandle = view.container.querySelector<HTMLElement>(
      '[data-clip-id="audio-clip"] [data-trim-handle="right"]',
    )!;
    const pointerDownX = 160 + 120 - scroller.scrollLeft;
    fireEvent(audioHandle, pointerEvent("pointerdown", { pointerId: 11, clientX: pointerDownX }));
    fireEvent(audioHandle, pointerEvent("pointermove", { pointerId: 11, clientX: 295 }));
    const widthBeforeTrimScroll = Number.parseFloat(content.style.width);
    act(() => nextFrame?.(32));
    expect(scroller.scrollLeft).toBeGreaterThan(11);
    expect(Number.parseFloat(content.style.width)).toBeGreaterThan(widthBeforeTrimScroll);
    fireEvent(audioHandle, pointerEvent("pointerup", { pointerId: 11, clientX: 295 }));
    expect(onTrim).toHaveBeenCalledOnce();
    expect(onTrim.mock.calls[0]?.[2]).toBeGreaterThan(30);
    clock.dispose();
  });

  it("commits an edge drag as one clip trim", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onTrim = vi.fn();
    const view = render(
      <Timeline
        project={project}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={onTrim}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    const handle = view.container.querySelector<HTMLElement>('[data-clip-id="c"] [data-trim-handle="right"]')!;
    clock.play();
    expect(clock.playing).toBe(true);
    fireEvent(handle, pointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 340 }));
    expect(clock.playing).toBe(false);
    fireEvent(handle, pointerEvent("pointermove", { pointerId: 1, clientX: 320 }));
    fireEvent(handle, pointerEvent("pointerup", { pointerId: 1, clientX: 320 }));
    expect(onTrim).toHaveBeenCalledOnce();
    expect(onTrim).toHaveBeenCalledWith("c", 0, 80);
    clock.dispose();
  });

  it("uses the pointer-down position as the trim anchor and can extend to unused source frames", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onTrim = vi.fn();
    const shortened: Project = {
      ...project,
      tracks: project.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({ ...clip, sourceOut: 60 })),
      })),
    };
    const view = render(
      <Timeline
        project={shortened}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={onTrim}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", { name: "Trim end of clip.mp4" });
    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 2, clientX: 278 }));
    fireEvent(handle, pointerEvent("pointermove", { pointerId: 2, clientX: 338 }));
    fireEvent(handle, pointerEvent("pointerup", { pointerId: 2, clientX: 338 }));
    expect(onTrim).toHaveBeenCalledOnce();
    expect(onTrim).toHaveBeenCalledWith("c", 0, 90);
    clock.dispose();
  });

  it("previews same-track head trimming while extending a clip", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const twoClips: Project = {
      ...project,
      assets: project.assets.map((asset) => ({ ...asset, durationFrames: 150 })),
      tracks: project.tracks.map((track) => track.id === "base"
        ? { ...track, clips: [...track.clips, {
          id: "next", assetId: "a", timelineStart: 90, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true,
        }] }
        : track),
    };
    const view = render(
      <Timeline
        project={twoClips}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    const handle = view.container.querySelector<HTMLElement>('[data-clip-id="c"] [data-trim-handle="right"]')!;
    fireEvent(handle, pointerEvent("pointerdown", { pointerId: 3, clientX: 340 }));
    fireEvent(handle, pointerEvent("pointermove", { pointerId: 3, clientX: 370 }));
    expect(view.container.querySelector<HTMLElement>('[data-clip-id="c"]')?.style.width).toBe("210px");
    expect(view.container.querySelector<HTMLElement>('[data-clip-id="next"]')?.style.left).toBe("370px");
    expect(view.container.querySelector<HTMLElement>('[data-clip-id="next"]')?.style.width).toBe("90px");
    fireEvent(handle, pointerEvent("pointerup", { pointerId: 3, clientX: 370 }));
    clock.dispose();
  });

  it("aligns the playhead with the clicked frame after the track labels", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const view = render(
      <Timeline
        project={project}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onAddVisualTrack={vi.fn()}
        onReorderVisualTrack={vi.fn()}
      />,
    );
    const content = view.container.querySelector(".tl-content")!;
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 1000, top: 0, bottom: 500, width: 1000, height: 500, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent(content, pointerEvent("pointerdown", { clientX: 220 }));
    const playhead = view.container.querySelector<HTMLElement>(".tl-playhead")!;
    expect(clock.frame).toBe(30);
    expect(playhead.style.transform).toBe("translateX(220px)");
    expect(playhead.style.marginLeft).toBe("");
    clock.dispose();
  });

  it("exposes visual track creation and layer ordering controls", () => {
    const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
    const onAddVisualTrack = vi.fn();
    const onReorderVisualTrack = vi.fn();
    const onToggleTrackMuted = vi.fn();
    render(
      <Timeline
        project={project}
        clock={clock}
        selectedClipId={null}
        offline={new Set()}
        message={null}
        onSelect={vi.fn()}
        onSplit={vi.fn()}
        onDelete={vi.fn()}
        onTrim={vi.fn()}
        onAddVisualTrack={onAddVisualTrack}
        onReorderVisualTrack={onReorderVisualTrack}
        onToggleTrackMuted={onToggleTrackMuted}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    fireEvent.click(screen.getByRole("button", { name: "Lower overlay track 1" }));
    fireEvent.click(screen.getByRole("button", { name: /^Mute video track/ }));
    expect(onAddVisualTrack).toHaveBeenCalledOnce();
    expect(onReorderVisualTrack).toHaveBeenCalledWith("overlay", -1);
    expect(onToggleTrackMuted).toHaveBeenCalledWith("base", true);
    clock.dispose();
  });
});
