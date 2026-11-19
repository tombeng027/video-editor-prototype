import { describe, expect, it } from "vitest";
import type { Asset, Project } from "@ve/schema";
import { applyCommands, createEmptyProject } from "@ve/timeline-core";
import { PlayheadClock, type Scheduler } from "./clock.js";
import { activeAudioClipsAt, activeClipAt, audioSourceSeconds, clampToProxy, needsSeek, proxyUrl, sourceSeconds, timelineDuration } from "./playback.js";
import {
  planAddAudioTrack, planAddToTimeline, planAddVisualTrack, planDelete, planReorderAudioTrack, planSplitAudio,
  planRemoveAsset, planRemoveTrack, planReorderVisualTrack, planSetTrackMuted, planSplit, planTrim,
} from "./timelineOps.js";
import { MIN_ZOOM, clampZoom, framesToPx, pxToFrame, rulerTicks, snapClipFrame } from "./timelineMath.js";

const fps = { num: 30, den: 1 };
describe("saved clip speed mapping", () => {
  it("maps fractional playhead positions through speed and wraps extended audio in source time", () => {
    const clip = { id: "c", assetId: "a1", timelineStart: 30, sourceIn: 15, sourceOut: 75, speed: 2, audioLinked: true };
    expect(sourceSeconds(clip, 37.5, fps)).toBe(1);
    expect(sourceSeconds(clip, 100, fps)).toBe(74 / 30);
    const active = { clip, asset, track: { id: "t", kind: "audio" as const, order: 0, locked: false, muted: false, clips: [clip] } };
    expect(audioSourceSeconds(active, 75, fps)).toBe(0.5);
  });
});
const asset: Asset = {
  id: "a1",
  kind: "video",
  name: "a.mp4",
  mediaMode: "reference",
  sourcePath: "C:/a.mp4",
  contentHash: "h",
  durationFrames: 90,
  fps,
  width: 1280,
  height: 720,
  hasAudio: true,
  proxyPath: "proxies/a1.mp4",
};
const image: Asset = {
  ...asset,
  id: "image1",
  kind: "image",
  name: "still.png",
  durationFrames: 150,
  fps: null,
  hasAudio: false,
  proxyPath: null,
};
const audio: Asset = {
  ...asset,
  id: "audio1",
  kind: "audio",
  name: "music.mp3",
  durationFrames: 5000,
  fps: { num: 1000, den: 1 },
  width: null,
  height: null,
  hasAudio: true,
  proxyPath: null,
};
const ids = () => {
  let n = 0;
  return (prefix: string) => `${prefix}${++n}`;
};
const base = (): Project => ({
  ...createEmptyProject({ id: "p", name: "P", fps, width: 1280, height: 720 }),
  assets: [asset],
});
const apply = (project: Project, commands: Parameters<typeof applyCommands>[1]): Project => {
  const result = applyCommands(project, commands);
  if (!result.ok) throw new Error(result.error.message);
  return result.project;
};

describe("planAddToTimeline", () => {
  it("creates a track and places the clip at the playhead", () => {
    const plan = planAddToTimeline(base(), asset, ids());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const project = apply(base(), plan.commands);
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0]!.clips[0]).toMatchObject({ timelineStart: 0, sourceIn: 0, sourceOut: 90 });
  });

  it("places media at the playhead on a selected compatible track", () => {
    const project = {
      ...base(),
      tracks: [
        { id: "visual-1", kind: "video" as const, order: 0, muted: false, locked: false, clips: [
          { id: "existing", assetId: asset.id, timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1 as const, audioLinked: true },
        ] },
        { id: "visual-2", kind: "overlay" as const, order: 1, muted: false, locked: false, clips: [] },
      ],
    };
    const plan = planAddToTimeline(project, asset, ids(), 45, "visual-2");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.commands).toHaveLength(1);
    expect(plan.commands[0]).toMatchObject({
      type: "AddClip", trackId: "visual-2", clip: { timelineStart: 45, sourceOut: 90 },
    });
    const insertion = planAddToTimeline(project, asset, ids(), 20, "visual-1");
    if (!insertion.ok) throw new Error(insertion.message);
    expect(apply(project, insertion.commands).tracks[0]!.clips.map((clip) => clip.timelineStart)).toEqual([20, 110]);
    expect(planAddToTimeline(project, audio, ids(), 45, "visual-2")).toMatchObject({ ok: false });
  });

  it("uses a separate visual track when the playhead overlaps all existing rows", () => {
    const first = planAddToTimeline(base(), asset, ids());
    if (!first.ok) throw new Error("plan");
    const once = apply(base(), first.commands);
    const second = planAddToTimeline(once, asset);
    if (!second.ok) throw new Error("plan");
    expect(second.commands[0]).toMatchObject({ type: "AddTrack", track: { kind: "overlay" } });
    const twice = apply(once, second.commands);
    expect(twice.tracks.flatMap((track) => track.clips).map((clip) => clip.timelineStart)).toEqual([0, 0]);
  });

  it("places audio at the playhead on a dedicated row", () => {
    const project = { ...base(), assets: [audio] };
    const plan = planAddToTimeline(project, audio, ids(), 45);
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0]).toMatchObject({ type: "AddTrack", track: { kind: "audio" } });
    const updated = apply(project, plan.commands);
    expect(updated.tracks[0]).toMatchObject({ kind: "audio", clips: [{ timelineStart: 45, sourceOut: 150 }] });
  });

  it("uses a separate audio row when the playhead placement would overlap", () => {
    const source = { ...base(), assets: [audio] };
    const newId = ids();
    const first = planAddToTimeline(source, audio, newId, 0);
    if (!first.ok) throw new Error(first.message);
    const once = apply(source, first.commands);
    const second = planAddToTimeline(once, audio, newId, 0);
    if (!second.ok) throw new Error(second.message);
    expect(second.commands[0]).toMatchObject({ type: "AddTrack", track: { kind: "audio" } });
    expect(apply(once, second.commands).tracks.filter((track) => track.kind === "audio")).toHaveLength(2);
  });

  it("places audio at a selected audio row and ripples collisions", () => {
    const source = { ...base(), assets: [audio], tracks: [{
      id: "audio-track", kind: "audio" as const, order: 0, muted: false, locked: false, clips: [
        { id: "sound", assetId: audio.id, timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1 as const, audioLinked: true },
      ],
    }] };
    const plan = planAddToTimeline(source, audio, ids(), 60, "audio-track");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.commands[0]).toMatchObject({
      type: "AddClip", trackId: "audio-track", clip: { timelineStart: 60 },
    });
    const insertion = planAddToTimeline(source, audio, ids(), 15, "audio-track");
    if (!insertion.ok) throw new Error(insertion.message);
    expect(apply(source, insertion.commands).tracks[0]!.clips.map((clip) => clip.timelineStart)).toEqual([15, 165]);
  });

  it("adds a still image using its project-frame duration", () => {
    const plan = planAddToTimeline({ ...base(), assets: [image] }, image, ids());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(apply({ ...base(), assets: [image] }, plan.commands).tracks[0]!.clips[0])
      .toMatchObject({ assetId: "image1", timelineStart: 0, sourceIn: 0, sourceOut: 150 });
  });

  it("plans visual track creation, adjacent layer reordering, and clip trimming", () => {
    const project = {
      ...base(),
      tracks: [
        { id: "v", kind: "video" as const, order: 0, muted: false, locked: false, clips: [] },
        { id: "a", kind: "audio" as const, order: 1, muted: false, locked: false, clips: [] },
        { id: "o", kind: "overlay" as const, order: 2, muted: false, locked: false, clips: [] },
      ],
    };
    const addTrack = planAddVisualTrack(project, ids());
    if (!addTrack.ok) throw new Error(addTrack.message);
    expect(addTrack.commands[0]).toMatchObject({ type: "AddTrack", track: { kind: "overlay", order: 3 } });
    const reorder = planReorderVisualTrack(project, "v", 1);
    if (!reorder.ok) throw new Error(reorder.message);
    expect(reorder.commands[0])
      .toEqual({ type: "SwapTrackOrder", firstTrackId: "v", secondTrackId: "o" });
    const trim = planTrim({ ...project, tracks: [{ ...project.tracks[0]!, clips: [{
      id: "c", assetId: "a1", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1 as const, audioLinked: true,
    }] }] }, "c", 5, 80);
    if (!trim.ok) throw new Error(trim.message);
    expect(trim.commands[0]).toEqual({ type: "TrimClip", clipId: "c", sourceIn: 5, sourceOut: 80 });
  });

  it("plans audio track management and looping source-time mapping", () => {
    const project = { ...base(), assets: [audio] };
    const add = planAddAudioTrack(project, ids());
    if (!add.ok) throw new Error(add.message);
    const withTrack = apply(project, add.commands);
    expect(withTrack.tracks[0]).toMatchObject({ kind: "audio", muted: false });
    const move = planReorderAudioTrack({ ...withTrack, tracks: [
      { ...withTrack.tracks[0]!, order: 0 },
      { id: "audio2", kind: "audio", order: 1, muted: false, locked: false, clips: [] },
    ] }, withTrack.tracks[0]!.id, 1);
    if (!move.ok) throw new Error(move.message);
    expect(move.commands[0]).toMatchObject({ type: "SwapTrackOrder" });
    const mute = planSetTrackMuted(withTrack, withTrack.tracks[0]!.id, true);
    if (!mute.ok) throw new Error(mute.message);
    expect(mute.commands[0]).toMatchObject({ type: "SetTrackMuted", muted: true });

    const clip = { id: "sound", assetId: audio.id, timelineStart: 30, sourceIn: 120, sourceOut: 420, speed: 1 as const, audioLinked: true };
    const active = { clip, track: { ...withTrack.tracks[0]!, clips: [clip] }, asset: audio };
    expect(audioSourceSeconds(active, 330, fps)).toBe(4);
    expect(activeAudioClipsAt({
      ...withTrack,
      tracks: [{ ...withTrack.tracks[0]!, clips: [clip] }],
    }, 60)).toHaveLength(1);
  });
});

describe("planRemoveAsset and planRemoveTrack", () => {
  it("plans removal of an unused asset and rejects an asset with clips", () => {
    const project = base();
    expect(planRemoveAsset(project, asset.id)).toEqual({
      ok: true, commands: [{ type: "RemoveAsset", assetId: asset.id }],
    });
    const add = planAddToTimeline(project, asset, ids());
    if (!add.ok) throw new Error(add.message);
    const withClip = apply(project, add.commands);
    expect(planRemoveAsset(withClip, asset.id)).toMatchObject({ ok: false });
  });

  it("plans removal only for empty tracks", () => {
    const project = {
      ...base(),
      tracks: [{ id: "empty", kind: "video" as const, order: 0, muted: false, locked: false, clips: [] }],
    };
    const plan = planRemoveTrack(project, "empty");
    expect(plan).toEqual({ ok: true, commands: [{ type: "RemoveTrack", trackId: "empty" }] });
    expect(apply(project, plan.ok ? plan.commands : []).tracks).toHaveLength(0);
    expect(planRemoveTrack({ ...project, tracks: [{ ...project.tracks[0]!, clips: [{
      id: "clip", assetId: asset.id, timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1 as const, audioLinked: true,
    }] }] }, "empty")).toMatchObject({ ok: false });
  });
});

describe("planSplit and planDelete", () => {
  const withClip = () => {
    const plan = planAddToTimeline(base(), asset, ids());
    if (!plan.ok) throw new Error("plan");
    return apply(base(), plan.commands);
  };

  it("splits the clip under the playhead", () => {
    const project = withClip();
    const plan = planSplit(project, 30, null);
    if (!plan.ok) throw new Error(plan.message);
    const result = apply(project, plan.commands);
    expect(result.tracks[0]!.clips.map((c) => [c.timelineStart, c.sourceIn, c.sourceOut])).toEqual([
      [0, 0, 30],
      [30, 30, 90],
    ]);
  });

  it("refuses at a clip edge or over empty space", () => {
    const project = withClip();
    expect(planSplit(project, 0, null).ok).toBe(false);
    expect(planSplit(project, 200, null).ok).toBe(false);
  });

  it("prefers the selected clip when the playhead is inside it", () => {
    let project = withClip();
    const first = planSplit(project, 30, null);
    if (!first.ok) throw new Error("plan");
    project = apply(project, first.commands);
    const clips = project.tracks[0]!.clips;
    const plan = planSplit(project, 60, clips[1]!.id);
    if (!plan.ok) throw new Error("plan");
    expect(plan.commands[0]).toMatchObject({ clipId: clips[1]!.id, frame: 60 });
  });

  it("deletes only an existing selection", () => {
    const project = withClip();
    expect(planDelete(project, null).ok).toBe(false);
    expect(planDelete(project, "missing").ok).toBe(false);
    expect(planDelete(project, project.tracks[0]!.clips[0]!.id).ok).toBe(true);
  });

  it("splits audio onto a free audio track, or adds one in the same undoable batch", () => {
    const project = withClip();
    const clipId = project.tracks[0]!.clips[0]!.id;
    const fresh = planSplitAudio(project, clipId, (prefix) => `${prefix}-split`);
    if (!fresh.ok) throw new Error(fresh.message);
    expect(fresh.commands.map((command) => command.type)).toEqual(["AddTrack", "SplitAudio"]);
    const split = apply(project, fresh.commands);
    const audioTrack = split.tracks.find((track) => track.kind === "audio")!;
    expect(audioTrack.clips).toMatchObject([{ assetId: asset.id, timelineStart: 0, sourceIn: 0, sourceOut: 90 }]);
    expect(split.tracks[0]!.clips[0]!.audioLinked).toBe(false);
    expect(planSplitAudio(split, clipId)).toMatchObject({ ok: false, message: "This clip's audio is already on an audio track." });
    expect(planSplitAudio(split, audioTrack.clips[0]!.id).ok).toBe(false);
    expect(planSplitAudio(project, null).ok).toBe(false);

    const addTrack = planAddAudioTrack(project, (prefix) => `${prefix}-free`);
    if (!addTrack.ok) throw new Error(addTrack.message);
    const withFreeTrack = apply(project, addTrack.commands);
    const reuse = planSplitAudio(withFreeTrack, clipId, (prefix) => `${prefix}-split`);
    if (!reuse.ok) throw new Error(reuse.message);
    expect(reuse.commands.map((command) => command.type)).toEqual(["SplitAudio"]);
  });
});

describe("playback helpers", () => {
  const project = (() => {
    const plan = planAddToTimeline(base(), asset, ids());
    if (!plan.ok) throw new Error("plan");
    return apply(base(), plan.commands);
  })();

  it("measures the timeline and finds the active clip", () => {
    expect(timelineDuration(project)).toBe(90);
    expect(activeClipAt(project, 0)?.asset.id).toBe("a1");
    expect(activeClipAt(project, 89)).not.toBeNull();
    expect(activeClipAt(project, 90)).toBeNull();
    expect(timelineDuration(base())).toBe(0);
  });

  it("maps timeline frames to source seconds", () => {
    const clip = { ...project.tracks[0]!.clips[0]!, timelineStart: 60, sourceIn: 30 };
    expect(sourceSeconds(clip, 90, fps)).toBe(2);
  });

  it("clamps to the proxy's real end (K6)", () => {
    expect(clampToProxy(3, 2.9667, fps)).toBeCloseTo(2.9333, 3);
    expect(clampToProxy(1, 2.9667, fps)).toBe(1);
    expect(clampToProxy(-1, 3, fps)).toBe(0);
    expect(clampToProxy(5, NaN, fps)).toBe(5);
  });

  it("only seeks when the player has drifted", () => {
    expect(needsSeek(1.0, 1.1, true, fps)).toBe(false);
    expect(needsSeek(1.0, 1.4, true, fps)).toBe(true);
    expect(needsSeek(1.0, 1.0, false, fps)).toBe(false);
    expect(needsSeek(1.0, 1.05, false, fps)).toBe(true);
  });

  it("builds an authenticated proxy URL", () => {
    expect(proxyUrl({ url: "http://h:1", token: "t k" }, "a/1")).toBe("http://h:1/media/a%2F1/proxy?token=t%20k");
  });
});

describe("timeline math", () => {
  it("converts between frames and pixels", () => {
    expect(framesToPx(30, fps, 60)).toBe(60);
    expect(pxToFrame(60, fps, 60)).toBe(30);
    expect(pxToFrame(-10, fps, 60)).toBe(0);
    expect(pxToFrame(framesToPx(45, { num: 30000, den: 1001 }, 80), { num: 30000, den: 1001 }, 80)).toBe(45);
  });

  it("snaps either clip edge to a nearby frame within eight pixels", () => {
    expect(snapClipFrame(64, 30, [60], fps, 60)).toEqual({
      startFrame: 60, guideFrame: 60, distancePx: 8,
    });
    expect(snapClipFrame(61, 30, [90], fps, 60)).toEqual({
      startFrame: 60, guideFrame: 90, distancePx: 2,
    });
    expect(snapClipFrame(65, 30, [60], fps, 60)).toBeNull();
  });

  it("clamps zoom and widens tick steps when zoomed out", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(9999)).toBe(400);
    const near = rulerTicks(20, fps, 100);
    const far = rulerTicks(20, fps, 10);
    expect(near[1]!.seconds).toBe(1);
    expect(far[1]!.seconds).toBe(10);
    expect(near[0]!.label).toBe("00:00");
    expect(near[2]!.label).toBe("00:02");
  });

  it("supports three-hour overviews with distinct hour labels and bounded ruler density", () => {
    const longFps = { num: 30000, den: 1001 };
    const seconds = 10800;
    expect(framesToPx(seconds * 30, fps, MIN_ZOOM)).toBeLessThan(400);
    for (const zoom of [0.05, MIN_ZOOM]) {
      const ticks = rulerTicks(seconds, longFps, zoom);
      expect(ticks.length).toBeLessThanOrEqual(10);
      expect(new Set(ticks.map((tick) => tick.label)).size).toBe(ticks.length);
      expect(ticks.some((tick) => tick.label.startsWith("02:"))).toBe(true);
      for (let i = 1; i < ticks.length; i++) expect(ticks[i]!.px - ticks[i - 1]!.px).toBeGreaterThanOrEqual(70);
      expect(pxToFrame(framesToPx(123456, longFps, zoom), longFps, zoom)).toBe(123456);
    }
    const multiDay = rulerTicks(48 * 3600, fps, MIN_ZOOM);
    expect(multiDay[1]!.px).toBeGreaterThanOrEqual(70);
    expect(multiDay.length).toBeLessThan(30);
  });
});

class FakeScheduler implements Scheduler {
  time = 0;
  private callbacks = new Map<number, () => void>();
  private next = 1;
  now = () => this.time;
  request = (cb: () => void) => {
    this.callbacks.set(this.next, cb);
    return this.next++;
  };
  cancel = (h: number) => void this.callbacks.delete(h);
  advance(ms: number) {
    this.time += ms;
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    pending.forEach((cb) => cb());
  }
}

describe("PlayheadClock", () => {
  const make = (duration = 90) => {
    const scheduler = new FakeScheduler();
    const clock = new PlayheadClock(scheduler);
    clock.configure(fps, duration);
    return { scheduler, clock };
  };

  it("advances with elapsed time and the rate", () => {
    const { scheduler, clock } = make();
    clock.play();
    scheduler.advance(1000);
    expect(clock.position).toBeCloseTo(30);
    clock.setRate(2);
    scheduler.advance(500);
    expect(clock.position).toBeCloseTo(60);
  });

  it("stops at the end and restarts from the beginning", () => {
    const { scheduler, clock } = make();
    clock.play();
    scheduler.advance(5000);
    expect(clock.position).toBe(90);
    expect(clock.playing).toBe(false);
    clock.play();
    expect(clock.position).toBe(0);
    expect(clock.playing).toBe(true);
  });

  it("does not play an empty timeline and clamps seeks", () => {
    const empty = make(0);
    empty.clock.play();
    expect(empty.clock.playing).toBe(false);
    const { clock } = make();
    clock.seek(500);
    expect(clock.position).toBe(90);
    clock.seek(-5);
    expect(clock.position).toBe(0);
  });

  it("clamps the position when the timeline shrinks and notifies listeners", () => {
    const { scheduler, clock } = make();
    let ticks = 0;
    let states = 0;
    clock.onTick(() => ticks++);
    clock.onState(() => states++);
    clock.seek(80);
    clock.configure(fps, 50);
    expect(clock.position).toBe(50);
    clock.play();
    scheduler.advance(100);
    expect(states).toBeGreaterThan(0);
    expect(ticks).toBeGreaterThan(2);
  });

  it("pauses without drifting", () => {
    const { scheduler, clock } = make();
    clock.play();
    scheduler.advance(500);
    clock.pause();
    const at = clock.position;
    scheduler.advance(1000);
    expect(clock.position).toBe(at);
  });

  it.each([{ num: 30, den: 1 }, { num: 30000, den: 1001 }])(
    "steps exactly one project frame at $num/$den fps, ignoring playback rate",
    (projectFps) => {
      const { clock, scheduler } = make();
      clock.configure(projectFps, 90);
      clock.setRate(2);
      clock.seek(10.75);
      clock.play();
      clock.stepFrame(1);
      expect(clock.playing).toBe(false);
      expect(clock.position).toBe(11);
      scheduler.advance(1000);
      expect(clock.position).toBe(11);
      clock.stepFrame(-1);
      expect(clock.position).toBe(10);
      clock.seek(10.75);
      clock.stepFrame(-1);
      expect(clock.position).toBe(9);
    },
  );

  it("clamps frame stepping to included frames, including empty and one-frame timelines", () => {
    const { clock } = make();
    clock.stepFrame(-1);
    expect(clock.position).toBe(0);
    clock.seek(89);
    clock.stepFrame(1);
    expect(clock.position).toBe(89);
    clock.seek(90);
    clock.stepFrame(-1);
    expect(clock.position).toBe(89);
    clock.seek(90);
    clock.stepFrame(1);
    expect(clock.position).toBe(89);
    for (const duration of [0, 1]) {
      clock.configure(fps, duration);
      clock.stepFrame(1);
      expect(clock.position).toBe(0);
      clock.stepFrame(-1);
      expect(clock.position).toBe(0);
    }
  });
});
