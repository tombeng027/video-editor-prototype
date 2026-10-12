# 3. Data Model and Time Rules

[Back to index](./README.md)

**Status:** current version-1 field shapes and target semantics. Saved-project loading/saving and atomic command batches share relational validation (K23, verified locally). Split audio, candidate persistence, overlay transforms/compositing and migrations are not implemented end-to-end. See [Review status](./16-review-plan-and-system-status.md).

## Time rules

- All timeline and source positions are stored as **integer frames** at the project frame rate.
- The project frame rate is a **rational** (`{ num, den }`, for example 30000/1001).
- Seconds and `mm:ss` are display/input formats only and are converted at the boundary (UI input, AI action, export).
- Clip fields (`timelineStart`, `sourceIn`, `sourceOut`) are all in **project frames**. `Asset.durationFrames` is in the asset's **native frames**, and is converted to project frames (one shared rounding helper in `timeline-core`) whenever it is compared with clip ranges.
- Variable-frame-rate sources are normalised to constant frame rate in their proxy. Export decodes the original and uses exact timestamps converted from project frames.
- Automatic frame-rate adoption occurs when the opted-in project receives its first video while the timeline is empty; audio-only assets do not consume this option. The importer plans this inside the authoritative commit queue. `SetProjectFps` still permits changes while there are no clips.
- Clips on the same track must not overlap (prototype rule).

## Entities

```ts
type Rational = { num: number; den: number };

type Project = {
  schemaVersion: 1;
  id: string;
  name: string;
  settings: { fps: Rational; width: number; height: number; fpsFromFirstImport: boolean };
  assets: Asset[];
  tracks: Track[];
  createdAt: string;
  updatedAt: string;
};

type Asset = {
  id: string;
  kind: "video" | "audio" | "image";
  name: string;
  mediaMode: "reference" | "copy";
  sourcePath: string;        // absolute path (reference) or project-relative (copy)
  contentHash: string;       // used for relinking
  durationFrames: number;    // native frames; for images, the default clip length in project frames
  fps: Rational | null;      // null for images; audio uses a 1000/1 (millisecond) timebase
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  proxyPath: string | null;
};

// Candidates are NOT part of project.assets. They live in candidates/ until inserted.
type Candidate = {
  id: string;
  sourceAssetId: string;
  edit: EditList;
  createdAt: string;
};

type Track = {
  id: string;
  kind: "video" | "overlay" | "audio";
  order: number;
  muted: boolean;
  locked: boolean;
  clips: Clip[];
};

type Clip = {
  id: string;
  assetId: string;
  timelineStart: number;     // frames
  sourceIn: number;          // frames, inclusive
  sourceOut: number;         // frames, exclusive
  speed: 1;                  // fixed in prototype
  audioLinked: boolean;      // video clip's audio stays linked; false after "split audio"
  linkedClipId?: string;     // audio clip created by "split audio"
  // overlay tracks only, static per clip. x/y are the clip centre as a fraction of the
  // project frame (0.5, 0.5 = centred), scale is a multiplier of the asset's fitted size,
  // opacity is 0..1. Normalised so it is independent of project resolution.
  transform?: { x: number; y: number; scale: number; opacity: number };
};

type EditList = {
  sourceAssetId: string;
  segments: { sourceIn: number; sourceOut: number; confidence: number }[]; // project frames
};
```

## Derived values

- Clip duration = `sourceOut - sourceIn` (speed is 1).
- Timeline end = max over clips of `timelineStart + duration`.
- Candidate duration = sum of its segment lengths. Candidates are previewed from the edit list and become timeline clips (pointing at the real source asset) only when inserted. They never appear in `project.assets`, so undoing an insert cannot leave a dangling asset.

## Invariants (shared load/save and atomic-batch validation)

- Video and audio clips: `0 <= sourceIn < sourceOut <= asset.durationFrames` (converted to project frames).
- Image clips: `sourceIn >= 0` and any positive length (images have no inherent duration), so they can be trimmed from either edge.
- Track `order` values are unique.
- The project frame rate can only change (`SetProjectFps`) while the timeline has no clips. When adoption conditions above hold, the engine importer issues `SetProjectFps` in the same command batch as the import. Undo history is planned for M3.
- An audio-track clip may reference a video asset that has audio (the result of "Split audio").
- No overlapping clips within a track.
- `timelineStart >= 0`.
- Clip kind is compatible with its track kind (audio clips on audio tracks, and so on).
- `transform` is only valid on clips in overlay tracks.
- IDs are unique within the project.
- Clip end positions must fit the supported safe-integer frame range.
- Optional `linkedClipId` must refer to another existing clip, not itself. Reciprocal/audio-link editing behavior remains a future feature; presence is not proof of implemented split audio.
- Valid locked tracks and unsorted saved clip arrays are accepted; validation sorts a copy for overlap checks. Missing original media does not invalidate the project structure and is reported separately as offline.

## Frame rate and clip audio

- The project frame rate is set at project creation. The create dialog offers a preset list, plus "use the frame rate of the first imported video" as an option that sets it on first import.
- **Current:** preview/export use the visible video's source audio; split/delete operate on its source range. Move/trim UI and independent audio behavior remain planned.
- **Planned:** "Split audio" would create a separate audio clip on an audio track covering the same source range and set `audioLinked: false` on the video clip as a single undo step. No such command or end-to-end audio-track rendering exists yet.

## Overlay behavior

- **Current:** preview/export select the highest-order non-audio clip; they do not composite tracks.
- **Planned:** overlay clips' optional static `transform` (position x/y, scale, opacity) would be applied consistently in preview and export. The schema field exists, but CSS transform rendering and FFmpeg overlay compositing are not implemented.
- Rotation, crop, blend modes and keyframed transforms are future upgrades.

## Versioning

`schemaVersion` is stored in `project.json`; currently only version 1 is accepted. A future migration pipeline will apply version N to N+1 functions on open before the first saved-schema change (K10).
