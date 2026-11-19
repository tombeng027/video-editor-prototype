# 3. Data Model and Time Rules

[Back to index](./README.md)

**Status:** current version-2 field shapes and target semantics, with explicit version-1 loading migration. Saved-project loading/saving and atomic command batches share relational validation (K23, verified locally). Caption cue storage/commands, manual workspace and Preview subtitles are implemented locally; subtitle export and generation remain planned. See [Review status](./16-review-plan-and-system-status.md).

## Time rules

- All timeline and source positions are stored as **integer frames** at the project frame rate.
- The project frame rate is a **rational** (`{ num, den }`, for example 30000/1001).
- Seconds and `mm:ss` are display/input formats only and are converted at the boundary (UI input, AI action, export).
- Clip fields (`timelineStart`, `sourceIn`, `sourceOut`) are all in **project frames**. `Asset.durationFrames` is in the asset's **native frames**, and is converted to project frames (one shared rounding helper in `timeline-core`) whenever it is compared with clip ranges.
- Variable-frame-rate sources are normalised to constant frame rate in their proxy. Export decodes the original and uses exact timestamps converted from project frames.
- Automatic frame-rate adoption occurs when the opted-in project receives its first video while there are no media clips or caption cues; audio-only assets do not consume this option. The importer plans this inside the authoritative commit queue. `SetProjectFps` also requires no media clips or caption cues, preventing caption timing from being reinterpreted.
- Clips on the same track must not overlap. Audio clips can extend beyond the source duration; playback/export loop the source to fill the extended range.

## Entities

```ts
type Rational = { num: number; den: number };

type Project = {
  schemaVersion: 2;
  id: string;
  name: string;
  settings: { fps: Rational; width: number; height: number; fpsFromFirstImport: boolean };
  assets: Asset[];
  tracks: Track[];
  captionCues: CaptionCue[]; // one independent, timeline-fixed caption lane
  createdAt: string;
  updatedAt: string;
};

type CaptionCue = {
  id: string;                // unique across assets, media tracks/clips and cues
  start: number;             // safe nonnegative integer project frame
  end: number;               // safe integer, exclusive, greater than start
  text: string;              // nonblank plain text, at most 2000 characters
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
  name?: string;            // optional trimmed label, 1-80 characters; absent uses the default UI label
  kind: "video" | "overlay" | "audio";
  order: number;
  muted: boolean;
  locked: boolean;
  clips: Clip[];
};

type EntranceAnimationId = "entrance.fade" | "entrance.zoom" | "entrance.slide-left" | "entrance.slide-right" | "entrance.rise";
type ExitAnimationId = "exit.fade" | "exit.zoom" | "exit.slide-left" | "exit.slide-right" | "exit.drop";

type Clip = {
  id: string;
  assetId: string;
  timelineStart: number;     // frames
  sourceIn: number;          // frames, inclusive
  sourceOut: number;         // frames, exclusive
  speed: number;             // 0.25..4 forward playback; still images remain 1
  audioLinked: boolean;      // video clip's audio stays linked; false after "split audio"
  linkedClipId?: string;     // audio clip created by "split audio"
  // visual tracks only, static per clip. x/y are the clip centre as a fraction of the
  // project frame (0.5, 0.5 = centred), scale is a multiplier of the asset's fitted size,
  // opacity is 0..1. Normalised so it is independent of project resolution.
  transform?: { x: number; y: number; scale: number; opacity: number };
  // Visual only; stable catalog IDs and behavior version. New edits save durationPercent (0 < p <= 100,
  // entrance + exit <= 100); durationFrames (>= 2) is the earlier fixed-length form, still accepted.
  animations?: {
    entrance?: { id: EntranceAnimationId; version: 1 } & ({ durationPercent: number } | { durationFrames: number });
    exit?: { id: ExitAnimationId; version: 1 } & ({ durationPercent: number } | { durationFrames: number });
  };
  // Visual only; two-point zoom. Points are % of the clip duration (start < end; split halves may fall
  // outside 0..100). Scales 0.25..4 multiply transform.scale around its center; smoothstep between points.
  zoom?: { version: 1; startPercent: number; endPercent: number; startScale: number; endScale: number };
};

type EditList = {
  sourceAssetId: string;
  segments: { sourceIn: number; sourceOut: number; confidence: number }[]; // project frames
};
```

## Derived values

- Clip duration = `max(1, round((sourceOut - sourceIn) / speed))`, in whole project frames. Existing 1x projects retain their timing.
- Source position = `sourceIn + (timelinePosition - timelineStart) * speed`. Preview clamps video to its source range; audio extension wraps in source time. Export never reads past source Out when rounding duration up.
- Changing speed preserves the selected clip's start and source range. All later clips on that same track shift by the duration difference, preserving gaps; other tracks (including separately placed audio) stay fixed.
- Head trims account for speed and keep the original right edge when Out is unchanged. Splits must map to whole source bounds with both rounded half-durations exactly preserving the original timeline length. Unrepresentable cuts return an actionable error instead of silently shifting timing; at 0.25x, many adjacent timeline frames cannot be split.
- Timeline end = max over clips of `timelineStart + duration`.
- Candidate duration = sum of its segment lengths. Candidates are previewed from the edit list and become timeline clips (pointing at the real source asset) only when inserted. They never appear in `project.assets`, so undoing an insert cannot leave a dangling asset.

## Invariants (shared load/save and atomic-batch validation)

- Video clips and video assets placed on audio tracks: `0 <= sourceIn < sourceOut <= asset.durationFrames` (converted to project frames).
- Audio-asset clips: `0 <= sourceIn < sourceOut`; source offsets may exceed the asset duration after trimming/extension and wrap modulo the source duration during playback/export.
- Image clips: `sourceIn >= 0` and any positive length (images have no inherent duration), so they can be trimmed from either edge.
- Video/audio clips use finite speed 0.25..4; still-image clips require speed 1. Reverse playback and speed ramps are not implemented.
- Track `order` values are unique.
- The project frame rate can only change (`SetProjectFps`) while the timeline has no clips. When adoption conditions above hold, the engine importer issues `SetProjectFps` in the same command batch as the import. Undo history is planned for M3.
- An audio-track clip may reference a video asset that has audio (the result of "Split audio").
- No overlapping clips within a track.
- `timelineStart >= 0`.
- Clip kind is compatible with its track kind (audio clips on audio tracks, and so on).
- `transform` is only valid on visual clips (video or overlay tracks), never audio rows. Its center x/y is -10..10 project-frame units, scale is 0.01..10 of the fitted size, and opacity is 0..1. These bounded values prevent accidental unbounded render sizes; non-finite/out-of-range values are rejected.
- IDs are unique within the project.
- Optional `animations` preserves older version-1 projects without a migration.
  Only version-1 IDs from the shared animation catalog are accepted, in the correct
  entrance/exit phase; each duration is at least two whole project frames. The sum
  cannot exceed the clip's derived timeline duration. Audio rows reject animations.
  Animation duration stays in project frames when speed changes; edits leaving
  insufficient duration are rejected. Definitions and frame endpoints are in
  [Preview and Export](./05-preview-and-export.md#entranceexit-animation-catalog).
- Optional `zoom` also needs no migration. It is visual-only, version 1, with finite
  points `startPercent < endPercent` and scales 0.25..4; otherwise `INVALID_ZOOM`.
- Optional `volume` (linear 0..1) also needs no migration. It scales the clip's own
  sound in Preview and export; omitted means 100%, and saving 100% removes it.
  Out-of-range values return `INVALID_VOLUME`.
  Relaunch the app after schema updates; older app versions are not certified to
  preserve new optional fields.
- Optional `crop` stores source-relative `left`, `top`, `right`, `bottom` insets,
  each 0..0.9. Horizontal and vertical inset sums must each be below 0.95
  (more than 5% of each source dimension remains). Absent means no crop.
  `SetClipCrop` and saved-project relational validation reject crop on audio rows
  with `INVALID_CROP`. The optional field preserves older version-1 projects
  without adding defaults; older app versions are not certified to retain it.
  Preview/export and canvas bounds render the saved crop. Crop handles and
  Properties fields are implemented locally; desktop acceptance remains pending.
- Clip end positions must fit the supported safe-integer frame range.
- Optional `linkedClipId` must refer to another existing clip, not itself. Split audio deliberately does not set it (owner decision: split clips are independent); reciprocal link editing remains a future option.
- Valid locked tracks and unsorted saved clip arrays are accepted; validation sorts a copy for overlap checks. Missing original media does not invalidate the project structure and is reported separately as offline.

## Frame rate and clip audio

- The project frame rate is set at project creation. The create dialog offers a preset list, plus "use the frame rate of the first imported video" as an option that sets it on first import.
- **Current:** audio assets can be placed at the playhead on dedicated audio rows, moved and trimmed, and track rows can be added, reordered and muted. Forward moves and edge extensions trim the next clip's head while preserving its end, or move fully consumed clips and ripple following clips. Audio preview seeks from the shared clock and loops extended source ranges; export mixes unmuted audio rows with the visual audio bed. The visual bed sums the own sound of every stacked visual clip, matching preview, except clips whose audio was split and clips on a muted visual track (owner decision 2026-11-05: the timeline is the source of truth; use track Mute to filter sound).
- **Current limit:** audio preview is browser-clock synchronized with drift correction, not sample-accurate. Manual acceptance of placement, editing, muting, looping and export remains pending.
- **Current (desktop acceptance pending):** `SplitAudio` creates a separate audio clip on an audio track (first free unlocked one, or a new track added in the same batch) covering the same timeline position, source range and speed, and sets `audioLinked: false` on the video clip, as a single undo step. The clips are independent afterwards; `linkedClipId` is not set. Preview mutes and export silences a video clip whose `audioLinked` is false.
- **Approved demo behavior:** audio clips keep their natural duration when placed. Extending a clip's timeline edge loops its source to fill the added duration. Audio tracks can be added, reordered and muted independently.

## Overlay behavior

- Preview's canvas aspect selector changes project `settings.width/height` with
  `SetProjectCanvas` (16:9, 9:16, 1:1, 4:3), not a preview-only setting. Clip
  transforms and timeline edits are preserved; visuals refit to the new frame.
  Export reads these same dimensions. Undo restores the previous size exactly.

- **Current:** preview/export composite overlapping visual clips in track order, with higher-order tracks in front. Still images start at five seconds and can be shortened or lengthened by trimming their timeline edges.
- **Implemented:** visual clips' optional static `transform` (normalized center x/y, fitted scale, opacity) is applied in preview and export. An absent transform means centered, fitted 100% scale and 100% opacity. Content outside the project canvas is clipped. It affects visuals only, not source audio volume. The selected-clip Properties panel edits these values as percentages, with explicit Apply/Reset, autosave and Undo/Redo. Canvas editing in Preview writes the same `transform` (x/y by dragging, `scale` by corner handles); `clipCanvasRect` in `packages/schema/src/canvas.ts` is the shared geometry contract for where a picture sits.
- Crop data/commands, preview/export, selection geometry and editing controls are implemented.
  Rotation, free (non-proportional) resize, blend modes and keyframed transforms
  remain future upgrades.

## Versioning

`schemaVersion` is stored in `project.json`. New projects and saves use version 2.
Saved-file loading explicitly validates version 1 and adds `captionCues: []` in
memory, preserving media edits, optional fields and timestamps. Opening alone
does not rewrite either file; the next normal save writes version 2 and preserves
the previous validated main as the backup. A migration warning explains this.
API responses/current payloads require version 2; they do not silently migrate.

Versions other than 1 or 2 return `UNSUPPORTED_PROJECT_VERSION`. An unsupported
main must not trigger fallback to an older backup or be overwritten by a save.
Malformed supported files can still use the existing validated backup recovery.
A v1 file labelled with caption data is rejected rather than dropping the data.
Keep a separate pre-upgrade copy: older binaries are not safe for v2 projects
(including their historical behavior of falling back to an older backup).

Caption cues are independently validated as one nonoverlapping lane; adjacent
end/start frames are allowed. Array order is preserved and need not be chronological.
Media clips, their locks and source durations do not constrain manual cues.
Manual cue timing is timeline-fixed: moving/trimming/deleting media does not move
captions. Source anchoring and stale-cue warnings remain future work. Cue timing
may exceed media duration: editor playback includes cue end times and Preview
draws saved cues. Engine render duration remains media-only; captions do not yet
appear in exports. This difference is called out in the caption workspace and
Export dialog until SRT/burn-in is implemented.
