import type {
  Asset,
  Clip,
  Command,
  CommandError,
  CommandErrorCode,
  Project,
  Track,
} from "@ve/schema";
import { assetDurationInProjectFrames } from "./time.js";

export type CommandResult =
  | { ok: true; project: Project; inverse: Command[] }
  | { ok: false; error: CommandError };

const fail = (code: CommandErrorCode, message: string): CommandResult => ({
  ok: false,
  error: { code, message },
});

export const clipDuration = (clip: Clip): number => clip.sourceOut - clip.sourceIn;
export const clipEnd = (clip: Clip): number => clip.timelineStart + clipDuration(clip);

export function findClip(
  project: Project,
  clipId: string,
): { track: Track; clip: Clip } | undefined {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

function allIds(project: Project): Set<string> {
  const ids = new Set<string>();
  project.assets.forEach((a) => ids.add(a.id));
  project.tracks.forEach((t) => {
    ids.add(t.id);
    t.clips.forEach((c) => ids.add(c.id));
  });
  return ids;
}

function assetFitsTrack(asset: Asset, track: Track): boolean {
  if (track.kind === "audio") {
    return asset.kind === "audio" || (asset.kind === "video" && asset.hasAudio);
  }
  return asset.kind === "video" || asset.kind === "image";
}

function overlaps(track: Track, start: number, end: number, ignoreClipId?: string): boolean {
  return track.clips.some((c) => c.id !== ignoreClipId && start < clipEnd(c) && c.timelineStart < end);
}

function validateClipRange(project: Project, asset: Asset, clip: Clip): CommandError | null {
  if (clip.timelineStart < 0) {
    return { code: "INVALID_RANGE", message: "Clip cannot start before the timeline start." };
  }
  if (!(clip.sourceIn < clip.sourceOut)) {
    return { code: "INVALID_RANGE", message: "Clip must have a positive length." };
  }
  if (asset.kind === "image") {
    // Images have no inherent length, so only the lower bound applies.
    return null;
  }
  const duration = assetDurationInProjectFrames(asset, project.settings.fps);
  if (clip.sourceOut > duration) {
    return { code: "INVALID_RANGE", message: "Clip extends past the end of its source media." };
  }
  return null;
}

function replaceTrack(project: Project, track: Track): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === track.id ? track : t)) };
}

export function applyCommand(project: Project, command: Command): CommandResult {
  switch (command.type) {
    case "SetProjectFps": {
      if (project.tracks.some((t) => t.clips.length > 0)) {
        return fail("PROJECT_NOT_EMPTY", "The frame rate can only change while the timeline has no clips.");
      }
      return {
        ok: true,
        project: { ...project, settings: { ...project.settings, fps: command.fps } },
        inverse: [{ type: "SetProjectFps", fps: project.settings.fps }],
      };
    }
    case "AddAsset": {
      if (allIds(project).has(command.asset.id)) {
        return fail("DUPLICATE_ID", `ID ${command.asset.id} is already in use.`);
      }
      return {
        ok: true,
        project: { ...project, assets: [...project.assets, command.asset] },
        inverse: [{ type: "RemoveAsset", assetId: command.asset.id }],
      };
    }

    case "RemoveAsset": {
      const asset = project.assets.find((a) => a.id === command.assetId);
      if (!asset) return fail("NOT_FOUND", "Asset not found.");
      const inUse = project.tracks.some((t) => t.clips.some((c) => c.assetId === asset.id));
      if (inUse) return fail("ASSET_IN_USE", "Remove the clips that use this asset first.");
      return {
        ok: true,
        project: { ...project, assets: project.assets.filter((a) => a.id !== asset.id) },
        inverse: [{ type: "AddAsset", asset }],
      };
    }

    case "AddTrack": {
      if (allIds(project).has(command.track.id)) {
        return fail("DUPLICATE_ID", `ID ${command.track.id} is already in use.`);
      }
      if (command.track.clips.length > 0) {
        return fail("INVALID_RANGE", "Tracks must be added empty; add clips with AddClip.");
      }
      if (project.tracks.some((t) => t.order === command.track.order)) {
        return fail("DUPLICATE_ORDER", `Track order ${command.track.order} is already in use.`);
      }
      return {
        ok: true,
        project: { ...project, tracks: [...project.tracks, command.track] },
        inverse: [{ type: "RemoveTrack", trackId: command.track.id }],
      };
    }

    case "RemoveTrack": {
      const track = project.tracks.find((t) => t.id === command.trackId);
      if (!track) return fail("NOT_FOUND", "Track not found.");
      if (track.clips.length > 0) return fail("TRACK_NOT_EMPTY", "Remove the track's clips first.");
      return {
        ok: true,
        project: { ...project, tracks: project.tracks.filter((t) => t.id !== track.id) },
        inverse: [{ type: "AddTrack", track }],
      };
    }

    case "AddClip": {
      const track = project.tracks.find((t) => t.id === command.trackId);
      if (!track) return fail("NOT_FOUND", "Track not found.");
      if (track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      const { clip } = command;
      if (allIds(project).has(clip.id)) return fail("DUPLICATE_ID", `ID ${clip.id} is already in use.`);
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset) return fail("NOT_FOUND", "Asset not found.");
      if (!assetFitsTrack(asset, track)) {
        return fail("TRACK_KIND_MISMATCH", `A ${asset.kind} asset cannot be placed on a ${track.kind} track.`);
      }
      if (clip.transform && track.kind !== "overlay") {
        return fail("INVALID_TRANSFORM", "Only overlay clips can have a transform.");
      }
      const rangeError = validateClipRange(project, asset, clip);
      if (rangeError) return { ok: false, error: rangeError };
      if (overlaps(track, clip.timelineStart, clipEnd(clip))) {
        return fail("OVERLAP", "The clip overlaps another clip on this track.");
      }
      const updated = { ...track, clips: [...track.clips, clip].sort((a, b) => a.timelineStart - b.timelineStart) };
      return {
        ok: true,
        project: replaceTrack(project, updated),
        inverse: [{ type: "RemoveClip", clipId: clip.id }],
      };
    }

    case "RemoveClip": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      const updated = { ...found.track, clips: found.track.clips.filter((c) => c.id !== found.clip.id) };
      return {
        ok: true,
        project: replaceTrack(project, updated),
        inverse: [{ type: "AddClip", trackId: found.track.id, clip: found.clip }],
      };
    }

    case "TrimClip": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      const { clip, track } = found;
      const sourceIn = command.sourceIn ?? clip.sourceIn;
      const sourceOut = command.sourceOut ?? clip.sourceOut;
      // Trimming the head keeps the right edge in place on the timeline.
      const trimmed: Clip = {
        ...clip,
        sourceIn,
        sourceOut,
        timelineStart: clip.timelineStart + (sourceIn - clip.sourceIn),
      };
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset) return fail("NOT_FOUND", "Asset not found.");
      const rangeError = validateClipRange(project, asset, trimmed);
      if (rangeError) return { ok: false, error: rangeError };
      if (overlaps(track, trimmed.timelineStart, clipEnd(trimmed), clip.id)) {
        return fail("OVERLAP", "The trimmed clip would overlap another clip.");
      }
      const updated = { ...track, clips: track.clips.map((c) => (c.id === clip.id ? trimmed : c)) };
      return {
        ok: true,
        project: replaceTrack(project, updated),
        inverse: [
          { type: "TrimClip", clipId: clip.id, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut },
        ],
      };
    }

    case "SplitClip": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      const { clip, track } = found;
      if (allIds(project).has(command.newClipId)) {
        return fail("DUPLICATE_ID", `ID ${command.newClipId} is already in use.`);
      }
      if (!(command.frame > clip.timelineStart && command.frame < clipEnd(clip))) {
        return fail("INVALID_FRAME", "The split point must be inside the clip.");
      }
      const offset = command.frame - clip.timelineStart;
      const left: Clip = { ...clip, sourceOut: clip.sourceIn + offset };
      const right: Clip = {
        ...clip,
        id: command.newClipId,
        timelineStart: command.frame,
        sourceIn: clip.sourceIn + offset,
      };
      delete right.linkedClipId;
      const updated = {
        ...track,
        clips: track.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])),
      };
      return {
        ok: true,
        project: replaceTrack(project, updated),
        // Order matters: remove the new clip first so restoring the length cannot overlap it.
        inverse: [
          { type: "RemoveClip", clipId: right.id },
          { type: "TrimClip", clipId: clip.id, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut },
        ],
      };
    }
  }
}

/** Applies commands in order, stopping at the first error. Returns the combined inverse (already reversed for undo). */
export function applyCommands(
  project: Project,
  commands: Command[],
): CommandResult {
  let current = project;
  const inverse: Command[] = [];
  for (const command of commands) {
    const result = applyCommand(current, command);
    if (!result.ok) return result;
    current = result.project;
    inverse.unshift(...result.inverse);
  }
  return { ok: true, project: current, inverse };
}
