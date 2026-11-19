import type { ClipAnimations, ClipCrop, ClipZoom, Project, Rational, Transform } from "@ve/schema";
import { clipDuration, clipEnd } from "./reducer.js";

type RenderLayer = {
  assetId: string; sourceInFrame: number; clipId: string; speed?: number; sourceOutFrame?: number; transform?: Transform;
  crop?: ClipCrop;
  /** The clip's own sound is silenced because its audio was split onto an audio track. */
  audioMuted?: true;
  /** Linear gain for the clip's own sound when below 100%. */
  volume?: number;
} & (
  // Present when the clip has time-varying motion (entrance/exit animations and/or a two-point zoom).
  | { animations?: ClipAnimations; zoom?: ClipZoom; clipDurationFrames: number; clipOffsetFrames: number }
  | { animations?: undefined; zoom?: undefined; clipDurationFrames?: undefined; clipOffsetFrames?: undefined }
);

export type RenderSegment =
  | {
      kind: "clip";
      assetId: string;
      startFrame: number;
      durationFrames: number;
      sourceInFrame: number;
      layers: RenderLayer[];
    }
  | { kind: "gap"; startFrame: number; durationFrames: number };

export type RenderPlan = {
  fps: Rational;
  width: number;
  height: number;
  totalFrames: number;
  segments: RenderSegment[];
  audioClips: { assetId: string; clipId: string; startFrame: number; durationFrames: number; sourceInFrame: number; speed?: number; sourceOutFrame?: number; volume?: number }[];
};

/**
 * Splits the timeline where visual clip membership changes. Layers are ordered back to front,
 * matching the preview; uncovered stretches become gaps. Audio clips remain independent
 * timeline items for mixing over the rendered visual/audio bed.
 */
export function buildRenderPlan(project: Project): RenderPlan {
  const tracks = project.tracks.filter((t) => t.kind !== "audio").sort((a, b) => a.order - b.order);
  const clips = tracks.flatMap((t) => t.clips.map((clip) => ({ clip, track: t })));
  const audioClips = project.tracks
    .filter((track) => track.kind === "audio" && !track.muted)
    .flatMap((track) => track.clips.map((clip) => ({
      assetId: clip.assetId,
      clipId: clip.id,
      startFrame: clip.timelineStart,
      durationFrames: clipEnd(clip) - clip.timelineStart,
      sourceInFrame: clip.sourceIn,
      ...(clip.speed !== 1 ? { speed: clip.speed, sourceOutFrame: clip.sourceOut } : {}),
      ...(clip.volume !== undefined && clip.volume !== 1 ? { volume: clip.volume } : {}),
    })));
  const allAudioEnd = Math.max(0, ...project.tracks
    .filter((track) => track.kind === "audio")
    .flatMap((track) => track.clips.map(clipEnd)));
  const base = {
    fps: project.settings.fps,
    width: project.settings.width,
    height: project.settings.height,
  };
  if (clips.length === 0 && allAudioEnd === 0) return { ...base, totalFrames: 0, segments: [], audioClips };

  const totalFrames = Math.max(
    0,
    ...clips.map(({ clip }) => clipEnd(clip)),
    allAudioEnd,
  );
  const cuts = [...new Set([0, totalFrames, ...clips.flatMap(({ clip }) => [clip.timelineStart, clipEnd(clip)])])].sort(
    (a, b) => a - b,
  );

  const segments: RenderSegment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    const active = clips
      .filter(({ clip }) => clip.timelineStart <= start && clipEnd(clip) >= end)
      .sort((a, b) => a.track.order - b.track.order);
    const last = segments[segments.length - 1];
    if (active.length === 0) {
      if (last?.kind === "gap") last.durationFrames += end - start;
      else segments.push({ kind: "gap", startFrame: start, durationFrames: end - start });
    } else {
      const layers: RenderLayer[] = active.map(({ clip, track }) => {
        const layer = {
          assetId: clip.assetId,
          sourceInFrame: clip.sourceIn + (start - clip.timelineStart) * clip.speed,
          clipId: clip.id,
          ...(clip.speed !== 1 ? { speed: clip.speed, sourceOutFrame: clip.sourceOut } : {}),
          ...(clip.transform ? { transform: clip.transform } : {}),
          ...(clip.crop ? { crop: clip.crop } : {}),
          ...(clip.audioLinked && !track.muted ? {} : { audioMuted: true as const }),
          ...(clip.volume !== undefined && clip.volume !== 1 ? { volume: clip.volume } : {}),
        };
        return clip.animations || clip.zoom
          ? { ...layer, ...(clip.animations ? { animations: clip.animations } : {}), ...(clip.zoom ? { zoom: clip.zoom } : {}),
            clipDurationFrames: clipDuration(clip), clipOffsetFrames: start - clip.timelineStart }
          : layer;
      });
      const top = active[active.length - 1]!.clip;
      segments.push({
        kind: "clip",
        assetId: top.assetId,
        startFrame: start,
        durationFrames: end - start,
        sourceInFrame: layers[layers.length - 1]!.sourceInFrame,
        layers,
      });
    }
  }
  return { ...base, totalFrames, segments, audioClips };
}

/** Ids of the assets a plan needs, in first-use order. */
export function planAssetIds(plan: RenderPlan): string[] {
  return [...new Set([
    ...plan.segments.flatMap((segment) => (segment.kind === "clip" ? segment.layers.map((layer) => layer.assetId) : [])),
    ...plan.audioClips.map((clip) => clip.assetId),
  ])];
}
