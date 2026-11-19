// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { animatedTransform, type Clip, type Project, type ProxyState } from "@ve/schema";
import { createEmptyProject } from "@ve/timeline-core";
import { PlayheadClock, type Scheduler } from "../clock.js";
import { Preview } from "./Preview.js";
import { recordUnknownEditError } from "../projectApi.js";

vi.mock("../projectApi.js", () => ({ recordUnknownEditError: vi.fn() }));

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
  vi.mocked(recordUnknownEditError).mockReset();
  vi.mocked(recordUnknownEditError).mockResolvedValue({ ok: true, data: { records: [], capacityReached: false } });
  const scheduler: Scheduler = { now: () => 0, request: () => 1, cancel: () => undefined };
  clock = new PlayheadClock(scheduler);
  time = 0;
  setTime = vi.fn((value: number) => { time = value; });
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(() => time);
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation(setTime);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(4);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(4);
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
  it("draws saved subtitles independently of media transforms and clears them at the exclusive end", () => {
    const p = project(clip("c", 0, 0, 60));
    p.captionCues = [{ id: "caption", start: 10, end: 90, text: "Beyond the picture" }];
    const view = show(p, 90);
    act(() => clock.seek(30));
    expect(view.container.querySelector(".preview-caption-text")!.textContent).toBe("Beyond the picture");
    expect(view.container.querySelector(".preview-captions")!.closest(".preview-canvas")).toBeNull();
    act(() => clock.seek(70));
    expect(screen.getByText("No clip here")).toBeDefined();
    expect(view.container.querySelector(".preview-caption-text")!.textContent).toBe("Beyond the picture");
    act(() => clock.seek(90));
    expect(view.container.querySelector(".preview-caption-text")!.textContent).toBe("");
  });
  it("toggles crop from the toolbar and blocks pending, locked and offline selections", () => {
    const p = project(clip("c", 0, 0, 60));
    clock.configure(p.settings.fps, 60);
    const cropControls = { active: false, mode: "free" as const, onActive: vi.fn(), onMode: vi.fn(), onDraft: vi.fn(), onCommit: vi.fn() };
    const canvas = { selectedClipId: "c", onSelect: vi.fn(), onDraft: vi.fn(), onCommit: vi.fn(), onLayer: vi.fn(), cropControls };
    const props = { project: p, clock, config: { url: "http://engine", token: "synthetic" }, canvas };
    const view = render(<Preview {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    expect(cropControls.onActive).toHaveBeenCalledWith(true);
    view.rerender(<Preview {...props} canvas={{ ...canvas, cropControls: { ...cropControls, active: true } }} />);
    expect(screen.getByRole("button", { name: "Fit to canvas" })).toHaveProperty("disabled", true);
    view.rerender(<Preview {...props} canvas={{ ...canvas, disabledReason: "Resolve pending edit" }} />);
    expect(screen.getByRole("button", { name: "Crop" })).toHaveProperty("disabled", true);
    const locked = { ...p, tracks: p.tracks.map((track) => ({ ...track, locked: true })) };
    view.rerender(<Preview {...props} project={locked} />);
    expect(screen.getByRole("button", { name: "Crop" })).toHaveProperty("disabled", true);
    view.rerender(<Preview {...props} offline={new Set(["a"])} />);
    expect(screen.getByRole("button", { name: "Crop" })).toHaveProperty("disabled", true);
  });
  it("fits the selected visible clip, pauses playback, and blocks unavailable or locked selections", () => {
    const p = project(clip("c", 0, 0, 60));
    p.tracks[0]!.clips[0]!.transform = { x: 0.8, y: 0.3, scale: 2, opacity: 0.4 };
    clock.configure(p.settings.fps, 60);
    const canvas = { selectedClipId: "c", onSelect: vi.fn(), onDraft: vi.fn(), onCommit: vi.fn(), onLayer: vi.fn() };
    const props = { project: p, clock, config: { url: "http://engine", token: "synthetic" }, canvas };
    const view = render(<Preview {...props} />);
    act(() => clock.play());
    fireEvent.click(screen.getByRole("button", { name: "Fit to canvas" }));
    expect(clock.playing).toBe(false);
    expect(canvas.onCommit).toHaveBeenCalledWith("c", { x: 0.5, y: 0.5, scale: 1, opacity: 0.4 });
    view.rerender(<Preview {...props} canvas={{ ...canvas, selectedClipId: null }} />);
    expect(screen.getByRole("button", { name: "Fit to canvas" })).toHaveProperty("disabled", true);
    view.rerender(<Preview {...props} canvas={{ ...canvas, disabledReason: "Resolve pending edit." }} />);
    expect(screen.getByRole("button", { name: "Fit to canvas" })).toHaveProperty("disabled", true);
    const locked = { ...p, tracks: p.tracks.map((track) => ({ ...track, locked: true })) };
    view.rerender(<Preview {...props} project={locked} />);
    expect(screen.getByRole("button", { name: "Fit to canvas" })).toHaveProperty("disabled", true);
    view.rerender(<Preview {...props} offline={new Set(["a"])} />);
    expect(screen.getByRole("button", { name: "Fit to canvas" })).toHaveProperty("disabled", true);
  });

  it.each(["video", "image"] as const)("trims %s in place, and applies zoom/animation around the unchanged source anchor", (kind) => {
    const p = project(clip("c", 0, 0, 60));
    p.assets[0]!.kind = kind;
    p.assets[0]!.width = 200; p.assets[0]!.height = 100;
    p.settings.width = 400; p.settings.height = 200;
    const current = p.tracks[0]!.clips[0]!;
    current.crop = { left: 0.25, right: 0.25, top: 0.1, bottom: 0.1 };
    current.transform = { x: 0.75, y: 0.5, scale: 0.5, opacity: 0.8 };
    current.zoom = { version: 1, startPercent: 0, endPercent: 100, startScale: 1, endScale: 2 };
    current.animations = { entrance: { id: "entrance.fade", version: 1, durationFrames: 15 } };
    const view = show(p, 60);
    const media = view.container.querySelector<HTMLMediaElement | HTMLImageElement>(kind === "image" ? "img" : "video")!;
    const source = media.src;
    const window = view.container.querySelector<HTMLElement>(".preview-crop-window")!;
    expect(window.style.width).toBe("50%");
    expect(window.style.height).toBe("80%");
    expect(window.style.left).toBe("25%");
    expect(window.style.top).toBe("10%");
    expect(media.style.width).toBe("200%");
    expect(media.style.height).toBe("125%");
    expect(media.style.left).toBe("-50%");
    expect(media.style.top).toBe("-12.5%");
    for (const frame of [0, 7, 14, 30, 59]) {
      act(() => clock.seek(frame));
      const expected = animatedTransform(current.animations, 60, frame, current.transform, current.zoom);
      const outer = view.container.querySelector<HTMLElement>(".preview-media-frame")!;
      expect(outer.style.transform).toBe(`translate(${(expected.x - 0.5) * 100}%, ${(expected.y - 0.5) * 100}%) scale(${expected.scale})`);
      expect(Number(outer.style.opacity)).toBeCloseTo(expected.opacity);
      expect(media.src).toBe(source);
    }
    const changed = { ...p, tracks: p.tracks.map((track) => ({ ...track,
      clips: track.clips.map((item) => ({ ...item, crop: { left: 0, top: 0, right: 0, bottom: 0 } })),
    })) };
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={changed} clock={clock} />);
    expect(view.container.querySelector(kind === "image" ? "img" : "video")).toBe(media);
    expect(window.style.width).toBe("100%");
    expect(media.style.width).toBe("100%");
    const cleared = { ...changed, tracks: changed.tracks.map((track) => ({ ...track,
      clips: track.clips.map((item) => ({ ...item, crop: undefined })),
    })) };
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={cleared} clock={clock} />);
    expect(view.container.querySelector(kind === "image" ? "img" : "video")).toBe(media);
    expect(media.src).toBe(source);
    expect(view.container.querySelector(".preview-crop-window")).toBeNull();
    expect(view.container.querySelector<HTMLElement>(".preview-media-frame")!.style.transform).toBe("");
    const expected = animatedTransform(current.animations, 60, clock.frame, current.transform, current.zoom);
    expect(media.style.transform).toBe(`translate(${(expected.x - 0.5) * 100}%, ${(expected.y - 0.5) * 100}%) scale(${expected.scale})`);
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={p} clock={clock} />);
    expect(view.container.querySelector(kind === "image" ? "img" : "video")).toBe(media);
    expect(media.src).toBe(source);
    expect(media.style.transform).toBe("");
    expect(view.container.querySelector<HTMLElement>(".preview-crop-window")!.style.width).toBe("50%");
  });

  it("uses changed project canvas dimensions for the displayed aspect without changing clip data", () => {
    const original = project(clip("c", 0, 0, 60));
    const view = show(original, 60);
    expect(view.container.querySelector<HTMLElement>(".preview-frame")!.style.aspectRatio).toBe("640 / 360");
    const portrait = { ...original, settings: { ...original.settings, width: 360, height: 640 } };
    view.rerender(<Preview project={portrait} clock={clock} config={{ url: "http://engine", token: "synthetic" }} />);
    expect(view.container.querySelector<HTMLElement>(".preview-frame")!.style.aspectRatio).toBe("360 / 640");
    expect(portrait.tracks).toEqual(original.tracks);
  });

  it("steps through a cut in both directions and seeks the matching source frame", () => {
    const view = show(project(clip("first", 0, 0, 30), clip("second", 30, 60, 90)), 60);
    const video = view.container.querySelector("video")!;
    const source = video.src;
    act(() => { clock.seek(29); clock.play(); clock.stepFrame(1); });
    expect(clock.playing).toBe(false);
    expect(clock.frame).toBe(30);
    expect(video.currentTime).toBe(2);
    act(() => clock.stepFrame(-1));
    expect(clock.frame).toBe(29);
    expect(video.currentTime).toBe(29 / 30);
    expect(video.src).toBe(source);
  });

  it("evaluates video/image animations on scrub in project frames without changing media sources or audio", () => {
    const p = project(clip("c", 0, 0, 60));
    const current = p.tracks[0]!.clips[0]!;
    current.transform = { x: 0.6, y: 0.5, scale: 0.8, opacity: 0.6 };
    current.animations = { entrance: { id: "entrance.slide-left", version: 1, durationFrames: 15 },
      exit: { id: "exit.fade", version: 1, durationFrames: 15 } };
    const view = show(p, 60);
    const video = view.container.querySelector("video")!;
    const source = video.src;
    for (const frame of [0, 7, 14, 30, 45, 52, 59, 0]) {
      act(() => clock.seek(frame));
      const expected = animatedTransform(current.animations, 60, frame, current.transform);
      expect(video.style.transform).toBe(`translate(${(expected.x - 0.5) * 100}%, ${(expected.y - 0.5) * 100}%) scale(${expected.scale})`);
      expect(Number(video.style.opacity)).toBeCloseTo(expected.opacity);
      expect(video.src).toBe(source);
      expect(video.volume).toBe(1);
    }
    const image = structuredClone(p); image.assets[0]!.kind = "image";
    image.assets[0]!.sourcePath = "C:\\Synthetic.png"; image.assets[0]!.proxyPath = null;
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={image} clock={clock} />);
    act(() => clock.seek(59));
    expect(view.container.querySelector("img")!.style.opacity).toBe("0");
    const cleared = structuredClone(image); delete cleared.tracks[0]!.clips[0]!.animations;
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={cleared} clock={clock} />);
    expect(view.container.querySelector("img")!.style.opacity).toBe("0.6");
  });
  it("uses saved speed for video/audio source mapping and pitch-preserving playback, independently of transport rate", () => {
    const p = project({ ...clip("c", 0, 0, 120), speed: 2 });
    const view = show(p, 60);
    act(() => { clock.seek(15); clock.setRate(1.5); });
    const video = view.container.querySelector("video")!;
    expect(video.currentTime).toBe(1);
    expect(video.playbackRate).toBe(3);
    expect(video.preservesPitch).toBe(true);
    const changed = structuredClone(p);
    changed.tracks[0]!.clips[0]!.speed = 0.5;
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={changed} clock={clock} />);
    expect(video.currentTime).toBe(0.25);
    expect(video.playbackRate).toBe(0.75);
    const audio = structuredClone(changed);
    audio.tracks[0]!.kind = "audio";
    audio.tracks[0]!.clips[0]!.sourceOut = 240;
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={audio} clock={clock} />);
    const element = view.container.querySelector("audio")!;
    expect(element.currentTime).toBe(0.25);
    expect(element.playbackRate).toBe(0.75);
    expect(element.preservesPitch).toBe(true);
    expect(element.loop).toBe(true);
  });
  it("updates static video/image transforms without restarting media and clips them to the project canvas", () => {
    const p = project(clip("c", 0, 0, 90));
    p.settings.width = 360;
    p.settings.height = 640;
    const view = show(p, 90);
    const video = view.container.querySelector("video")!;
    const source = video.src;
    const changed = structuredClone(p);
    changed.tracks[0]!.clips[0]!.transform = { x: 0.75, y: 0.25, scale: 2, opacity: 0.4 };
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={changed} clock={clock} />);
    expect(video.style.transform).toBe("translate(25%, -25%) scale(2)");
    expect(video.style.opacity).toBe("0.4");
    expect(video.src).toBe(source);
    expect(view.container.querySelector(".preview-canvas")?.contains(video)).toBe(true);
    expect((view.container.querySelector(".preview-frame") as HTMLElement).style.aspectRatio).toBe("360 / 640");
    const still = structuredClone(changed);
    still.assets[0]!.kind = "image";
    still.assets[0]!.proxyPath = null;
    still.assets[0]!.sourcePath = "C:\\Still.png";
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={still} clock={clock} />);
    expect(view.container.querySelector("img")?.style.transform).toBe("translate(25%, -25%) scale(2)");
  });
  it("plays originals while optional preparation is queued, running or failed", () => {
    const p = project(clip("waiting", 0, 0, 90));
    p.assets[0]!.proxyPath = null;
    clock.configure(fps, 90);
    const onRefreshStatus = vi.fn();
    const onPreviewJob = vi.fn();
    const props = { project: p, clock, config: { url: "http://engine", token: "synthetic" }, onRefreshStatus, onPreviewJob };
    const queued: ProxyState = { assetId: "a", state: "queued", percent: 0 };
    const view = render(<Preview {...props} proxyStates={new Map([["a", queued]])} />);
    expect(screen.getByText(/Editing original.*queued/)).toBeDefined();
    expect(view.container.querySelector("video")?.getAttribute("src")).toContain("/media/a/source");
    expect(view.container.querySelector("video")?.className).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Cancel preparation" }));
    expect(onPreviewJob).toHaveBeenCalledExactlyOnceWith("a", "cancel");
    view.rerender(<Preview {...props} proxyStates={new Map([["a", { ...queued, state: "running", percent: 42 }]])} />);
    expect(screen.getByText(/Editing original.*42%/)).toBeDefined();
    const diagnosticId = "00000000-0000-4000-8000-000000000075";
    view.rerender(<Preview {...props} proxyStates={new Map([["a", {
      ...queued, state: "failed", message: "Encoder failed.", diagnosticId,
    }]])} />);
    expect(screen.getByRole("alert").querySelector("details")?.textContent).toContain("Encoder failed.");
    expect(screen.getByRole("alert").querySelector("details")?.textContent).toContain(diagnosticId);
    expect(screen.getByRole("alert").querySelector("details")?.open).toBe(false);
    expect(screen.queryByText("Preparing preview…")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry preview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry optimized preview" }));
    expect(onPreviewJob).toHaveBeenLastCalledWith("a", "prepare");
    view.rerender(<Preview {...props} project={{ ...p, assets: [{ ...p.assets[0]!, proxyPath: "proxies/a.mp4" }] }}
      proxyStates={new Map([["a", { ...queued, state: "done", percent: 100 }]])} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.container.querySelector("video")?.className).toBe("");
  });

  it("explains offline visual and audio media, avoids source requests and recovers after relinking", () => {
    const p = project(clip("offline", 0, 0, 90));
    clock.configure(fps, 90);
    const props = { project: p, clock, config: { url: "http://engine", token: "synthetic" }, onRefreshStatus: vi.fn() };
    const view = render(<Preview {...props} offline={new Set(["a"])} refreshingStatus />);
    expect(screen.getByRole("alert").textContent).toContain("Right-click the asset in Assets and choose Relink");
    expect(view.container.querySelector("video, audio, img")).toBeNull();
    expect((screen.getByRole("button", { name: "Refreshing preview status..." }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<Preview {...props} offline={new Set()} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(view.container.querySelector("video")?.getAttribute("src")).toContain("/media/a/proxy");
    const audio: Project = { ...p, assets: [{ ...p.assets[0]!, kind: "audio", proxyPath: null }],
      tracks: [{ ...p.tracks[0]!, kind: "audio" }] };
    view.rerender(<Preview {...props} project={audio} offline={new Set(["a"])} />);
    expect(screen.getByRole("alert").textContent).toContain("Media is offline");
    expect(view.container.querySelector("audio")).toBeNull();
  });

  it("loads and clock-synchronizes a dedicated audio-track clip", () => {
    const music: Project = {
      ...createEmptyProject({ id: "audio-project", name: "Audio", fps, width: 640, height: 360 }),
      assets: [{
        id: "music", name: "music.wav", kind: "audio", mediaMode: "reference", sourcePath: "C:\\music.wav",
        contentHash: "music", durationFrames: 2000, fps: { num: 1000, den: 1 }, width: null, height: null,
        hasAudio: true, proxyPath: null,
      }],
      tracks: [{ id: "audio-track", kind: "audio", order: 0, muted: false, locked: false, clips: [
        { id: "audio-clip", assetId: "music", timelineStart: 30, sourceIn: 0, sourceOut: 120, speed: 1, audioLinked: true },
      ] }],
    };
    const view = show(music, 150);
    act(() => clock.seek(60));
    expect(screen.getByText("No video at playhead; audio track is active")).toBeDefined();
    const audio = view.container.querySelector("audio");
    expect(audio?.getAttribute("src")).toBe("http://engine/media/music/source?token=synthetic");
    fireEvent.loadedMetadata(audio!);
    expect(audio?.loop).toBe(true);
    expect(setTime).toHaveBeenCalledWith(1);
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(true);
    act(() => clock.play());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("renders overlapping visual tracks in back-to-front DOM order", () => {
    const layered: Project = {
      ...project(clip("bottom-clip", 0, 0, 90)),
      assets: [
        project().assets[0]!,
        {
          id: "image-top", name: "top.png", kind: "image", mediaMode: "reference", sourcePath: "C:\\top.png",
          contentHash: "top", durationFrames: 90, fps: null, width: 640, height: 360, hasAudio: false, proxyPath: null,
        },
      ],
      tracks: [
        { id: "bottom", kind: "video", order: 0, muted: false, locked: false, clips: [clip("bottom-clip", 0, 0, 90)] },
        { id: "top", kind: "overlay", order: 1, muted: false, locked: false, clips: [{ ...clip("top-clip", 0, 0, 90), assetId: "image-top" }] },
      ],
    };
    const view = show(layered, 90);
    expect(view.container.querySelector("video")?.className).toBe("");
    expect(view.container.querySelector("img")?.className).toBe("");
    expect(Array.from(view.container.querySelectorAll(".preview-frame video, .preview-frame img"))
      .map((element) => element.tagName)).toEqual(["VIDEO", "IMG"]);
  });

  it("shows a still-image source in the preview for its timeline clip", () => {
    const still: Project = {
      ...project(clip("still-clip", 0, 0, 150)),
      assets: [{
        id: "a", name: "still.png", kind: "image", mediaMode: "reference", sourcePath: "C:\\still.png",
        contentHash: "still", durationFrames: 150, fps: null, width: 640, height: 360, hasAudio: false, proxyPath: null,
      }],
    };
    const view = show(still, 150);
    expect(view.container.querySelector("img")?.getAttribute("src"))
      .toBe("http://engine/media/a/source?token=synthetic");
    expect(view.container.querySelector("img")?.className).toBe("");
  });

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

  it("pauses the newly active video when playback is stopped after a clip transition", () => {
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(true);
    const firstAsset = project().assets[0]!;
    const secondAsset = { ...firstAsset, id: "b", name: "Second", proxyPath: "proxies/b.mp4" };
    const p: Project = {
      ...project(clip("first", 0, 0, 30), { ...clip("second", 30, 0, 30), assetId: "b" }),
      assets: [firstAsset, secondAsset],
    };
    const view = show(p, 60);
    act(() => clock.play());
    act(() => clock.seek(30));
    const activeVideo = view.container.querySelector("video:not(.hidden)");
    expect(activeVideo).not.toBeNull();
    vi.mocked(HTMLMediaElement.prototype.pause).mockClear();
    act(() => clock.pause());
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
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

  it("shows audio activity during a trailing gap with no visible video", () => {
    const p = project(clip("video", 0, 0, 30));
    p.tracks.push({ id: "audio", kind: "audio", order: 1, muted: false, locked: false,
      clips: [clip("audio-clip", 0, 0, 60)] });
    show(p, 60);
    act(() => clock.seek(60));
    expect(screen.getByText("No video at playhead; audio track is active")).toBeDefined();
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

  it("surfaces rejected playback and retries only after an explicit user action", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(true);
    vi.mocked(HTMLMediaElement.prototype.play)
      .mockRejectedValueOnce(new DOMException("Playback requires a gesture.", "NotAllowedError"))
      .mockResolvedValueOnce();
    show(project(clip("play", 0, 0, 30)), 30);
    act(() => clock.play());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("NotAllowedError"));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry preview" })));
    expect(clock.playing).toBe(false);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    act(() => clock.play());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces decode errors and retries the active proxy", async () => {
    const view = show(project(clip("decode", 0, 0, 30)), 30);
    const video = view.container.querySelector("video")!;
    fireEvent.error(video);
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded or decoded");
    const previousSource = video.getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Retry preview" }));
    expect(video.getAttribute("src")).toBe(previousSource);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(video.className).not.toContain("hidden");
  });

  it.each([
    [1, "Preview loading or playback was interrupted"], [2, "Preview could not read media from the engine"],
    [3, "The media player could not decode this source"], [4, "This source cannot play directly"],
  ])("maps browser media error %i to specific guidance without recording a known error", (code, title) => {
    const view = show(project(clip("c", 0, 0, 30)), 30);
    const video = view.container.querySelector("video")!;
    Object.defineProperty(video, "error", { configurable: true, value: { code } });
    fireEvent.error(video);
    expect(screen.getByText(title)).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("not a timeline edit");
    expect(recordUnknownEditError).not.toHaveBeenCalled();
    expect(clock.playing).toBe(false);
    expect(screen.getByRole("button", { name: "Retry preview" })).toBeDefined();
  });

  it("records an unknown playback envelope without persisting private details and does not spam on rerender", async () => {
    const p = project(clip("c", 0, 0, 30));
    const view = show(p, 30);
    fireEvent.error(view.container.querySelector("video")!);
    await act(async () => undefined);
    expect(recordUnknownEditError).toHaveBeenCalledExactlyOnceWith({ url: "http://engine", token: "synthetic" }, {
      code: "PREVIEW_MEDIA_FAILED", operation: "preview", stage: "playback", outcome: "unavailable",
    });
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={p} clock={clock} />);
    expect(recordUnknownEditError).toHaveBeenCalledOnce();
  });

  it("surfaces unknown recording failures without retrying playback or requesting optimization", async () => {
    vi.mocked(recordUnknownEditError).mockResolvedValueOnce({ ok: false, code: "ERROR_INBOX_FULL", message: "full" });
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(true);
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("private C:\\Secret\\clip.mp4"));
    const p = project(clip("c", 0, 0, 30)), onPreviewJob = vi.fn();
    clock.configure(fps, 30);
    render(<Preview project={p} clock={clock} config={{ url: "http://engine", token: "synthetic" }} onPreviewJob={onPreviewJob} />);
    act(() => clock.play());
    await waitFor(() => expect(screen.getByText(/could not be recorded for development/)).toBeDefined());
    expect(JSON.stringify(vi.mocked(recordUnknownEditError).mock.calls)).not.toContain("Secret");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(onPreviewJob).not.toHaveBeenCalled();
    expect(clock.playing).toBe(false);
    expect(screen.getByRole("alert", { name: "Preview problem" }).querySelector("details")?.open).toBe(false);
  });

  it("explains image and audio failures without offering video preparation for either", () => {
    const p = project(clip("c", 0, 0, 30));
    p.assets[0]!.kind = "image";
    p.assets[0]!.proxyPath = null;
    const view = show(p, 30);
    fireEvent.error(view.container.querySelector("img")!);
    expect(screen.getByText("The preview image could not be loaded")).toBeDefined();
    const audio = structuredClone(p);
    audio.assets[0]!.kind = "audio";
    audio.tracks[0]!.kind = "audio";
    view.rerender(<Preview config={{ url: "http://engine", token: "synthetic" }} project={audio} clock={clock} />);
    const el = view.container.querySelector("audio")!;
    Object.defineProperty(el, "error", { configurable: true, value: { code: 3 } });
    fireEvent.error(el);
    expect(screen.getByText("The media player could not decode this source")).toBeDefined();
    expect(screen.getByRole("button", { name: "Retry audio" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Prepare optimized preview" })).toBeNull();
    expect(recordUnknownEditError).not.toHaveBeenCalled();
  });

  it("bounds original readiness at five seconds without queuing a full conversion automatically", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(0);
      const p = project(clip("slow", 0, 0, 90));
      p.assets[0]!.proxyPath = null;
      const onPreviewJob = vi.fn();
      clock.configure(fps, 90);
      render(<Preview project={p} clock={clock} config={{ url: "http://engine", token: "test" }} onPreviewJob={onPreviewJob} />);
      expect(screen.getByText("Loading original...")).toBeDefined();
      act(() => vi.advanceTimersByTime(4999));
      expect(screen.queryByRole("alert")).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole("alert").textContent).toContain("within 5 seconds");
      expect(onPreviewJob).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Prepare optimized preview" }));
      expect(onPreviewJob).toHaveBeenCalledExactlyOnceWith("a", "prepare");
      expect(clock.playing).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("keeps the original source during playback and switches to a completed proxy only after pause", () => {
    const original = project(clip("play", 0, 0, 90));
    original.assets[0]!.proxyPath = null;
    clock.configure(fps, 90);
    const props = { clock, config: { url: "http://engine", token: "test" } };
    const view = render(<Preview {...props} project={original} />);
    const video = view.container.querySelector("video")!;
    expect(video.getAttribute("src")).toContain("/source");
    act(() => clock.seek(30));
    act(() => clock.play());
    const optimized = { ...original, assets: [{ ...original.assets[0]!, proxyPath: "proxies/a.mp4" }] };
    view.rerender(<Preview {...props} project={optimized} />);
    expect(video.getAttribute("src")).toContain("/source");
    expect(screen.getByText(/pause to switch/)).toBeDefined();
    expect(clock.playing).toBe(true);
    act(() => clock.pause());
    expect(video.getAttribute("src")).toContain("/proxy");
    expect(clock.frame).toBe(30);
    expect(clock.playing).toBe(false);
    expect(setTime).toHaveBeenLastCalledWith(1);
  });

  it("clears the readiness timeout only after a frame loads, not merely metadata", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(0);
      const p = project(clip("load", 0, 0, 90));
      p.assets[0]!.proxyPath = null;
      const view = show(p, 90);
      const video = view.container.querySelector("video")!;
      fireEvent.loadedMetadata(video);
      expect(screen.getByText("Loading original...")).toBeDefined();
      fireEvent.loadedData(video);
      expect(screen.queryByText("Loading original...")).toBeNull();
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.queryByRole("alert")).toBeNull();
    } finally { vi.useRealTimers(); }
  });
});
