import type { Asset, Command, Project } from "@ve/schema";
import { assetDurationInProjectFrames, clipEnd } from "@ve/timeline-core";
import { activeClipAt } from "./playback.js";

export type IdFactory = (prefix: string) => string;

export const randomId: IdFactory = (prefix) => `${prefix}_${crypto.randomUUID()}`;

export type Plan = { ok: true; commands: Command[]; clipId?: string } | { ok: false; message: string };

/** Appends the whole asset to the end of the first video track, creating the track if needed. */
export function planAddToTimeline(project: Project, asset: Asset, newId: IdFactory = randomId): Plan {
  if (asset.kind !== "video") return { ok: false, message: "Only video assets can be placed on the timeline for now." };
  const commands: Command[] = [];
  const track = project.tracks.filter((t) => t.kind === "video").sort((a, b) => a.order - b.order)[0];
  let trackId = track?.id;
  if (!track) {
    trackId = newId("track");
    const order = project.tracks.reduce((max, t) => Math.max(max, t.order + 1), 0);
    commands.push({ type: "AddTrack", track: { id: trackId, kind: "video", order, muted: false, locked: false, clips: [] } });
  }
  const start = track ? track.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0) : 0;
  const clipId = newId("clip");
  commands.push({
    type: "AddClip",
    trackId: trackId as string,
    clip: {
      id: clipId,
      assetId: asset.id,
      timelineStart: start,
      sourceIn: 0,
      sourceOut: assetDurationInProjectFrames(asset, project.settings.fps),
      speed: 1,
      audioLinked: true,
    },
  });
  return { ok: true, commands, clipId };
}

/** Splits the selected clip if the playhead is inside it, otherwise the visible clip under the playhead. */
export function planSplit(project: Project, frame: number, selectedClipId: string | null, newId: IdFactory = randomId): Plan {
  let target: { id: string; start: number; end: number } | null = null;
  if (selectedClipId) {
    for (const track of project.tracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId);
      if (clip) target = { id: clip.id, start: clip.timelineStart, end: clipEnd(clip) };
    }
  }
  if (!target || !(frame > target.start && frame < target.end)) {
    const active = activeClipAt(project, frame);
    target = active ? { id: active.clip.id, start: active.clip.timelineStart, end: clipEnd(active.clip) } : null;
  }
  if (!target) return { ok: false, message: "Move the playhead over a clip to split it." };
  if (!(frame > target.start && frame < target.end)) {
    return { ok: false, message: "Move the playhead inside the clip, away from its edges." };
  }
  const clipId = newId("clip");
  return { ok: true, commands: [{ type: "SplitClip", clipId: target.id, frame, newClipId: clipId }], clipId };
}

export function planDelete(project: Project, clipId: string | null): Plan {
  if (!clipId || !project.tracks.some((t) => t.clips.some((c) => c.id === clipId))) {
    return { ok: false, message: "Select a clip first." };
  }
  return { ok: true, commands: [{ type: "RemoveClip", clipId }] };
}
