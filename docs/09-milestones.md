# 9. Milestones

[Back to index](./README.md)

Each milestone should leave the app in a working state.

## M1 - Foundation
- pnpm monorepo with `apps/desktop` (Electron), `apps/client`, `apps/engine`, `apps/vision` (stub), `packages/schema`, `packages/timeline-core`.
- Electron shell that launches the engine and loads the client, with a minimal preload API.
- Zod schemas for project, commands and API payloads.
- `timeline-core` with the time helpers and the first commands (SetProjectFps, AddAsset/RemoveAsset, AddTrack/RemoveTrack, AddClip, TrimClip, SplitClip, RemoveClip) and their tests. MoveClip, SplitAudio, SetClipTransform and InsertSequence come in later milestones.
- Vitest, lint and typecheck set up across the workspace (see [Testing and Settings](./12-testing-and-settings.md)).
- Engine skeleton with health endpoint, session token and Origin check, and component diagnostics.
- Client shell: landing screen and the editor's resizable four-pane layout with placeholders.

**Done when:** client talks to the engine with the token, the layout resizes, and schema and `timeline-core` tests pass.

**Status: complete.** The vision stub serves `/health` on Python 3.12 (pinned `>=3.11,<3.13`, since the machine's Python 3.14 is likely too new for torch and CLIP wheels) and the engine reports it as `ok`.

## M2 - Manual vertical slice
Acceptance is split into three parts:
- **Import and proxy:** import a video, probe metadata, generate a proxy, show progress and errors.
- **Playback and split:** place a clip on one track, scrub, play in the preview with the shared clock, split.
- **Save/open and export:** create, save and open a project folder with atomic writes, and export an MP4 with progress.

**Done when:** a user can import, split, save, close, reopen and export a correct file.

**Progress:**
- Slice A (project folder, atomic save/open with backup recovery, recent projects, folder dialog, new-project form with frame rate and resolution, engine parent-exit watchdog): complete.
- Slice B step 1 (ffprobe import by reference or copy, duplicate detection, 540p CFR proxies with progress, range-served media, assets pane, media picker): complete.
- Slice B step 2 (one-track timeline with ruler, zoom and scrubbing; shared playhead clock; `<video>` preview; add to timeline, split and delete in the UI; Space, S and Delete shortcuts; 0.5x-2x speed): complete.
- Slice C (render plan, FFmpeg export with progress, cancel and verified output; offline-media check K7; real save status in the top bar; Export dialog): complete. **M2 is complete.**

## M3 - Timeline usability
- Multiple tracks, move, trim, snapping, remove.
- Undo and redo with gesture coalescing.
- Missing-media relink flow, autosave, backup recovery.
- Error and loading states in every pane.

**Done when:** the invariants hold under a command test suite and the editing flows feel reliable.

## M4 - Conversational assistant
- Ollama streaming chat through the engine.
- System prompt for editing guidance, a conversational-only toggle.
- Component readiness display for Ollama.

**Done when:** chat works and the assistant cannot modify the project.

## M5 - Action proposals
- Versioned action schema and engine validation.
- Action card UI with confirmation.
- Command execution path from the card, AI label in undo history.
- Prompt evaluation set for valid, ambiguous and invalid requests.

**Done when:** a valid request produces a correct action card, and invalid ones produce clear errors without side effects. Execution can be tested against a stubbed analysis.

## M6 - Jump-cut candidates
- Python vision service with CLIP scoring.
- Analysis job with progress and cancel, score caching.
- Window building, edit list candidate, preview rendering.
- Candidate review UI with sensitivity control, then `InsertSequence`.
- Labelled evaluation clips for tuning.

**Done when:** the keycap example produces a reviewable candidate that can be inserted into the timeline with one undo step.
