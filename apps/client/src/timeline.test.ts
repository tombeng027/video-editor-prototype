import { describe, expect, it } from "vitest";
import type { Asset, Project } from "@ve/schema";
import { applyCommands, createEmptyProject } from "@ve/timeline-core";
import { PlayheadClock, type Scheduler } from "./clock.js";
import { activeClipAt, clampToProxy, needsSeek, proxyUrl, sourceSeconds, timelineDuration } from "./playback.js";
import { planAddToTimeline, planDelete, planSplit } from "./timelineOps.js";
import { clampZoom, framesToPx, pxToFrame, rulerTicks } from "./timelineMath.js";

const fps = { num: 30, den: 1 };
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
  it("creates a track and appends the clip", () => {
    const plan = planAddToTimeline(base(), asset, ids());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const project = apply(base(), plan.commands);
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0]!.clips[0]).toMatchObject({ timelineStart: 0, sourceIn: 0, sourceOut: 90 });
  });

  it("appends after the existing clips without a new track", () => {
    const first = planAddToTimeline(base(), asset, ids());
    if (!first.ok) throw new Error("plan");
    const once = apply(base(), first.commands);
    const second = planAddToTimeline(once, asset);
    if (!second.ok) throw new Error("plan");
    expect(second.commands).toHaveLength(1);
    const twice = apply(once, second.commands);
    expect(twice.tracks[0]!.clips.map((c) => c.timelineStart)).toEqual([0, 90]);
  });

  it("rejects non-video assets", () => {
    expect(planAddToTimeline(base(), { ...asset, kind: "audio" }).ok).toBe(false);
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

  it("clamps zoom and widens tick steps when zoomed out", () => {
    expect(clampZoom(1)).toBe(10);
    expect(clampZoom(9999)).toBe(400);
    const near = rulerTicks(20, fps, 100);
    const far = rulerTicks(20, fps, 10);
    expect(near[1]!.seconds).toBe(1);
    expect(far[1]!.seconds).toBe(10);
    expect(near[0]!.label).toBe("00:00");
    expect(near[2]!.label).toBe("00:02");
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
});
