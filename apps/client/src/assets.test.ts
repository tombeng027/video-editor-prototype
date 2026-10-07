import { describe, expect, it } from "vitest";
import type { Asset, ProxyState } from "@ve/schema";
import { assetSeconds, formatDuration, formatFps, proxyBadge } from "./assets.js";

const video: Asset = {
  id: "a", kind: "video", name: "a.mp4", mediaMode: "reference", sourcePath: "/a.mp4", contentHash: "h",
  durationFrames: 300, fps: { num: 30000, den: 1001 }, width: 1920, height: 1080, hasAudio: true, proxyPath: null,
};

describe("asset formatting", () => {
  it("computes seconds from native frames", () => {
    expect(assetSeconds(video)).toBeCloseTo(10.01, 2);
    expect(assetSeconds({ durationFrames: 1500, fps: { num: 1000, den: 1 } })).toBe(1.5);
  });
  it("formats durations and frame rates", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatFps({ num: 30000, den: 1001 })).toBe("29.97 fps");
    expect(formatFps({ num: 25, den: 1 })).toBe("25 fps");
  });
});

describe("proxyBadge", () => {
  const state = (s: ProxyState["state"], percent = 0): ProxyState => ({ assetId: "a", state: s, percent });
  it("reflects proxy progress and readiness", () => {
    expect(proxyBadge(video, state("running", 40))).toEqual({ label: "Preparing preview 40%", tone: "busy" });
    expect(proxyBadge(video, state("failed"))).toMatchObject({ tone: "error" });
    expect(proxyBadge({ ...video, proxyPath: "proxies/a.mp4" }, undefined)).toEqual({ label: "Preview ready", tone: "ok" });
    expect(proxyBadge(video, undefined).tone).toBe("busy");
    expect(proxyBadge({ ...video, kind: "audio" }, undefined).tone).toBe("none");
  });
});