import type { Asset, Clip, Project, Track } from "@ve/schema";
import { clipEnd, framesToSeconds } from "@ve/timeline-core";
import type { EngineConfig } from "./engine.js";

export type ActiveClip = { clip: Clip; track: Track; asset: Asset };

/** End of the last clip on any track, in project frames. */
export function timelineDuration(project: Project): number {
  let end = 0;
  for (const track of project.tracks) for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  return end;
}

/** The visible clip at `frame`: the highest-order video or overlay track that has one. */
export function activeClipAt(project: Project, frame: number): ActiveClip | null {
  const tracks = project.tracks
    .filter((t) => t.kind !== "audio")
    .sort((a, b) => b.order - a.order);
  for (const track of tracks) {
    const clip = track.clips.find((c) => frame >= c.timelineStart && frame < clipEnd(c));
    if (!clip) continue;
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (asset) return { clip, track, asset };
  }
  return null;
}

/** Seconds into the source media for a (possibly fractional) timeline position. */
export function sourceSeconds(clip: Clip, position: number, fps: Project["settings"]["fps"]): number {
  return framesToSeconds(position - clip.timelineStart + clip.sourceIn, fps);
}

/**
 * Proxies can be a frame shorter than the asset (K6), so never ask the player
 * for a time at or past its real end.
 */
export function clampToProxy(seconds: number, proxyDuration: number, fps: Project["settings"]["fps"]): number {
  const lower = Math.max(0, seconds);
  if (!Number.isFinite(proxyDuration) || proxyDuration <= 0) return lower;
  const lastFrame = Math.max(0, proxyDuration - framesToSeconds(1, fps));
  return Math.min(lower, lastFrame);
}

/** True when the player is far enough from the wanted time that it must be seeked. */
export function needsSeek(current: number, wanted: number, playing: boolean, fps: Project["settings"]["fps"]): boolean {
  const tolerance = playing ? 0.25 : framesToSeconds(1, fps) / 2;
  return Math.abs(current - wanted) > tolerance;
}

export function proxyUrl(config: EngineConfig, assetId: string): string {
  return `${config.url}/media/${encodeURIComponent(assetId)}/proxy?token=${encodeURIComponent(config.token)}`;
}
