# 4. Commands, Undo and Persistence

[Back to index](./README.md)

## Command layer

**Delivery status:** SetProjectFps, asset/track add/remove, SetAssetProxy, SetTrackMuted, AddClip, MoveClip, TrimClip, SplitClip, RemoveClip, SetClipTransform, SetClipSpeed, SetClipAnimations, SetClipZoom and SplitAudio are implemented in the reducer. The UI exposes audio/visual track management, audio placement/move/trim/mute, visual-track ordering, split, split audio, delete, timeline clip-edge trim and selected-clip appearance/speed/animation/zoom properties. InsertSequence remains planned.

Every project change is a typed command applied by a single pure reducer in `timeline-core`. Manual UI edits and AI-confirmed actions use the same commands.

| Command | Effect |
|---------|--------|
| `SetProjectFps` | Set the project frame rate (only while there are no media clips or caption cues) |
| `AddCaptionCue` | Add a plain-text cue to the independent caption lane; optional `index` restores exact saved order during Undo |
| `SetCaptionCue` | Replace an existing cue by the same ID, updating its text and/or start/end atomically |
| `RemoveCaptionCue` | Remove a cue by ID; inverse restores its data and original index |
| `SetProjectCanvas` | Set positive whole-pixel project width/height, including populated timelines. Preview aspect and export use the same settings; inverse restores exact dimensions. |
| `AddAsset` / `RemoveAsset` | Register or remove an asset (removal blocked if in use) |
| `AddTrack` / `RemoveTrack` | Manage tracks |
| `SetTrackMuted` | Mute or unmute a track |
| `SetTrackName` | Set a trimmed 1-80 character label; omitted name restores the default label during Undo |
| `SetTrackLocked` | Lock or unlock clip editing and track removal |
| `AddClip` | Place an asset segment on a track; optional `ripple` moves overlapping whole clips and following clips forward as needed |
| `RelinkAsset` | Restore a missing media reference using an absolute path that matches the imported media fingerprint |
| `MoveClip` | Change `timelineStart` and optionally the destination track |
| `TrimClip` | Change `sourceIn` or `sourceOut` from either edge |
| `SplitClip` | Split a clip at a frame into two |
| `SplitAudio` | Copy a video clip's sound to an independent audio-track clip (same position, range, speed) and set the video clip's `audioLinked: false`. Client batches an `AddTrack` first when no free audio track exists. Rejects with `INVALID_AUDIO_SPLIT`, `OVERLAP`, `TRACK_LOCKED` or `DUPLICATE_ID`. |
| `SetClipTransform` | Set normalized center, fitted scale and opacity of a visual clip; omit `transform` to restore the default appearance |
| `SetClipCrop` | Save source-relative crop insets on a visual clip; omit `crop` to remove it. Preview/export and canvas bounds use the crop. Handles commit on release; Properties uses Apply/Reset. |
| `SetClipSpeed` | Set forward video/audio speed 0.25..4; preserve source range/start and ripple all later same-track clips by the duration change |
| `SetClipAnimations` | Set versioned entrance/exit presets and project-frame durations on a visual clip; omit `animations` to clear both ends |
| `SetClipZoom` | Set a visual clip's two-point zoom (`version: 1`, start/end points as % of the clip, start/end scales 0.25..4); omit `zoom` to remove it |
| `RemoveClip` | Delete a clip |
| `InsertSequence` | Insert a candidate's edit list as consecutive clips (used by jump-cut) |

Rules:

- Commands are validated against the invariants in [Data Model](./03-data-model.md). Invalid commands return a typed error and change nothing.
- Caption cue commands are exposed in the manual caption workspace, with saved
  cues drawn in Preview. SRT/burn-in and generation remain unavailable.
  They require nonblank plain text up to 2000 characters, safe whole-frame timing
  with start before exclusive end, and no overlap with another cue. Cue IDs share
  the global entity namespace. Invalid values/overlaps return `INVALID_CAPTION`;
  missing cues return `NOT_FOUND`, reused IDs return `DUPLICATE_ID`. Malformed
  API payloads return `INVALID_REQUEST` before application. Commands preserve
  media edits and caption array order; each inverse batch restores exact cue data.
  Migration/version rejection and backup behavior are described in
  [Versioning](./03-data-model.md#versioning).
- `SetClipCrop` stores each inset in 0..0.9, with opposing inset sums below 0.95;
  invalid values or audio-track crops return `INVALID_CROP`, and locked tracks
  return `TRACK_LOCKED`. Undo restores the exact previous crop or its absence.
  Spatial crop survives move, trim, speed, split and delete/restore unchanged;
  Split audio never copies it onto the new audio clip. Invalid command payloads
  are rejected by the API schema with `INVALID_REQUEST` before the reducer runs.
- A command produces a new project state plus an **inverse command** for undo.
- `InsertSequence` is a single undo step, even though it creates many clips.
- **Placement rules (prototype):** `AddClip` rejects overlap unless `ripple` is enabled. UI asset insertion enables ripple: the new clip remains at the playhead/drop time on the selected/target row, overlapping clips move intact after it, and later clips shift only as needed. Source ranges stay unchanged, including when inserting inside a clip; one inverse batch restores the entire insertion. Without a selected row, insertion uses a compatible free row or creates one. `InsertSequence` remains planned. `MoveClip` can move a clip between tracks of the same kind; visual tracks may overlap for compositing, while audio tracks reject overlapping clips. A same-track move or extending `TrimClip` trims the overlapped head of a following clip while preserving its end; if the operation would consume that clip, it moves intact and following clips ripple forward as needed. This also applies when moving a clip backward into a following clip. Moving a clip into a previous clip is rejected. One inverse batch restores all affected clip ranges and positions. Dragging preserves the clip's horizontal position under the pointer and previews it in the destination row; track ordering is unchanged. Visual drag snaps either clip edge to time zero, the playhead, or another visual clip edge within 8 screen pixels. Playback pauses when a clip move, trim, or asset drag starts.
- `InsertSequence` parameters: candidate, target track, start frame. By default the inserted clips keep their source audio **muted** (`audioLinked: true` with the track's audio muted for those clips); an option unmutes it. Jump-cut sequences are normally paired with music.
- Continuous gestures (dragging, trimming) are coalesced into one undo step.
- Track names are optional, so older projects need no migration. Select a visual/audio track to rename or lock it using the settings row above the timeline. Both settings autosave and use normal Undo/Redo. Locks reject clip insertion (including ripple), movement into/out of the track, trimming, splitting, deletion, and track removal; they do not mute or hide media. Naming, muting, and track ordering remain available while locked.
- The Properties pane follows the selected timeline clip. Clicking empty timeline space keeps the current clip selected; only selecting another clip (or deleting it) changes Properties. Trimming is done on the timeline by dragging clip edges (`TrimClip`); Properties no longer has a Trim section (removed 2026-11-05 at the owner's request as a duplicate). Appearance sliders preview live in Preview only (an unsaved client draft, not a command); releasing a slider, leaving/pressing Enter in a box, or the end of a 400 ms burst of − / + clicks sends one `SetClipTransform` and creates one engine-confirmed Undo entry. Reset appearance removes the transform. A pending − / + burst still saves if the selection changes; an unreleased drag is discarded. An identical edit is not resent while its confirmation is pending. Pending/unconfirmed edits, closing and track locks disable controls. Drafts reset on selection or confirmed clip changes; invalid inputs surface errors. Expanded sections stay expanded after a confirmed save and collapse only when the selection changes. Audio rows expose speed, not visual transforms.
- Canvas editing in Preview selects the same clip as the timeline. A canvas drag or corner resize is an unsaved client draft (Preview and the Appearance sliders mirror it) and sends one `SetClipTransform` on release; a click without movement sends nothing. Canvas layer order adds no new command: `planLayerClip` sends one batch of `MoveClip` (same `timelineStart`, another visual track) and, when no free track sits at that spot, a preceding `AddTrack` plus `SwapTrackOrder` steps that slide the new track into position. The batch is one engine-confirmed Undo entry; an `AddTrack` `DUPLICATE_ORDER` race uses the existing refresh-and-retry path.
- Zoom uses `SetClipZoom`. Add zoom saves a default (25%→75%, 100%→150%). The two-handle bar, Set start/end at playhead and the scale sliders preview live as an unsaved client draft and save one Undo entry on release, Enter/leaving a box or the end of a − / + burst, like Appearance. The start point must stay before the end (handles keep 1% apart). Zoom multiplies the saved appearance scale around its center, holding the start scale before the start point and the end scale after the end point with smoothstep easing. Points are percentages of the clip, so trim and speed keep them relative and need no change. Split re-expresses the points on each half (they may fall outside 0–100%) so every frame keeps the same scale; a half that only holds one scale stores a constant zoom, or none at 100%. Its inverse restores the original clip. Audio clips, reversed points or out-of-range scales return `INVALID_ZOOM`.
- Volume uses `SetClipVolume` (0–100%, saved as linear 0..1; 100% clears the field). The Properties Volume slider appears for clips with their own sound (audio-track clips, or visual clips whose sound is not split away) and saves one Undo entry on release, Enter or leaving the box. Split and Split audio copy the volume. Preview sets element volume; export applies an FFmpeg `volume` filter per clip. Its inverse restores the previous value. Out-of-range values return `INVALID_VOLUME`.
- Speed uses `SetClipSpeed` with the same slider/box/− / + (0.05x) save rules, autosaves and produces one Undo entry restoring speed and every shifted neighbor exactly. Speed does not preview live while dragging, because it changes clip length and ripples neighbors; after release the preview seeks to the frame now under the playhead. It does not modify other tracks or detached audio. Still images have no speed control. Appearance and Animations remain collapsed by default; speed is directly available on video/audio selection.
- Speed-aware trim/move overwrite rules consume whole source frames. When a neighbor's overlapped head cannot be cut with exact rounded timing, move that neighbor intact and ripple following clips rather than introduce overlaps or discard its media. Splits that cannot preserve both half-durations fail with `INVALID_FRAME` and nearby-frame guidance.
- Apply animations and Remove animations use the normal confirmed command/history
  path. None removes only that end on Apply; both None remove the optional field.
  Whole-frame durations are at least two per effect and sum to no more than the
  clip length. Trim, speed and neighbor-head ripple edits violating this contract
  return `INVALID_ANIMATION` atomically, retaining the original project.
  Split keeps only entrance on the left half and only exit on the right, rejecting
  too-short halves. Its inverse restores the complete original clip. Effects are
  re-anchored to clip edges after valid trims; speed changes do not rescale their
  saved project-frame durations. Visual animations do not change audio gain.

## Undo and redo

Edit/save errors now use a context-aware [error catalog](./18-error-catalog-and-recovery.md).
Definitive rejection responses can carry `outcome: "not-applied"`; only that explicit
engine assertion or a failed operation receipt permits rejection handling without
uncertainty. Unknown receipts remain locked until checked or explicitly reviewed.
Uncatalogued contexts create sanitized temporary local development follow-ups,
not permanent user-facing error history.

- The client session keeps undo and redo stacks from the inverse commands returned by the engine. A history entry is added only after the engine confirms the edit; undo/redo themselves are sent as normal command batches, and the returned inverse moves the entry to the opposite stack.
- A new successful edit clears redo history. A failed edit leaves both stacks unchanged. If an ambiguous command is reconciled by refreshing the project instead of its recorded result, both stacks are cleared because the missing inverse cannot be trusted.
- One clip drag, trim, or reducer operation that changes neighboring clips is one history entry. Multi-command operations such as adding a track and clip together remain one entry.
- Toolbar buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, and Ctrl+Y shortcuts invoke undo/redo. Shortcuts are ignored in text-entry fields.
- History is session-local and resets when the editor session ends; it is not persisted across project reopen. AI-originated edits are not yet tagged separately.

## Persistence

- A project is a folder:

```
MyProject/
  project.json       canonical project state
  media/             copies of imported files (only when "copy into project" is used)
  proxies/           generated proxy media
  candidates/        candidate edit lists, score caches and optional rendered previews
  exports/           rendered output
```

- `project.json` is written atomically (write to temp, then rename) to avoid corruption.
- **Autosave:** the engine writes after every committed command batch. A rejected batch changes and saves nothing. Writes validate shape and relational invariants first, use unique exclusively created temporary files, and atomically replace each file by rename.
- **Save status and retry:** the editor shows Saving while a command/import is pending, Autosaved only after confirmed completion, and Save unconfirmed when the outcome cannot be established. A rejected edit restores the preceding save status rather than claiming a disk failure. `SAVE_FAILED`/`SAVE_CLEANUP_FAILED` command outcomes are recorded as confirmed failures: the in-memory edit was not committed. The UI offers Retry edit only for these confirmed failures while its original project snapshot remains current; retry uses a new attempt ID, preserves undo/redo intent, and never happens automatically. Unconfirmed commands keep the existing status/reconciliation lock and cannot use this retry.
- **Recovery notice:** opening from backup shows a persistent in-editor notice, not a blocking browser alert. Backup loaded means the main file has not yet been repaired; a successful edit or an import that adds assets autosaves it. The notice then confirms the recovered state was saved and still warns that newer edits may be absent. Merely opening/closing does not repair or overwrite the main file.
- **Backup safety:** only a validated existing main file may replace `project.json.bak`; the backup is itself written through a temporary file and rename before main replacement. If the main is missing/corrupt (including structurally valid but relationally invalid), the usable backup is left untouched during recovery saves. Replacement failures keep the old in-memory project and allow retry; owned temporary-file cleanup failures are coded and include paths. This is not a power-loss/fsync or multi-engine locking guarantee.
- **Recent projects:** the engine keeps `recent.json` (newest first, capped at 10) in its data directory (`ENGINE_DATA_DIR`, default `~/.video-editor-prototype`). Availability uses the same main/backup validation as open, so backup-only recoverable projects remain selectable. Missing/unusable projects are disabled. Permission/index errors are explicit, not an empty-list success.
- **Bookkeeping outcome:** successful create/open returns the project plus optional `{code, message}` warnings when updating recents fails. The editor displays these warnings; the saved project stays active. Damaged indices are preserved, not silently overwritten. There is no automatic index-repair UI; users can open by folder and preserve/rename the reported index.
- **Open:** Zod shape validation plus shared timeline-core relational checks; fallback to a validated backup for missing/invalid main data (the UI warns). I/O/permission errors are reported distinctly rather than assumed corruption. Schema migration and content-integrity verification/relink remain planned; existence/offline checks are implemented separately.

### Project API (engine)

| Route | Purpose |
|---|---|
| `POST /project/create` | Create the folder layout and an empty project. Existing main or backup prevents creation (`ALREADY_EXISTS`). Accepts optional UUID `attemptId`; successful response may include recent-index or post-commit preparation warnings. |
| `POST /project/open` | Open a validated main/backup (`NOT_FOUND`, `CORRUPT`, `STORE_IO_FAILED`). Accepts optional UUID `attemptId`; successful response may include recent-index or post-commit preparation warnings. |
| `GET /project/operations/:attemptId` | Returns `{state: pending, attemptId}`, `{state: done, attemptId, response}` or `{state: failed, attemptId, error}`. Done returns the still-active generation's current project plus operation warnings, not a stale opening snapshot. Switch/close/reopen rejects with `PROJECT_CHANGED`; unknown/evicted/restarted attempts return `OPERATION_UNKNOWN`, not proof a retry is safe. |
| `POST /project/commands` | Apply a command batch atomically, autosave, return `{project, inverse}`. Accepts optional UUID `attemptId`; updated clients use a fresh ID and a 15-second deadline. Duplicate IDs are rejected, never resubmitted. Invalid batches return 422 with a command error code. |
| `GET /project/command-operations/:attemptId` | Returns `{state: pending, attemptId}`, `{state: done, attemptId, response}`, `{state: failed, attemptId, error}` or `{state: unknown, attemptId, error}`. Done returns the active generation's current project; changed/closed generations return `PROJECT_CHANGED`/`NO_PROJECT`. Unknown, missing, evicted or restarted attempts do not prove retry is safe. The editor locks further edits/navigation on ambiguous results, checks status without resubmitting, and for unknown outcomes requires a current-project refresh plus explicit confirmation before unlocking. |
| `POST /project/save` | Manual save (`SAVE_FAILED` / `SAVE_CLEANUP_FAILED`). |
| `POST /project/close` | Body may include `{expectedProject: {id, folder}}`. Current client always sends its known identity; mismatch inside the session queue returns `PROJECT_CHANGED` without closing the other project or running close hooks. No body/empty body remains compatible with older callers. No active project permits a cleanup-confirmation retry. `{ok: true}` is returned only after close hooks settle; hook/transport failure may occur after the session already closed. |
| `GET /project` / `GET /projects/recent` | Current project, and the recent list. |
| `POST /project/import` | Import files by reference or copy. Body: `{attemptId?, paths, mode}`. Updated clients send a fresh UUID attempt ID and use a 15-second deadline. Probes each file with ffprobe, rejects duplicates (quick content hash) and unsupported files per file without failing the batch, and adds the assets in one command batch without queuing proxies. Returns `{project, imported, failed}`. |
| `GET /project/imports/:attemptId` | Returns `{state: pending, attemptId}`, `{state: done, attemptId, response}`, `{state: failed, attemptId, error}` or `{state: unknown, attemptId, error}`. Done returns the still-active generation's current project; switch/close/reopen rejects with `PROJECT_CHANGED`. Unknown, missing, evicted or restarted attempts do not prove retry is safe. The client never resubmits automatically: it checks status, refreshes the current project for unresolved outcomes, and requires explicit user confirmation before another attempt. |
| `GET /project/proxies` / `GET /project/events` | Authoritative proxy progress snapshot and server-sent updates (`event: proxy`). The token goes in the `?token=` query. The engine subscribes before sending the initial snapshot to avoid a missed-update gap. The client reconciles on initial connection, reconnect and window focus; a visible manual refresh is also available. Snapshot failures are surfaced without discarding the last known state. |
| `GET /media/:assetId/proxy` | Serves the proxy with HTTP range support (206/416), for `<video>` seeking. |
| `GET /media/:assetId/source` | Serves registered image/audio/video originals, including silent video, with HTTP range support and existing project/path/auth safeguards. |
| `POST /project/preview-jobs` | Body: `{assetId, action: "prepare" \| "cancel", expectedProject: {id, folder}}`. Explicit optional video optimization; returns the authoritative proxy list. Prepare deduplicates queued/running jobs and reuses an existing referenced proxy. Cancel waits for active writer/cleanup settlement or an already-started commit. Status includes `cancelled`; stale project generations cannot publish metadata. Client deadline is 15 seconds; timeout does not imply cancellation or success, so refresh status before another action. No durable attempt record or automatic resubmission. |
| `POST /project/export` / `GET /project/export` | Start accepts optional `{attemptId}` UUID; status carries it through the accepted job's lifecycle. Empty/bodyless starts remain compatible. Client start/status have 15-second deadlines; ambiguous start remains locked until a matching non-idle status confirms that attempt. See [Preview and Export](./05-preview-and-export.md). |

Folder and file paths must be absolute. All routes need the session token.

The current client keeps a native recovery modal until close completion is confirmed, with 15-second close/status deadlines. Failure requires an authoritative `GET /project` before retry: no project means session closed but cleanup is still unconfirmed; same project allows guarded retry; a different project is adopted explicitly with a warning rather than blindly closed. A client timeout/abort does not undo engine work. Command batches use bounded in-memory UUID status records and a 15-second deadline; an ambiguous result locks further edits/navigation, status checks never resubmit, and unknown outcomes require refreshed project state and explicit user confirmation. Offline-media and proxy status are explicitly refreshable and refreshed on focus; failed refreshes remain visible with retry controls. This does not certify simultaneous multi-client lifecycle control or durable mutation history.

Recent-project and default-folder reads also have 15-second client deadlines. Recent-list failure preserves existing entries and offers retry; default-folder failure permits a manual location and an explicit retry. Proxy SSE rejects malformed payloads, keeps last-known state if reconciliation fails, and reconciles from the authoritative snapshot on reconnect/focus; event delivery itself is not guaranteed.

Create/open now also have 15-second fetch/body deadlines and use a fresh attempt UUID. Ambiguous transport/server/response errors keep creation/navigation locked with Check project operation; only a matching done result adopts the project, or a matching failed result permits explicit retry/cancel. Pending/unknown/changed outcomes retain the lock. Status checks never resubmit create/open. Legacy callers may omit attempt IDs; deploy updated client/schema/engine together for recovery. Import attempt records are likewise in-memory and bounded; after engine restart or record eviction, inspect the refreshed project before explicitly allowing another import.

The engine records at most **16 create/open attempts in memory**, reserving pending before asynchronous work and allowing only one create/open through preparation at a time (`PROJECT_OPERATION_BUSY`). Repeated retained IDs return `ATTEMPT_EXISTS`, not another mutation. This is a bounded recovery record, not durable history or indefinite idempotency: evicted IDs are no longer protected from later submission. A process restart forgets all attempts. No-project/current-folder checks alone cannot prove an unrecorded request will not arrive later.

If project storage/session commitment succeeds but background cleanup/proxy preparation fails, the route returns the committed project with `PROJECT_PREPARATION_FAILED` and a diagnostic ID matching a safe JSON stderr record. It does not claim preparation succeeded or delete/recreate the saved project. Close/reopen after checking diagnostics; preview may be unavailable. Unknown core failures use `PROJECT_OPERATION_FAILED` with an ID retained in operation status. Core typed storage/validation failures retain their error semantics; broader logging remains partial K26.

Unexpected errors escaping routes use `{error: {code: "ENGINE_UNEXPECTED_ERROR", message, diagnosticId}}` (500), not raw exception messages/stacks. IDs are server-generated UUIDs; the client validates the error shape and retains IDs in error text. Fastify malformed-body/content-type/size errors retain their 4xx status with `INVALID_REQUEST`; route-defined typed errors are unchanged. A diagnostic does not prove rollback or authorize retry of an uncertain mutation.

### Import details (implemented)

- **Picker ownership/recovery (K24 slice):** choosing media has a visible pending state, duplicate-click guard and locked copy/reference choice. Picker rejection shows `MEDIA_PICK_FAILED` and permits retry; cancellation sends no import. Owner chose to allow Projects navigation: close initiation, project/engine identity change or unmount invalidates the picker selection, so a late result never starts an import. Import already submitted is not cancelled by leaving; stale UI results are ignored, while existing engine lifecycle guards/cleanup remain authoritative.
- **Import feedback:** batch and per-file errors show their codes. The browser-only typed path is locked while submitting, retained on failures and cleared only on fully confirmed success. Import uses a 15-second fetch/body deadline and UUID-correlated bounded status; ambiguous outcomes require explicit status checks and same-project refresh/confirmation, never automatic retry.
- **Media kinds:** video and audio. Images are rejected for now.
- **Frame counts:** video durations are native frames at the file's own frame rate (`avg_frame_rate`, reduced rational). Audio uses a 1000/1 millisecond timebase.
- **Paths:** reference mode stores the absolute path. Copy mode copies into `media/` (name collisions get `-1`, `-2`) and stores a project-relative path, so a copied project can be moved.
- **Frame rate:** if the opted-in project has no video assets or clips, the first video's rate is applied with `SetProjectFps` in the same batch; audio-first imports are supported.
- **Proxy path:** `SetAssetProxy` records `proxies/<assetId>.mp4` once explicit preparation completes, and autosaves it. Open/relink clears missing referenced proxies without generating replacements. Import/open/relink never automatically queue encoding; supported originals can play immediately. Job controls are not timeline Undo entries.

## Import modes

- **Reference (default):** the asset stores the absolute path of the original file. No extra disk use, fast import, but the project depends on the file staying put.
- **Copy into project (option):** an implemented per-import choice. The file is copied to `media/` and stored as a project-relative path. The UI shows a busy import state, not copy-byte progress or a disk-space check; Settings/default preferences remain planned.
- Export output always goes to `exports/`, regardless of import mode.
- Switching an existing asset between modes is a future feature.

## Media integrity and relinking (target behavior)

**Implemented:** existence checks and offline flags; export checks used original files. **Planned M3:** content verification, relink UI and path-update command. Current checks do not guarantee that a replaced source matches the original.

- On open, the engine checks each asset path exists and the size or hash matches.
- Missing assets are flagged, not fatal. The project opens with a banner and the clip shows a "missing media" state.
- The user can relink by choosing a file; the engine matches by content hash and updates the path.
- Proxies are regenerable and never treated as source of truth.

## Failure handling

This section describes target recovery behavior. Current open uses backup fallback with a warning; reconnect buffering and recovery controls remain planned.

- Corrupt `project.json`: offer to restore the previous autosave backup (`project.json.bak`).
- Engine disconnect: client shows a reconnect state and keeps unsaved commands in memory.
