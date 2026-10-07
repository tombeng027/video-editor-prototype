# 4. Commands, Undo and Persistence

[Back to index](./README.md)

## Command layer

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
- **Autosave:** the engine writes `project.json` after every committed command batch. A rejected batch changes and saves nothing. Each save keeps the previous version as `project.json.bak`.
- **Recent projects:** the engine keeps a small index (`recent.json`, newest first, capped at 10) in its data directory (`ENGINE_DATA_DIR`, default `~/.video-editor-prototype`). Entries whose folder has gone are shown as "not found".
- **Open:** load, validate with Zod, then fall back to `project.json.bak` if the main file is unreadable (the UI warns when this happens). Schema migration and media verification are still to do.

### Project API (engine)

| Route | Purpose |
|---|---|
| `POST /project/create` | Create the folder layout and an empty project. The folder must not already hold a project (`ALREADY_EXISTS`). |
| `POST /project/open` | Open a project folder (`NOT_FOUND`, `CORRUPT`). |
| `POST /project/commands` | Apply a command batch atomically, autosave, return `{project, inverse}`. Invalid batches return 422 with a command error code. |
| `POST /project/save` / `POST /project/close` | Manual save, and close the open project. |
| `GET /project` / `GET /projects/recent` | Current project, and the recent list. |
| `POST /project/import` | Import files by reference or copy. Body: `{paths, mode}`. Probes each file with ffprobe, rejects duplicates (quick content hash) and unsupported files per file without failing the batch, adds the assets in one command batch and queues proxies. Returns `{project, imported, failed}`. |
| `GET /project/proxies` / `GET /project/events` | Proxy progress as a list, and as server-sent events (`event: proxy`). The token goes in the `?token=` query. |
| `GET /media/:assetId/proxy` | Serves the proxy with HTTP range support (206/416), for `<video>` seeking. |

Folder and file paths must be absolute. All routes need the session token.

### Import details (implemented)

- **Media kinds:** video and audio. Images are rejected for now.
- **Frame counts:** video durations are native frames at the file's own frame rate (`avg_frame_rate`, reduced rational). Audio uses a 1000/1 millisecond timebase.
- **Paths:** reference mode stores the absolute path. Copy mode copies into `media/` (name collisions get `-1`, `-2`) and stores a project-relative path, so a copied project can be moved.
- **Frame rate:** if the project was created with 'match the first imported video' and has no assets or clips, the first imported video's frame rate is applied with `SetProjectFps` in the same batch.
- **Proxy path:** `SetAssetProxy` records `proxies/<assetId>.mp4` once the file exists. It is a normal command, so it is autosaved. Proxies missing on open (deleted, or interrupted) are regenerated automatically.

## Import modes

- **Reference (default):** the asset stores the absolute path of the original file. No extra disk use, fast import, but the project depends on the file staying put.
- **Copy into project (option):** a per-import choice (with an optional default in settings). The file is copied to `media/` and stored as a project-relative path, making the project portable. The UI shows disk-space and progress for the copy.
- Export output always goes to `exports/`, regardless of import mode.
- Switching an existing asset between modes is a future feature.

## Media integrity and relinking

- On open, the engine checks each asset path exists and the size or hash matches.
- Missing assets are flagged, not fatal. The project opens with a banner and the clip shows a "missing media" state.
- The user can relink by choosing a file; the engine matches by content hash and updates the path.
- Proxies are regenerable and never treated as source of truth.

## Failure handling

- Corrupt `project.json`: offer to restore the previous autosave backup (`project.json.bak`).
- Engine disconnect: client shows a reconnect state and keeps unsaved commands in memory.
