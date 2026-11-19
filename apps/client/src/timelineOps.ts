import type { Asset, Command, Project } from "@ve/schema";
import { assetDurationInProjectFrames, clipEnd } from "@ve/timeline-core";
import { activeClipAt } from "./playback.js";

export type IdFactory = (prefix: string) => string;

export const randomId: IdFactory = (prefix) => `${prefix}_${crypto.randomUUID()}`;

export type Plan = { ok: true; commands: Command[]; clipId?: string } | { ok: false; message: string };

/** Places media at the playhead on the selected compatible track or a compatible free track. */
export function planAddToTimeline(
  project: Project,
  asset: Asset,
  newId: IdFactory = randomId,
  playheadFrame = 0,
  selectedTrackId?: string | null,
): Plan {
  if (!Number.isSafeInteger(playheadFrame) || playheadFrame < 0) {
    return { ok: false, message: "Move the playhead to a valid timeline position first." };
  }
  const duration = assetDurationInProjectFrames(asset, project.settings.fps);
  const end = playheadFrame + duration;
  if (!Number.isSafeInteger(end)) return { ok: false, message: "The asset extends beyond the supported timeline range." };
  const compatible = (track: Project["tracks"][number]) =>
    asset.kind === "audio" ? track.kind === "audio" : track.kind !== "audio";
  const available = (track: Project["tracks"][number]) =>
    !track.locked && track.clips.every((clip) => end <= clip.timelineStart || playheadFrame >= clipEnd(clip));
  let track = selectedTrackId
    ? project.tracks.find((candidate) => candidate.id === selectedTrackId)
    : project.tracks.filter(compatible).sort((a, b) => a.order - b.order).find(available);
  if (selectedTrackId && !track) return { ok: false, message: "The selected track no longer exists." };
  if (track && !compatible(track)) {
    return { ok: false, message: `This ${asset.kind} asset cannot be placed on the selected ${track.kind} track.` };
  }
  if (track?.locked) return { ok: false, message: "The selected track is locked." };
  const commands: Command[] = [];
  if (!track) {
    const kind = asset.kind === "audio" ? "audio"
      : project.tracks.some((candidate) => candidate.kind !== "audio") ? "overlay" : "video";
    track = {
      id: newId("track"),
      kind,
      order: project.tracks.reduce((max, candidate) => Math.max(max, candidate.order + 1), 0),
      muted: false,
      locked: false,
      clips: [],
    };
    commands.push({ type: "AddTrack", track });
  }
  const clipId = newId("clip");
  commands.push({
    type: "AddClip",
    trackId: track.id,
    ripple: true,
    clip: {
      id: clipId,
      assetId: asset.id,
      timelineStart: playheadFrame,
      sourceIn: 0,
      sourceOut: duration,
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

/** Moves the selected video clip's sound to a free audio track (or a new one) as one undoable step. */
export function planSplitAudio(project: Project, clipId: string | null, newId: IdFactory = randomId): Plan {
  const track = clipId ? project.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId)) : undefined;
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip) return { ok: false, message: "Select a video clip first." };
  const asset = project.assets.find((candidate) => candidate.id === clip.assetId);
  if (track.kind === "audio" || asset?.kind !== "video") return { ok: false, message: "Select a video clip to split its audio." };
  if (!asset.hasAudio) return { ok: false, message: "This video has no sound to split." };
  if (!clip.audioLinked) return { ok: false, message: "This clip's audio is already on an audio track." };
  if (track.locked) return { ok: false, message: "Unlock the clip's track first." };
  const start = clip.timelineStart, end = clipEnd(clip);
  const commands: Command[] = [];
  let target = project.tracks
    .filter((candidate) => candidate.kind === "audio" && !candidate.locked)
    .sort((a, b) => a.order - b.order)
    .find((candidate) => candidate.clips.every((other) => end <= other.timelineStart || start >= clipEnd(other)));
  if (!target) {
    target = {
      id: newId("track"), kind: "audio", muted: false, locked: false, clips: [],
      order: project.tracks.reduce((max, candidate) => Math.max(max, candidate.order + 1), 0),
    };
    commands.push({ type: "AddTrack", track: target });
  }
  const audioClipId = newId("clip");
  commands.push({ type: "SplitAudio", clipId: clip.id, audioClipId, trackId: target.id });
  return { ok: true, commands, clipId: audioClipId };
}

export function planDelete(project: Project, clipId: string | null): Plan {
  if (!clipId || !project.tracks.some((t) => t.clips.some((c) => c.id === clipId))) {
    return { ok: false, message: "Select a clip first." };
  }
  return { ok: true, commands: [{ type: "RemoveClip", clipId }] };
}

export function planRemoveAsset(project: Project, assetId: string): Plan {
  if (!project.assets.some((asset) => asset.id === assetId)) return { ok: false, message: "Asset not found." };
  if (project.tracks.some((track) => track.clips.some((clip) => clip.assetId === assetId))) {
    return { ok: false, message: "Remove the clips that use this asset first." };
  }
  return { ok: true, commands: [{ type: "RemoveAsset", assetId }] };
}

export function planRemoveTrack(project: Project, trackId: string): Plan {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) return { ok: false, message: "Track not found." };
  if (track.locked) return { ok: false, message: "Unlock the track before removing it." };
  if (track.clips.length > 0) return { ok: false, message: "Remove the track's clips first." };
  return { ok: true, commands: [{ type: "RemoveTrack", trackId }] };
}

export function planTrim(project: Project, clipId: string, sourceIn: number, sourceOut: number): Plan {
  if (!project.tracks.some((track) => track.clips.some((clip) => clip.id === clipId))) {
    return { ok: false, message: "Select a clip first." };
  }
  return { ok: true, commands: [{ type: "TrimClip", clipId, sourceIn, sourceOut }] };
}

export function planMove(project: Project, clipId: string, timelineStart: number, trackId?: string): Plan {
  if (!project.tracks.some((track) => track.clips.some((clip) => clip.id === clipId))) {
    return { ok: false, message: "Select a clip first." };
  }
  return { ok: true, commands: [{ type: "MoveClip", clipId, timelineStart, ...(trackId ? { trackId } : {}) }] };
}

export function planSetTrackMuted(project: Project, trackId: string, muted: boolean): Plan {
  if (!project.tracks.some((track) => track.id === trackId)) return { ok: false, message: "Track not found." };
  return { ok: true, commands: [{ type: "SetTrackMuted", trackId, muted }] };
}

export function planAddVisualTrack(project: Project, newId: IdFactory = randomId): Plan {
  const order = project.tracks.reduce((max, track) => Math.max(max, track.order + 1), 0);
  return {
    ok: true,
    commands: [{
      type: "AddTrack",
      track: { id: newId("track"), kind: "overlay", order, muted: false, locked: false, clips: [] },
    }],
  };
}

export function planAddAudioTrack(project: Project, newId: IdFactory = randomId): Plan {
  const order = project.tracks.reduce((max, track) => Math.max(max, track.order + 1), 0);
  return {
    ok: true,
    commands: [{
      type: "AddTrack",
      track: { id: newId("track"), kind: "audio", order, muted: false, locked: false, clips: [] },
    }],
  };
}

export function planReorderVisualTrack(project: Project, trackId: string, direction: -1 | 1): Plan {
  return planReorderTrack(project, trackId, direction, (track) => track.kind !== "audio");
}

export function planReorderAudioTrack(project: Project, trackId: string, direction: -1 | 1): Plan {
  return planReorderTrack(project, trackId, direction, (track) => track.kind === "audio");
}

function planReorderTrack(
  project: Project,
  trackId: string,
  direction: -1 | 1,
  include: (track: Project["tracks"][number]) => boolean,
): Plan {
  const tracks = project.tracks.filter(include).sort((a, b) => a.order - b.order);
  const index = tracks.findIndex((track) => track.id === trackId);
  const other = tracks[index + direction];
  if (index < 0 || !other) return { ok: false, message: "This track is already at that position." };
  return { ok: true, commands: [{ type: "SwapTrackOrder", firstTrackId: trackId, secondTrackId: other.id }] };
}

export type LayerAction = "forward" | "backward" | "front" | "back";

/**
 * Moves a picture in front of (or behind) the pictures it overlaps by moving it to another visual track
 * at the same time. When no free track sits at that spot, a new track is inserted there.
 */
export function planLayerClip(project: Project, clipId: string | null, action: LayerAction, newId: IdFactory = randomId): Plan {
  const visual = project.tracks.filter((track) => track.kind !== "audio").sort((a, b) => a.order - b.order);
  const index = visual.findIndex((track) => track.clips.some((clip) => clip.id === clipId));
  const track = visual[index];
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  if (!track || !clip) return { ok: false, message: "Select a picture on the canvas first." };
  if (track.locked) return { ok: false, message: "Unlock the clip's track first." };
  const start = clip.timelineStart, end = clipEnd(clip);
  const busy = (candidate: Project["tracks"][number]) =>
    candidate.clips.some((other) => other.id !== clip.id && other.timelineStart < end && clipEnd(other) > start);
  const up = action === "forward" || action === "front";
  const covering = visual.flatMap((candidate, position) => (up ? position > index : position < index) && busy(candidate) ? [position] : []);
  if (covering.length === 0) return { ok: false, message: up ? "This picture is already in front." : "This picture is already at the back." };
  const anchor = action === "forward" || action === "back" ? covering[0]! : covering[covering.length - 1]!;
  const neighbor = visual[up ? anchor + 1 : anchor - 1];
  const commands: Command[] = [];
  let destination = neighbor && !neighbor.locked && !busy(neighbor) ? neighbor.id : null;
  if (!destination) {
    destination = newId("track");
    const order = project.tracks.reduce((max, candidate) => Math.max(max, candidate.order + 1), 0);
    commands.push({ type: "AddTrack", track: { id: destination, kind: "overlay", order, muted: false, locked: false, clips: [] } });
    for (let position = visual.length - 1; position >= (up ? anchor + 1 : anchor); position--) {
      commands.push({ type: "SwapTrackOrder", firstTrackId: destination, secondTrackId: visual[position]!.id });
    }
  }
  commands.push({ type: "MoveClip", clipId: clip.id, timelineStart: start, trackId: destination });
  return { ok: true, commands, clipId: clip.id };
}
