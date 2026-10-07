import type { Asset, Rational } from "@ve/schema";

export function rationalToNumber(r: Rational): number {
  return r.num / r.den;
}

export function secondsToFrames(seconds: number, fps: Rational): number {
  return Math.round((seconds * fps.num) / fps.den);
}

export function framesToSeconds(frames: number, fps: Rational): number {
  return (frames * fps.den) / fps.num;
}

/** Converts a frame count between two frame rates, rounding to the nearest frame. */
export function convertFrames(frames: number, from: Rational, to: Rational): number {
  return Math.round((frames * from.den * to.num) / (from.num * to.den));
}

/** Duration of an asset expressed in project frames. */
export function assetDurationInProjectFrames(asset: Asset, projectFps: Rational): number {
  if (asset.fps === null) return asset.durationFrames;
  return convertFrames(asset.durationFrames, asset.fps, projectFps);
}

/**
 * Parses `s`, `ss.fff`, `m:ss`, `h:mm:ss` (seconds may be fractional) into seconds.
 * Returns null for anything else.
 */
export function parseTimestamp(input: string): number | null {
  const parts = input.trim().split(":");
  if (parts.length < 1 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(0, -1).some((n) => !Number.isInteger(n))) return null;
  const last = nums[nums.length - 1] as number;
  if (nums.length > 1 && last >= 60) return null;
  if (nums.length === 3 && (nums[1] as number) >= 60) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** Formats frames as `HH:MM:SS:FF` using the nominal (rounded) frame rate for the frame part. */
export function formatTimecode(frames: number, fps: Rational): string {
  const nominal = Math.max(1, Math.round(rationalToNumber(fps)));
  const totalSeconds = Math.floor(framesToSeconds(frames, fps));
  const remainder = frames - secondsToFrames(totalSeconds, fps);
  const ff = Math.min(Math.max(remainder, 0), nominal - 1);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(ff)}`;
}
