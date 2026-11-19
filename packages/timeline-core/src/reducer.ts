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
import { animationDurationError, captionCuesError, CaptionCueSchema, CanvasSizeSchema, ClipCropSchema, ClipSpeedSchema, ClipVolumeSchema, ClipZoomSchema, rescaleAnimation, splitZoom, TrackNameSchema, TransformSchema } from "@ve/schema";

export type CommandResult =
  | { ok: true; project: Project; inverse: Command[] }
  | { ok: false; error: CommandError };

const fail = (code: CommandErrorCode, message: string): CommandResult => ({
  ok: false,
  error: { code, message },
});

export const clipDuration = (clip: Clip): number => Math.max(1, Math.round((clip.sourceOut - clip.sourceIn) / clip.speed));
export const clipEnd = (clip: Clip): number => clip.timelineStart + clipDuration(clip);

/** Finds a whole-source-frame cut whose rounded halves exactly preserve timeline length. */
export function splitSourceFrame(clip: Clip, offset: number): number | undefined {
  const wanted = clip.sourceIn + offset * clip.speed;
  for (const candidate of [Math.round(wanted), Math.floor(wanted), Math.ceil(wanted)]) {
    if (candidate > clip.sourceIn && candidate < clip.sourceOut &&
      clipDuration({ ...clip, sourceOut: candidate }) === offset &&
      clipDuration({ ...clip, sourceIn: candidate }) === clipDuration(clip) - offset) return candidate;
  }
  return undefined;
}

function restoreClips(track: Track, originals: Clip[]): Command[] {
  return [
    ...originals.map((clip) => ({ type: "RemoveClip" as const, clipId: clip.id })),
    ...originals.map((clip) => ({ type: "AddClip" as const, trackId: track.id, clip })),
  ];
}

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
  project.captionCues.forEach((cue) => ids.add(cue.id));
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
  const animationError = animationDurationError(clip.animations, clipDuration(clip));
  if (animationError) return { code: "INVALID_ANIMATION", message: animationError };
  if (!ClipSpeedSchema.safeParse(clip.speed).success || (asset.kind === "image" && clip.speed !== 1)) {
    return { code: "INVALID_SPEED", message: "Use speed 0.25x to 4x on video or audio clips; still images stay at 1x." };
  }
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
  if (asset.kind === "audio") return null;
  if (clip.sourceOut > duration) {
    return { code: "INVALID_RANGE", message: "Clip extends past the end of its source media." };
  }
  return null;
}

/** Relational checks shared by saved-project loading and atomic command batches. */
export function validateProject(project: Project): CommandError | null {
  const ids = new Set<string>();
  const orders = new Set<number>();
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const clips = new Map(project.tracks.flatMap((track) => track.clips.map((clip) => [clip.id, clip] as const)));
  for (const entity of [...project.assets, ...project.tracks, ...project.tracks.flatMap((track) => track.clips), ...project.captionCues]) {
    if (ids.has(entity.id)) return { code: "DUPLICATE_ID", message: `ID ${entity.id} is used more than once.` };
    ids.add(entity.id);
  }
  const captionError = captionCuesError(project.captionCues);
  if (captionError) return { code: "INVALID_CAPTION", message: captionError };
  for (const track of project.tracks) {
    if (orders.has(track.order)) return { code: "DUPLICATE_ORDER", message: `Track order ${track.order} is used more than once.` };
    orders.add(track.order);
    const sorted = [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart);
    for (const [index, clip] of sorted.entries()) {
      const asset = assets.get(clip.assetId);
      if (!asset) return { code: "NOT_FOUND", message: `Clip ${clip.id} refers to missing asset ${clip.assetId}.` };
      if (!assetFitsTrack(asset, track)) return { code: "TRACK_KIND_MISMATCH", message: `Clip ${clip.id} cannot use a ${asset.kind} asset on a ${track.kind} track.` };
      if (clip.transform && (track.kind === "audio" || !TransformSchema.safeParse(clip.transform).success)) return { code: "INVALID_TRANSFORM", message: `Clip ${clip.id} requires a valid visual transform.` };
      if (clip.crop !== undefined && (track.kind === "audio" || !ClipCropSchema.safeParse(clip.crop).success)) {
        return { code: "INVALID_CROP", message: `Clip ${clip.id} requires valid crop insets on a visual track.` };
      }
      if (clip.animations && track.kind === "audio") return { code: "INVALID_ANIMATION", message: "Animations apply only to visual clips." };
      if (clip.zoom && (track.kind === "audio" || !ClipZoomSchema.safeParse(clip.zoom).success)) {
        return { code: "INVALID_ZOOM", message: `Clip ${clip.id} requires a valid zoom on a visual track.` };
      }
      if (clip.volume !== undefined && !ClipVolumeSchema.safeParse(clip.volume).success) {
        return { code: "INVALID_VOLUME", message: `Clip ${clip.id} volume must be 0% to 100%.` };
      }
      const range = validateClipRange(project, asset, clip);
      if (range) return { ...range, message: `Clip ${clip.id}: ${range.message}` };
      if (!Number.isSafeInteger(clipEnd(clip))) return { code: "INVALID_RANGE", message: `Clip ${clip.id} ends outside the supported frame range.` };
      const previous = sorted[index - 1];
      if (previous && clip.timelineStart < clipEnd(previous)) return { code: "OVERLAP", message: `Clips ${previous.id} and ${clip.id} overlap on track ${track.id}.` };
      if (clip.linkedClipId && (clip.linkedClipId === clip.id || !clips.has(clip.linkedClipId))) {
        return { code: "NOT_FOUND", message: `Clip ${clip.id} has an invalid linked clip ${clip.linkedClipId}.` };
      }
    }
  }
  return null;
}

function replaceTrack(project: Project, track: Track): Project {
  return { ...project, tracks: project.tracks.map((t) => (t.id === track.id ? track : t)) };
}

export function applyCommand(project: Project, command: Command): CommandResult {
  switch (command.type) {
    case "AddCaptionCue": {
      if (!CaptionCueSchema.safeParse(command.cue).success) return fail("INVALID_CAPTION", "Caption text or timing is invalid.");
      if (allIds(project).has(command.cue.id)) return fail("DUPLICATE_ID", "That caption cue ID is already in use.");
      const index = command.index ?? project.captionCues.length;
      if (!Number.isSafeInteger(index) || index < 0 || index > project.captionCues.length) return fail("INVALID_CAPTION", "The caption insertion index is invalid.");
      const captionCues = [...project.captionCues];
      captionCues.splice(index, 0, { ...command.cue });
      const error = captionCuesError(captionCues);
      if (error) return fail("INVALID_CAPTION", error);
      return { ok: true, project: { ...project, captionCues }, inverse: [{ type: "RemoveCaptionCue", cueId: command.cue.id }] };
    }
    case "SetCaptionCue": {
      const previous = project.captionCues.find((cue) => cue.id === command.cue.id);
      if (!previous) return fail("NOT_FOUND", "Caption cue not found.");
      if (!CaptionCueSchema.safeParse(command.cue).success) return fail("INVALID_CAPTION", "Caption text or timing is invalid.");
      const captionCues = project.captionCues.map((cue) => cue.id === command.cue.id ? { ...command.cue } : cue);
      const error = captionCuesError(captionCues);
      if (error) return fail("INVALID_CAPTION", error);
      return { ok: true, project: { ...project, captionCues }, inverse: [{ type: "SetCaptionCue", cue: previous }] };
    }
    case "RemoveCaptionCue": {
      const index = project.captionCues.findIndex((cue) => cue.id === command.cueId);
      if (index < 0) return fail("NOT_FOUND", "Caption cue not found.");
      return { ok: true, project: { ...project, captionCues: project.captionCues.filter((cue) => cue.id !== command.cueId) },
        inverse: [{ type: "AddCaptionCue", cue: project.captionCues[index]!, index }] };
    }
    case "SetProjectCanvas": {
      const size = CanvasSizeSchema.safeParse(command);
      if (!size.success) return fail("INVALID_CANVAS_SIZE", "Canvas width and height must be positive whole pixel dimensions.");
      return {
        ok: true,
        project: { ...project, settings: { ...project.settings, ...size.data } },
        inverse: [{ type: "SetProjectCanvas", width: project.settings.width, height: project.settings.height }],
      };
    }

    case "SetProjectFps": {
      if (project.tracks.some((t) => t.clips.length > 0) || project.captionCues.length > 0) {
        return fail("PROJECT_NOT_EMPTY", "The frame rate can only change while the timeline has no clips or caption cues.");
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

    case "SetAssetProxy": {
      const asset = project.assets.find((a) => a.id === command.assetId);
      if (!asset) return fail("NOT_FOUND", "Asset not found.");
      return {
        ok: true,
        project: {
          ...project,
          assets: project.assets.map((a) => (a.id === asset.id ? { ...a, proxyPath: command.proxyPath } : a)),
        },
        inverse: [{ type: "SetAssetProxy", assetId: asset.id, proxyPath: asset.proxyPath }],
      };
    }

    case "RelinkAsset": {
      const asset = project.assets.find((candidate) => candidate.id === command.assetId);
      if (!asset) return fail("NOT_FOUND", "Asset not found.");
      return {
        ok: true,
        project: {
          ...project,
          assets: project.assets.map((candidate) => candidate.id === asset.id
            ? { ...candidate, sourcePath: command.sourcePath, mediaMode: "reference" as const }
            : candidate),
        },
        inverse: [],
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
        inverse: [
          ...(command.track.locked ? [{ type: "SetTrackLocked" as const, trackId: command.track.id, locked: false }] : []),
          { type: "RemoveTrack", trackId: command.track.id },
        ],
      };
    }

    case "RemoveTrack": {
      const track = project.tracks.find((t) => t.id === command.trackId);
      if (!track) return fail("NOT_FOUND", "Track not found.");
      if (track.locked) return fail("TRACK_LOCKED", "Unlock the track before removing it.");
      if (track.clips.length > 0) return fail("TRACK_NOT_EMPTY", "Remove the track's clips first.");
      return {
        ok: true,
        project: { ...project, tracks: project.tracks.filter((t) => t.id !== track.id) },
        inverse: [{ type: "AddTrack", track }],
      };
    }

    case "SetTrackName": {
      const track = project.tracks.find((candidate) => candidate.id === command.trackId);
      if (!track) return fail("NOT_FOUND", "Track not found.");
      const next = { ...track };
      if (command.name === undefined) delete next.name;
      else {
        const parsed = TrackNameSchema.safeParse(command.name);
        if (!parsed.success) return fail("INVALID_TRACK_NAME", "Track names must contain 1-80 characters.");
        next.name = parsed.data;
      }
      return {
        ok: true,
        project: replaceTrack(project, next),
        inverse: [{ type: "SetTrackName", trackId: track.id, ...(track.name === undefined ? {} : { name: track.name }) }],
      };
    }

    case "SetTrackLocked": {
      const track = project.tracks.find((candidate) => candidate.id === command.trackId);
      if (!track) return fail("NOT_FOUND", "Track not found.");
      return {
        ok: true,
        project: replaceTrack(project, { ...track, locked: command.locked }),
        inverse: [{ type: "SetTrackLocked", trackId: track.id, locked: track.locked }],
      };
    }

    case "SetTrackMuted": {
      const track = project.tracks.find((candidate) => candidate.id === command.trackId);
      if (!track) return fail("NOT_FOUND", "Track not found.");
      return {
        ok: true,
        project: replaceTrack(project, { ...track, muted: command.muted }),
        inverse: [{ type: "SetTrackMuted", trackId: track.id, muted: track.muted }],
      };
    }

    case "SwapTrackOrder": {
      if (command.firstTrackId === command.secondTrackId) {
        return fail("INVALID_TRACK_ORDER", "Choose two different tracks to reorder.");
      }
      const first = project.tracks.find((t) => t.id === command.firstTrackId);
      const second = project.tracks.find((t) => t.id === command.secondTrackId);
      if (!first || !second) return fail("NOT_FOUND", "Track not found.");
      if (first.kind === "audio" || second.kind === "audio") {
        return fail("INVALID_TRACK_ORDER", "Only visual tracks can be reordered here.");
      }
      return {
        ok: true,
        project: {
          ...project,
          tracks: project.tracks.map((track) => {
            if (track.id === first.id) return { ...track, order: second.order };
            if (track.id === second.id) return { ...track, order: first.order };
            return track;
          }),
        },
        inverse: [{ type: "SwapTrackOrder", firstTrackId: first.id, secondTrackId: second.id }],
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
      if (clip.transform && (track.kind === "audio" || !TransformSchema.safeParse(clip.transform).success)) {
        return fail("INVALID_TRANSFORM", "Only visual clips can have a valid transform.");
      }
      if (clip.crop !== undefined && (track.kind === "audio" || !ClipCropSchema.safeParse(clip.crop).success)) {
        return fail("INVALID_CROP", "Only visual clips can have valid crop insets.");
      }
      if (clip.animations && track.kind === "audio") return fail("INVALID_ANIMATION", "Animations apply only to visual clips.");
      if (clip.zoom && (track.kind === "audio" || !ClipZoomSchema.safeParse(clip.zoom).success)) {
        return fail("INVALID_ZOOM", "Zoom applies only to visual clips, with the start point before the end point.");
      }
      const rangeError = validateClipRange(project, asset, clip);
      if (rangeError) return { ok: false, error: rangeError };
      if (!Number.isSafeInteger(clipEnd(clip))) {
        return fail("INVALID_RANGE", "Clip ends outside the supported frame range.");
      }
      if (!command.ripple && overlaps(track, clip.timelineStart, clipEnd(clip))) {
        return fail("OVERLAP", "The clip overlaps another clip on this track.");
      }
      const changed = new Map<string, Clip>();
      const shifted: Clip[] = [];
      if (command.ripple) {
        let insertionEnd = clipEnd(clip);
        for (const neighbor of [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)) {
          if (clipEnd(neighbor) <= clip.timelineStart) continue;
          if (neighbor.timelineStart >= insertionEnd) break;
          const adjusted = { ...neighbor, timelineStart: insertionEnd };
          if (!Number.isSafeInteger(clipEnd(adjusted))) {
            return fail("INVALID_RANGE", "Ripple insertion ends outside the supported frame range.");
          }
          changed.set(neighbor.id, adjusted);
          shifted.push(neighbor);
          insertionEnd = clipEnd(adjusted);
        }
      }
      const updated = {
        ...track,
        clips: [...track.clips.map((existing) => changed.get(existing.id) ?? existing), clip]
          .sort((a, b) => a.timelineStart - b.timelineStart),
      };
      return {
        ok: true,
        project: replaceTrack(project, updated),
        inverse: [
          { type: "RemoveClip", clipId: clip.id },
          ...shifted.map((neighbor) => ({ type: "RemoveClip" as const, clipId: neighbor.id })),
          ...shifted.map((neighbor) => ({ type: "AddClip" as const, trackId: track.id, clip: neighbor })),
        ],
      };
    }

    case "SetClipSpeed": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      const asset = project.assets.find((item) => item.id === found.clip.assetId);
      if (!asset) return fail("NOT_FOUND", "Asset not found.");
      const updatedClip = { ...found.clip, speed: command.speed };
      const error = validateClipRange(project, asset, updatedClip);
      if (error) return { ok: false, error };
      const delta = clipDuration(updatedClip) - clipDuration(found.clip);
      const originals = found.track.clips.filter((clip) => clip.id === found.clip.id || clip.timelineStart >= clipEnd(found.clip));
      const changed = new Map(originals.map((clip) => [clip.id, clip.id === found.clip.id
        ? updatedClip : { ...clip, timelineStart: clip.timelineStart + delta }]));
      if ([...changed.values()].some((clip) => !Number.isSafeInteger(clipEnd(clip)) || clip.timelineStart < 0)) {
        return fail("INVALID_RANGE", "Speed change ends outside the supported frame range.");
      }
      return {
        ok: true,
        project: replaceTrack(project, { ...found.track, clips: found.track.clips.map((clip) => changed.get(clip.id) ?? clip) }),
        inverse: restoreClips(found.track, originals),
      };
    }

    case "SetClipAnimations": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      if (found.track.kind === "audio") return fail("INVALID_ANIMATION", "Animations apply only to visual clips.");
      const error = animationDurationError(command.animations, clipDuration(found.clip));
      if (error) return fail("INVALID_ANIMATION", error);
      const { animations: previous, ...clip } = found.clip;
      const updated = command.animations && (command.animations.entrance || command.animations.exit)
        ? { ...clip, animations: command.animations } : clip;
      return {
        ok: true,
        project: replaceTrack(project, { ...found.track, clips: found.track.clips.map((item) => item.id === clip.id ? updated : item) }),
        inverse: [{ type: "SetClipAnimations", clipId: clip.id, ...(previous ? { animations: previous } : {}) }],
      };
    }

    case "SetClipCrop": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      if (found.track.kind === "audio" || (command.crop !== undefined && !ClipCropSchema.safeParse(command.crop).success)) {
        return fail("INVALID_CROP", "Crop applies only to visual clips, with insets from 0% to 90% and more than 5% of each source dimension remaining.");
      }
      const { crop: previous, ...clip } = found.clip;
      const updated = command.crop !== undefined ? { ...clip, crop: command.crop } : clip;
      return {
        ok: true,
        project: replaceTrack(project, { ...found.track, clips: found.track.clips.map((item) => item.id === clip.id ? updated : item) }),
        inverse: [{ type: "SetClipCrop", clipId: clip.id, ...(previous !== undefined ? { crop: previous } : {}) }],
      };
    }

    case "SetClipZoom": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      if (found.track.kind === "audio" || (command.zoom && !ClipZoomSchema.safeParse(command.zoom).success)) {
        return fail("INVALID_ZOOM", "Zoom applies only to visual clips, with the start point before the end point and scales from 25% to 400%.");
      }
      const { zoom: previous, ...clip } = found.clip;
      const updated = command.zoom ? { ...clip, zoom: command.zoom } : clip;
      return {
        ok: true,
        project: replaceTrack(project, { ...found.track, clips: found.track.clips.map((item) => item.id === clip.id ? updated : item) }),
        inverse: [{ type: "SetClipZoom", clipId: clip.id, ...(previous ? { zoom: previous } : {}) }],
      };
    }

    case "SetClipVolume": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      if (command.volume !== undefined && !ClipVolumeSchema.safeParse(command.volume).success) {
        return fail("INVALID_VOLUME", "Clip volume must be 0% to 100%.");
      }
      const { volume: previous, ...clip } = found.clip;
      // 100% is stored as no volume so untouched and reset clips stay identical.
      const updated = command.volume !== undefined && command.volume !== 1 ? { ...clip, volume: command.volume } : clip;
      return {
        ok: true,
        project: replaceTrack(project, { ...found.track, clips: found.track.clips.map((item) => item.id === clip.id ? updated : item) }),
        inverse: [{ type: "SetClipVolume", clipId: clip.id, ...(previous !== undefined ? { volume: previous } : {}) }],
      };
    }

    case "SplitAudio": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      const target = project.tracks.find((track) => track.id === command.trackId);
      if (!target) return fail("NOT_FOUND", "Track not found.");
      if (found.track.locked || target.locked) return fail("TRACK_LOCKED", "The track is locked.");
      const asset = project.assets.find((item) => item.id === found.clip.assetId);
      if (!asset) return fail("NOT_FOUND", "Asset not found.");
      if (found.track.kind === "audio" || target.kind !== "audio" || asset.kind !== "video" || !asset.hasAudio || !found.clip.audioLinked) {
        return fail("INVALID_AUDIO_SPLIT", "Only a video clip that still plays its own sound can split it onto an audio track.");
      }
      if (allIds(project).has(command.audioClipId)) return fail("DUPLICATE_ID", `ID ${command.audioClipId} is already in use.`);
      const { clip } = found;
      if (overlaps(target, clip.timelineStart, clipEnd(clip))) {
        return fail("OVERLAP", "The audio track already has a clip at this time.");
      }
      const audio: Clip = {
        id: command.audioClipId, assetId: clip.assetId, timelineStart: clip.timelineStart,
        sourceIn: clip.sourceIn, sourceOut: clip.sourceOut, speed: clip.speed, audioLinked: true,
        ...(clip.volume !== undefined ? { volume: clip.volume } : {}),
      };
      const next = replaceTrack(project, { ...found.track, clips: found.track.clips.map((item) => item.id === clip.id ? { ...clip, audioLinked: false } : item) });
      const updatedTarget = next.tracks.find((track) => track.id === target.id)!;
      return {
        ok: true,
        project: replaceTrack(next, { ...updatedTarget, clips: [...updatedTarget.clips, audio].sort((a, b) => a.timelineStart - b.timelineStart) }),
        inverse: [{ type: "RemoveClip", clipId: audio.id }, ...restoreClips(found.track, [clip])],
      };
    }

    case "SetClipTransform": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      if (found.track.kind === "audio" || (command.transform && !TransformSchema.safeParse(command.transform).success)) {
        return fail("INVALID_TRANSFORM", "Choose a visual clip and a valid position, scale and opacity.");
      }
      const { transform: previous, ...clip } = found.clip;
      const updated = command.transform ? { ...clip, transform: command.transform } : clip;
      return {
        ok: true,
        project: replaceTrack(project, { ...found.track, clips: found.track.clips.map((item) => item.id === clip.id ? updated : item) }),
        inverse: [{ type: "SetClipTransform", clipId: clip.id, ...(previous ? { transform: previous } : {}) }],
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

    case "MoveClip": {
      const found = findClip(project, command.clipId);
      if (!found) return fail("NOT_FOUND", "Clip not found.");
      if (found.track.locked) return fail("TRACK_LOCKED", "The track is locked.");
      const targetTrack = command.trackId
        ? project.tracks.find((candidate) => candidate.id === command.trackId)
        : found.track;
      if (!targetTrack) return fail("NOT_FOUND", "Destination track not found.");
      if (targetTrack.locked) return fail("TRACK_LOCKED", "The destination track is locked.");
      if ((targetTrack.kind === "audio") !== (found.track.kind === "audio")) {
        return fail("TRACK_KIND_MISMATCH", "Clips can only move between tracks of the same kind.");
      }
      const moved = { ...found.clip, timelineStart: command.timelineStart };
      if (!Number.isSafeInteger(clipEnd(moved))) {
        return fail("INVALID_RANGE", "Clip ends outside the supported frame range.");
      }
      if (targetTrack.id !== found.track.id) {
        const asset = project.assets.find((candidate) => candidate.id === moved.assetId);
        if (!asset) return fail("NOT_FOUND", "Asset not found.");
        if (!assetFitsTrack(asset, targetTrack)) {
          return fail("TRACK_KIND_MISMATCH", `A ${asset.kind} asset cannot be placed on a ${targetTrack.kind} track.`);
        }
        const rangeError = validateClipRange(project, asset, moved);
        if (rangeError) return { ok: false, error: rangeError };
        if (targetTrack.kind === "audio" && overlaps(targetTrack, moved.timelineStart, clipEnd(moved))) {
          return fail("OVERLAP", "The moved audio clip would overlap another clip on the destination track.");
        }
        const source = {
          ...found.track,
          clips: found.track.clips.filter((clip) => clip.id !== found.clip.id),
        };
        const destination = {
          ...targetTrack,
          clips: [...targetTrack.clips, moved].sort((a, b) => a.timelineStart - b.timelineStart),
        };
        return {
          ok: true,
          project: {
            ...project,
            tracks: project.tracks.map((track) =>
              track.id === source.id ? source : track.id === destination.id ? destination : track),
          },
          inverse: [{
            type: "MoveClip",
            clipId: found.clip.id,
            timelineStart: found.clip.timelineStart,
            trackId: found.track.id,
          }],
        };
      }
      const changed = new Map<string, Clip>([[moved.id, moved]]);
      const shifted: Clip[] = [];
      const headTrimmed: Clip[] = [];
      let extendedEnd = clipEnd(moved);
      const following = [...found.track.clips]
        .filter((candidate) => candidate.id !== found.clip.id && candidate.timelineStart >= moved.timelineStart)
        .sort((a, b) => a.timelineStart - b.timelineStart);
      for (const neighbor of following) {
        if (clipEnd(neighbor) <= moved.timelineStart) continue;
        if (neighbor.timelineStart >= extendedEnd) break;
        const overlapFrames = extendedEnd - neighbor.timelineStart;
        const sourceCut = splitSourceFrame(neighbor, overlapFrames);
        if (sourceCut !== undefined) {
          const adjusted = {
            ...neighbor,
            sourceIn: sourceCut,
            timelineStart: neighbor.timelineStart + overlapFrames,
          };
          const neighborAsset = project.assets.find((candidate) => candidate.id === neighbor.assetId);
          if (!neighborAsset) return fail("NOT_FOUND", "Asset not found.");
          const rangeError = validateClipRange(project, neighborAsset, adjusted);
          if (rangeError) return { ok: false, error: rangeError };
          changed.set(neighbor.id, adjusted);
          headTrimmed.push(neighbor);
          break;
        }
        const adjusted = { ...neighbor, timelineStart: extendedEnd };
        if (!Number.isSafeInteger(clipEnd(adjusted))) {
          return fail("INVALID_RANGE", "Ripple move ends outside the supported frame range.");
        }
        changed.set(neighbor.id, adjusted);
        shifted.push(neighbor);
        extendedEnd = clipEnd(adjusted);
      }
      const adjustedTrack = { ...found.track, clips: found.track.clips.map((clip) => changed.get(clip.id) ?? clip) };
      if (overlaps(adjustedTrack, moved.timelineStart, clipEnd(moved), moved.id)) {
        return fail("OVERLAP", "The moved clip would overlap another clip on this track.");
      }
      const updated = {
        ...found.track,
        clips: found.track.clips.map((clip) => changed.get(clip.id) ?? clip).sort((a, b) => a.timelineStart - b.timelineStart),
      };
      const inverse: Command[] = [
        { type: "MoveClip", clipId: found.clip.id, timelineStart: found.clip.timelineStart },
        ...shifted.map((neighbor) => ({ type: "MoveClip" as const, clipId: neighbor.id, timelineStart: neighbor.timelineStart })),
        ...headTrimmed.map((neighbor) => ({
          type: "TrimClip" as const, clipId: neighbor.id, sourceIn: neighbor.sourceIn, sourceOut: neighbor.sourceOut,
        })),
      ];
      return {
        ok: true,
        project: replaceTrack(project, updated),
        inverse: [found.clip, ...shifted, ...headTrimmed].some((clip) => clip.speed !== 1 || clip.animations)
          ? restoreClips(found.track, [found.clip, ...shifted, ...headTrimmed]) : inverse,
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
        timelineStart: clip.timelineStart + clipDuration(clip) - clipDuration({ ...clip, sourceIn }),
      };
      const asset = project.assets.find((a) => a.id === clip.assetId);
      if (!asset) return fail("NOT_FOUND", "Asset not found.");
      const rangeError = validateClipRange(project, asset, trimmed);
      if (rangeError) return { ok: false, error: rangeError };
      const nextEnd = clipEnd(trimmed);
      if (!Number.isSafeInteger(nextEnd)) {
        return fail("INVALID_RANGE", "Clip ends outside the supported frame range.");
      }
      if (trimmed.timelineStart < clip.timelineStart && overlaps(track, trimmed.timelineStart, nextEnd, clip.id)) {
        return fail("OVERLAP", "The trimmed clip would overlap another clip.");
      }
      const changed = new Map<string, Clip>([[clip.id, trimmed]]);
      const moved: Clip[] = [];
      const headTrimmed: Clip[] = [];
      let extendedEnd = nextEnd;
      if (nextEnd > clipEnd(clip)) {
        const following = [...track.clips]
          .filter((candidate) => candidate.id !== clip.id && candidate.timelineStart >= clipEnd(clip))
          .sort((a, b) => a.timelineStart - b.timelineStart);
        for (const neighbor of following) {
          if (neighbor.timelineStart >= extendedEnd) break;
          const overlapFrames = extendedEnd - neighbor.timelineStart;
          const sourceCut = splitSourceFrame(neighbor, overlapFrames);
          if (sourceCut !== undefined) {
            const adjusted = {
              ...neighbor,
              sourceIn: sourceCut,
              timelineStart: neighbor.timelineStart + overlapFrames,
            };
            const neighborAsset = project.assets.find((candidate) => candidate.id === neighbor.assetId);
            if (!neighborAsset) return fail("NOT_FOUND", "Asset not found.");
            const neighborRangeError = validateClipRange(project, neighborAsset, adjusted);
            if (neighborRangeError) return { ok: false, error: neighborRangeError };
            changed.set(neighbor.id, adjusted);
            headTrimmed.push(neighbor);
            break;
          }

          const adjusted = { ...neighbor, timelineStart: extendedEnd };
          if (!Number.isSafeInteger(clipEnd(adjusted))) {
            return fail("INVALID_RANGE", "Ripple move ends outside the supported frame range.");
          }
          changed.set(neighbor.id, adjusted);
          moved.push(neighbor);
          extendedEnd = clipEnd(adjusted);
        }
      }
      if (overlaps({ ...track, clips: track.clips.map((candidate) => changed.get(candidate.id) ?? candidate) },
        trimmed.timelineStart, clipEnd(trimmed), clip.id)) {
        return fail("OVERLAP", "The trimmed clip would overlap another clip.");
      }
      const updated = {
        ...track,
        clips: track.clips.map((candidate) => changed.get(candidate.id) ?? candidate).sort((a, b) => a.timelineStart - b.timelineStart),
      };
      const inverse: Command[] = [
        { type: "TrimClip", clipId: clip.id, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut },
        ...moved.map((neighbor) => ({ type: "MoveClip" as const, clipId: neighbor.id, timelineStart: neighbor.timelineStart })),
        ...headTrimmed.map((neighbor) => ({
          type: "TrimClip" as const, clipId: neighbor.id, sourceIn: neighbor.sourceIn, sourceOut: neighbor.sourceOut,
        })),
      ];
      return {
        ok: true,
        project: replaceTrack(project, updated),
        inverse: [clip, ...moved, ...headTrimmed].some((item) => item.speed !== 1 || item.animations)
          ? restoreClips(track, [clip, ...moved, ...headTrimmed]) : inverse,
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
      const sourceCut = splitSourceFrame(clip, offset);
      if (sourceCut === undefined) {
        return fail("INVALID_FRAME", "This split falls between source frames at the clip's speed. Move the playhead to a nearby frame and retry.");
      }
      const left: Clip = { ...clip, sourceOut: sourceCut };
      const right: Clip = {
        ...clip,
        id: command.newClipId,
        timelineStart: command.frame,
        sourceIn: sourceCut,
      };
      if (clip.animations) {
        delete left.animations;
        delete right.animations;
        if (clip.animations.entrance) {
          left.animations = { entrance: rescaleAnimation(clip.animations.entrance, clipDuration(clip), clipDuration(left)) };
        }
        if (clip.animations.exit) {
          right.animations = { exit: rescaleAnimation(clip.animations.exit, clipDuration(clip), clipDuration(right)) };
        }
        for (const half of [left, right]) {
          const error = animationDurationError(half.animations, clipDuration(half));
          if (error) return fail("INVALID_ANIMATION", error);
        }
      }
      if (clip.zoom) {
        delete left.zoom;
        delete right.zoom;
        const [leftZoom, rightZoom] = splitZoom(clip.zoom, clipDuration(clip), offset);
        if (leftZoom) left.zoom = leftZoom;
        if (rightZoom) right.zoom = rightZoom;
      }
      delete right.linkedClipId;
      const updated = {
        ...track,
        clips: track.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])),
      };
      return {
        ok: true,
        project: replaceTrack(project, updated),
        // Order matters: remove the new clip first so restoring the length cannot overlap it.
        inverse: clip.animations || clip.zoom ? [
          { type: "RemoveClip", clipId: right.id },
          ...restoreClips(track, [clip]),
        ] : [
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
  const initialError = validateProject(project);
  if (initialError) return { ok: false, error: initialError };
  let current = project;
  const inverse: Command[] = [];
  for (const command of commands) {
    const result = applyCommand(current, command);
    if (!result.ok) return result;
    current = result.project;
    inverse.unshift(...result.inverse);
  }
  const error = validateProject(current);
  return error ? { ok: false, error } : { ok: true, project: current, inverse };
}
