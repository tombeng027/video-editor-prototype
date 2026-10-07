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
- **Autosave:** debounced after each committed command; a manual Save is also available.
- **Recent projects:** the landing screen reads a small app-level index of recent project folders.
- **Open:** load, validate with Zod, migrate if `schemaVersion` is older, then verify media.

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
