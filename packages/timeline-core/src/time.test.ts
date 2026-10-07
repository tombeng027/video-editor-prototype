import { describe, expect, it } from "vitest";
import type { Rational } from "@ve/schema";
import {
  assetDurationInProjectFrames,
  convertFrames,
  formatTimecode,
  framesToSeconds,
  parseTimestamp,
  secondsToFrames,
} from "./time.js";

const fps30: Rational = { num: 30, den: 1 };
const fps2997: Rational = { num: 30000, den: 1001 };
const fps24: Rational = { num: 24, den: 1 };

describe("time conversion", () => {
  it("converts seconds and frames at integer and fractional rates", () => {
    expect(secondsToFrames(10, fps30)).toBe(300);
    expect(secondsToFrames(10, fps2997)).toBe(300);
    expect(framesToSeconds(300, fps2997)).toBeCloseTo(10.01, 5);
  });

  it("converts frames between frame rates", () => {
    expect(convertFrames(240, fps24, fps30)).toBe(300);
    expect(convertFrames(300, fps30, fps24)).toBe(240);
    expect(convertFrames(100, fps30, fps30)).toBe(100);
  });

  it("uses native fps for assets and passes images through", () => {
    const base = {
      id: "a",
      name: "a",
      mediaMode: "reference" as const,
      sourcePath: "a",
      contentHash: "h",
      width: 1920,
      height: 1080,
      hasAudio: false,
      proxyPath: null,
    };
    expect(
      assetDurationInProjectFrames({ ...base, kind: "video", durationFrames: 240, fps: fps24 }, fps30),
    ).toBe(300);
    expect(
      assetDurationInProjectFrames({ ...base, kind: "image", durationFrames: 150, fps: null }, fps30),
    ).toBe(150);
    expect(
      assetDurationInProjectFrames(
        { ...base, kind: "audio", durationFrames: 2000, fps: { num: 1000, den: 1 } },
        fps30,
      ),
    ).toBe(60);
  });
});

describe("parseTimestamp", () => {
  it("parses common formats", () => {
    expect(parseTimestamp("0:10")).toBe(10);
    expect(parseTimestamp("1:05")).toBe(65);
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("12.5")).toBe(12.5);
    expect(parseTimestamp("0:10.5")).toBe(10.5);
  });

  it("rejects invalid input", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
    expect(parseTimestamp("1:75")).toBeNull();
    expect(parseTimestamp("1:2:3:4")).toBeNull();
    expect(parseTimestamp("-5")).toBeNull();
    expect(parseTimestamp("1.5:30")).toBeNull();
  });
});

describe("formatTimecode", () => {
  it("formats frames as HH:MM:SS:FF", () => {
    expect(formatTimecode(0, fps30)).toBe("00:00:00:00");
    expect(formatTimecode(45, fps30)).toBe("00:00:01:15");
    expect(formatTimecode(30 * 3661, fps30)).toBe("01:01:01:00");
  });
});
