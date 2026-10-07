# 1. Overview and Scope

[Back to index](./README.md)

## Goals

- Provide a usable manual editing workflow: import, arrange, trim, split, preview, save, reopen, export.
- Integrate a local LLM assistant for editing guidance.
- Let the assistant propose a confirmed quick action: the jump-cut sequence.
- Establish a data model and command layer that manual edits and AI actions share.

## Non-goals (prototype)

- Mobile or standalone on-device editing (planned, see [Future Features](./10-future-features.md)).
- Effects, transitions, text, captions, keyframes, speed changes.
- Real-time GPU compositing, collaboration, cloud sync.
- Frame-accurate semantic detection guarantees (the vision output is a ranked suggestion).

## Prototype scope

| Area | In scope |
|------|----------|
| Projects | Create, save, open, autosave, missing-media relink |
| Assets | Import video/audio/image, metadata, proxy generation, temporary candidates from AI actions |
| Timeline | Multiple tracks, drag/drop, move, trim, split, undo/redo, snapping |
| Preview | Playback synced to the playhead, scrub, rate control |
| Export | Single preset export via FFmpeg with progress and cancel |
| AI | Streaming chat, suggestive answers, confirmed `jump_cut_sequence` action |

## Target platform

- **Now:** PC (Windows first; macOS/Linux should work since nothing is OS-specific by design).
- **Later:** mobile as remote editor, then standalone. The client/engine separation and the shared schema keep this possible.

## Glossary

- **Asset:** a media file registered in a project.
- **Clip:** a placement of an asset segment on a track.
- **Command:** a typed, undoable edit to the project.
- **Proxy:** a low-resolution copy of an asset used for preview.
- **Candidate:** a generated, not-yet-accepted result (for example a jump-cut edit list).
- **Edit list:** an ordered list of source ranges that describes a sequence without rendering it.
