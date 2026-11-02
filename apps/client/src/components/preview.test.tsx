// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Clip, Project } from "@ve/schema";
import { createEmptyProject } from "@ve/timeline-core";
import { PlayheadClock, type Scheduler } from "../clock.js";
import { Preview } from "./Preview.js";

const fps = { num: 30, den: 1 };
const clip = (id: string, at: number, start: number, end: number): Clip => ({
  id, assetId: "a", timelineStart: at, sourceIn: start, sourceOut: end, speed: 1, audioLinked: true,
});
const project = (...clips: Clip[]): Project => ({
  ...createEmptyProject({ id: "p", name: "Preview", fps, width: 640, height: 360 }),
  assets: [{
    id: "a", name: "Synthetic", kind: "video", mediaMode: "reference", sourcePath: "C:\\Synthetic.mp4",
    contentHash: "synthetic", durationFrames: 120, fps, width: 640, height: 360, hasAudio: true,
    proxyPath: "proxies/a.mp4",
  }],
  tracks: [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips }],
});

let clock: PlayheadClock;
let time: number;
let setTime: Mock<(value: number) => void>;
beforeEach(() => {
  const scheduler: Scheduler = { now: () => 0, request: () => 1, cancel: () => undefined };
  clock = new PlayheadClock(scheduler);
  time = 0;
  setTime = vi.fn((value: number) => { time = value; });
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(() => time);
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation(setTime);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  clock.dispose();
  vi.restoreAllMocks();
});
const show = (p: Project, duration: number) => {
  clock.configure(p.settings.fps, duration);
  return render(<Preview project={p} clock={clock} config={{ url: "http://engine", token: "synthetic" }} />);
};

describe("preview clip boundary contract", () => {
  it("holds the inclusive last frame of a trimmed clip, not its exclusive out-frame", () => {
    const view = show(project(clip("trimmed", 0, 30, 60)), 30);
    act(() => clock.seek(30));
    expect(time).toBeCloseTo(59 / 30, 8);
    fireEvent.loadedMetadata(view.container.querySelector("video")!);
    expect(time).toBeCloseTo(59 / 30, 8);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it("forces a seek across a short removed range while playing the same source", () => {
    show(project(clip("first", 0, 0, 30), clip("second", 30, 33, 63)), 60);
    act(() => clock.play());
    time = 1;
    setTime.mockClear();
    act(() => clock.seek(30));
    expect(setTime).toHaveBeenCalledExactlyOnceWith(1.1);
  });

  it("forces a short backward/repeated-source transition instead of allowing drift tolerance to skip it", () => {
    show(project(clip("first", 0, 0, 30), clip("repeat", 30, 27, 57)), 60);
    act(() => clock.play());
    time = 1;
    setTime.mockClear();
    act(() => clock.seek(30));
    expect(setTime).toHaveBeenCalledExactlyOnceWith(0.9);
  });

  it("does not force a seek across a contiguous split", () => {
    show(project(clip("first", 0, 0, 30), clip("second", 30, 30, 60)), 60);
    act(() => clock.play());
    time = 1;
    setTime.mockClear();
    act(() => clock.seek(30));
    expect(setTime).not.toHaveBeenCalled();
  });

  it("holds the final visible frame before a discontinuity so native playback cannot advance into the removed range", () => {
    show(project(clip("first", 0, 0, 30), clip("second", 30, 33, 63)), 60);
    act(() => clock.play());
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    time = 1;
    act(() => clock.seek(29.5));
    expect(time).toBeCloseTo(29 / 30, 8);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
  });

  it("does not pause native playback just before a contiguous split", () => {
    show(project(clip("first", 0, 0, 30), clip("second", 30, 30, 60)), 60);
    act(() => clock.play());
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    time = 29.5 / 30;
    setTime.mockClear();
    act(() => clock.seek(29.5));
    expect(setTime).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
  });

  it("forces a seek after a gap even when drift is below the playback tolerance", () => {
    show(project(clip("first", 0, 0, 30), clip("second", 33, 33, 63)), 63);
    act(() => clock.play());
    act(() => clock.seek(31));
    expect(screen.getByText("No clip here")).toBeDefined();
    time = 1.05;
    setTime.mockClear();
    act(() => clock.seek(33));
    expect(setTime).toHaveBeenCalledExactlyOnceWith(1.1);
    expect(screen.queryByText("No clip here")).toBeNull();
  });

  it("preserves a trailing gap caused by an audio track rather than holding an unrelated clip", () => {
    const p = project(clip("video", 0, 0, 30));
    p.tracks.push({ id: "audio", kind: "audio", order: 1, muted: false, locked: false,
      clips: [clip("audio-clip", 0, 0, 60)] });
    show(p, 60);
    act(() => clock.seek(60));
    expect(screen.getByText("No clip here")).toBeDefined();
  });

  it("still clamps to a shorter proxy and never reloads it for a same-source cut", () => {
    vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(1.5);
    const view = show(project(clip("first", 0, 0, 30), clip("second", 30, 33, 63)), 60);
    const video = view.container.querySelector("video")!;
    const original = video.getAttribute("src");
    act(() => clock.seek(60));
    expect(time).toBeCloseTo(1.5 - 1 / 30, 8);
    expect(video.getAttribute("src")).toBe(original);
  });

  it("uses rational project time with different native asset fps", () => {
    const p = project(clip("trimmed", 0, 30, 60));
    p.settings.fps = { num: 30000, den: 1001 };
    p.assets[0]!.fps = { num: 60, den: 1 };
    show(p, 30);
    act(() => clock.seek(30));
    expect(time).toBeCloseTo(59 * 1001 / 30000, 8);
  });

  it("detects an edited source mapping even when clip and asset identity stay the same", () => {
    const p = project(clip("same-id", 0, 0, 30));
    const view = show(p, 30);
    act(() => clock.play());
    time = 0;
    setTime.mockClear();
    const edited = project(clip("same-id", 0, 3, 33));
    view.rerender(<Preview project={edited} clock={clock} config={{ url: "http://engine", token: "synthetic" }} />);
    expect(setTime).toHaveBeenCalledExactlyOnceWith(0.1);
  });
});
