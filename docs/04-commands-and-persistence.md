# 4. Commands, Undo and Persistence

[Back to index](./README.md)

## Command layer

**Delivery status:** SetProjectFps, asset/track add/remove, SetAssetProxy, AddClip, TrimClip, SplitClip and RemoveClip are implemented in the reducer. MoveClip, SplitAudio, SetClipTransform and InsertSequence below are planned. UI currently exposes add, split and delete; trim/track/history UI is not shipped.

Every project change is a typed command applied by a single pure reducer in `timeline-core`. Manual UI edits and AI-confirmed actions use the same commands.

| Command | Effect |
|---------|--------|
| `SetProjectFps` | Set the project frame rate (only while the timeline has no clips) |
| `AddAsset` / `RemoveAsset` | Register or remove an asset (removal blocked if in use) |
| `AddTrack` / `RemoveTrack` | Manage tracks |
| `AddClip` | Place an asset segment on a track |
| `MoveClip` | Change `timelineStart` and/or track |
| `TrimClip` | Change `sourceIn` or `sourceOut` from either edge |
| `SplitClip` | Split a clip at a frame into two |
| `SplitAudio` | Detach a video clip's audio onto a separate audio track clip |
| `SetClipTransform` | Set position, scale and opacity of an overlay clip |
| `RemoveClip` | Delete a clip |
| `InsertSequence` | Insert a candidate's edit list as consecutive clips (used by jump-cut) |

Rules:

- Commands are validated against the invariants in [Data Model](./03-data-model.md). Invalid commands return a typed error and change nothing.
- A command produces a new project state plus an **inverse command** for undo.
- `InsertSequence` is a single undo step, even though it creates many clips.
- **Placement rules (prototype):** `AddClip`, `MoveClip` and `InsertSequence` never overwrite or ripple existing clips. If the target range overlaps another clip, the command is rejected with a clear message. `AddClip` and `InsertSequence` default to the playhead on the selected track of the matching kind.
- `InsertSequence` parameters: candidate, target track, start frame. By default the inserted clips keep their source audio **muted** (`audioLinked: true` with the track's audio muted for those clips); an option unmutes it. Jump-cut sequences are normally paired with music.
- Continuous gestures (dragging, trimming) are coalesced into one undo step.

## Undo and redo

**Planned M3:** inverse commands exist, but client history stacks and Undo/Redo buttons are not functional yet.

- Undo and redo stacks live in the client session, built from inverse commands.
- Opening a project clears history.
- AI-originated edits are tagged `source: "ai"` in history so the UI can label them.

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
| `POST /project/commands` | Apply a command batch atomically, autosave, return `{project, inverse}`. Invalid batches return 422 with a command error code. |
| `POST /project/save` | Manual save (`SAVE_FAILED` / `SAVE_CLEANUP_FAILED`). |
| `POST /project/close` | Body may include `{expectedProject: {id, folder}}`. Current client always sends its known identity; mismatch inside the session queue returns `PROJECT_CHANGED` without closing the other project or running close hooks. No body/empty body remains compatible with older callers. No active project permits a cleanup-confirmation retry. `{ok: true}` is returned only after close hooks settle; hook/transport failure may occur after the session already closed. |
| `GET /project` / `GET /projects/recent` | Current project, and the recent list. |
| `POST /project/import` | Import files by reference or copy. Body: `{attemptId?, paths, mode}`. Updated clients send a fresh UUID attempt ID and use a 15-second deadline. Probes each file with ffprobe, rejects duplicates (quick content hash) and unsupported files per file without failing the batch, adds the assets in one command batch and queues proxies. Returns `{project, imported, failed}`. |
| `GET /project/imports/:attemptId` | Returns `{state: pending, attemptId}`, `{state: done, attemptId, response}`, `{state: failed, attemptId, error}` or `{state: unknown, attemptId, error}`. Done returns the still-active generation's current project; switch/close/reopen rejects with `PROJECT_CHANGED`. Unknown, missing, evicted or restarted attempts do not prove retry is safe. The client never resubmits automatically: it checks status, refreshes the current project for unresolved outcomes, and requires explicit user confirmation before another attempt. |
| `GET /project/proxies` / `GET /project/events` | Proxy progress as a list, and as server-sent events (`event: proxy`). The token goes in the `?token=` query. |
| `GET /media/:assetId/proxy` | Serves the proxy with HTTP range support (206/416), for `<video>` seeking. |
| `POST /project/export` / `GET /project/export` | Start accepts optional `{attemptId}` UUID; status carries it through the accepted job's lifecycle. Empty/bodyless starts remain compatible. Client start/status have 15-second deadlines; ambiguous start remains locked until a matching non-idle status confirms that attempt. See [Preview and Export](./05-preview-and-export.md). |

Folder and file paths must be absolute. All routes need the session token.

The current client keeps a native recovery modal until close completion is confirmed, with 15-second close/status deadlines. Failure requires an authoritative `GET /project` before retry: no project means session closed but cleanup is still unconfirmed; same project allows guarded retry; a different project is adopted explicitly with a warning rather than blindly closed. A client timeout/abort does not undo engine work. This does not certify simultaneous multi-client lifecycle control or supply general mutation reconciliation.

Create/open now also have 15-second fetch/body deadlines and use a fresh attempt UUID. Ambiguous transport/server/response errors keep creation/navigation locked with Check project operation; only a matching done result adopts the project, or a matching failed result permits explicit retry/cancel. Pending/unknown/changed outcomes retain the lock. Status checks never resubmit create/open. Legacy callers may omit attempt IDs; deploy updated client/schema/engine together for recovery. Import attempt records are likewise in-memory and bounded; after engine restart or record eviction, inspect the refreshed project before explicitly allowing another import.

The engine records at most **16 create/open attempts in memory**, reserving pending before asynchronous work and allowing only one create/open through preparation at a time (`PROJECT_OPERATION_BUSY`). Repeated retained IDs return `ATTEMPT_EXISTS`, not another mutation. This is a bounded recovery record, not durable history or indefinite idempotency: evicted IDs are no longer protected from later submission. A process restart forgets all attempts. No-project/current-folder checks alone cannot prove an unrecorded request will not arrive later.

If project storage/session commitment succeeds but background cleanup/proxy preparation fails, the route returns the committed project with `PROJECT_PREPARATION_FAILED` and a diagnostic ID matching a safe JSON stderr record. It does not claim preparation succeeded or delete/recreate the saved project. Close/reopen after checking diagnostics; preview may be unavailable. Unknown core failures use `PROJECT_OPERATION_FAILED` with an ID retained in operation status. Core typed storage/validation failures retain their error semantics; broader logging remains partial K26.

Unexpected errors escaping routes use `{error: {code: "ENGINE_UNEXPECTED_ERROR", message, diagnosticId}}` (500), not raw exception messages/stacks. IDs are server-generated UUIDs; the client validates the error shape and retains IDs in error text. Fastify malformed-body/content-type/size errors retain their 4xx status with `INVALID_REQUEST`; route-defined typed errors are unchanged. A diagnostic does not prove rollback or authorize retry of an uncertain mutation.

### Import details (implemented)

- **Picker ownership/recovery (K24 slice):** choosing media has a visible pending state, duplicate-click guard and locked copy/reference choice. Picker rejection shows `MEDIA_PICK_FAILED` and permits retry; cancellation sends no import. Owner chose to allow Projects navigation: close initiation, project/engine identity change or unmount invalidates the picker selection, so a late result never starts an import. Import already submitted is not cancelled by leaving; stale UI results are ignored, while existing engine lifecycle guards/cleanup remain authoritative.
- **Import feedback:** batch and per-file errors show their codes. The browser-only typed path is locked while submitting, retained on failures and cleared only on fully confirmed success. Import fetch/body deadlines and ambiguous committed-outcome reconciliation remain open K24 work; this slice does not add automatic mutation retries.
- **Media kinds:** video and audio. Images are rejected for now.
- **Frame counts:** video durations are native frames at the file's own frame rate (`avg_frame_rate`, reduced rational). Audio uses a 1000/1 millisecond timebase.
- **Paths:** reference mode stores the absolute path. Copy mode copies into `media/` (name collisions get `-1`, `-2`) and stores a project-relative path, so a copied project can be moved.
- **Frame rate:** if the opted-in project has no video assets or clips, the first video's rate is applied with `SetProjectFps` in the same batch; audio-first imports are supported.
- **Proxy path:** `SetAssetProxy` records `proxies/<assetId>.mp4` once the file exists. It is a normal command, so it is autosaved. Proxies missing on open (deleted, or interrupted) are regenerated automatically.

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
