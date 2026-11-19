import type { Asset, Clip, Project, Track } from "@ve/schema";
import { assetDurationInProjectFrames, clipEnd, framesToSeconds } from "@ve/timeline-core";
import type { EngineConfig } from "./engine.js";

export type ActiveClip = { clip: Clip; track: Track; asset: Asset };

/** Active visual clips in compositing order, back to front. */
export function activeVisualClipsAt(project: Project, frame: number): ActiveClip[] {
  return project.tracks
    .filter((track) => track.kind !== "audio")
    .sort((a, b) => a.order - b.order)
    .flatMap((track) => {
      const clip = track.clips.find((candidate) => frame >= candidate.timelineStart && frame < clipEnd(candidate));
      const asset = clip && project.assets.find((candidate) => candidate.id === clip.assetId);
      return clip && asset ? [{ clip, track, asset }] : [];
    });
}

/** Active audio clips, one per audio track, in track order. */
export function activeAudioClipsAt(project: Project, frame: number): ActiveClip[] {
  return project.tracks
    .filter((track) => track.kind === "audio")
    .sort((a, b) => a.order - b.order)
    .flatMap((track) => {
      const clip = track.clips.find((candidate) => frame >= candidate.timelineStart && frame < clipEnd(candidate));
      const asset = clip && project.assets.find((candidate) => candidate.id === clip.assetId);
      return clip && asset ? [{ clip, track, asset }] : [];
    });
}

/** Editor playback includes captions; export duration remains media-only in the engine. */
export function timelineDuration(project: Project): number {
  let end = 0;
  for (const track of project.tracks) for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  for (const cue of project.captionCues) end = Math.max(end, cue.end);
  return end;
}

/** The visible clip at `frame`: the highest-order video or overlay track that has one. */
export function activeClipAt(project: Project, frame: number): ActiveClip | null {
  return activeVisualClipsAt(project, frame).at(-1) ?? null;
}

/** Seconds into the clip's inclusive source range for a fractional timeline position. */
export function sourceSeconds(clip: Clip, position: number, fps: Project["settings"]["fps"]): number {
  const sourceFrame = Math.min(clip.sourceOut - 1, Math.max(clip.sourceIn, (position - clip.timelineStart) * clip.speed + clip.sourceIn));
  return framesToSeconds(sourceFrame, fps);
}

/** Maps an audio clip's timeline position to a looping source position. */
export function audioSourceSeconds(active: ActiveClip, position: number, fps: Project["settings"]["fps"]): number {
  const duration = assetDurationInProjectFrames(active.asset, fps);
  const sourceFrame = (active.clip.sourceIn + Math.max(0, position - active.clip.timelineStart) * active.clip.speed) % duration;
  return framesToSeconds(sourceFrame, fps);
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

export function imageUrl(config: EngineConfig, assetId: string): string {
  return `${config.url}/media/${encodeURIComponent(assetId)}/source?token=${encodeURIComponent(config.token)}`;
}

export const audioUrl = imageUrl;
