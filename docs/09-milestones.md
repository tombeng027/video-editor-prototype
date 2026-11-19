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
**Entry gate:** the owner has chosen to proceed toward a demoable editor while deferring the remaining stabilization gate. K24/K26 remain partial, and the owner's manual K17 check found Tab/Shift+Tab traversing menus and Escape doing nothing; these are not being marked as passing. Keep their gaps visible in [Review Plan](./16-review-plan-and-system-status.md), and do not describe the product as release-ready.

Diagnostics stabilization: documentation now distinguishes targets from implemented behavior. Windows launcher retention/configuration and terminal storage warnings passed local and hosted safety checks; the engine now also persists bounded, allowlisted structured diagnostics locally. K29's partial-failure and accurate-accounting fix is verified locally; fresh hosted verification remains pending. In-app storage warnings, periodic monitoring and cleanup/recovery controls remain pending (K21); this does not imply a complete diagnostics/settings feature. Optional real owned-Ollama lifecycle verification and fresh hosted verification of the newest local slices remain pending.

The specialist review findings have maintained lifecycle/collision/cleanup regressions and safe media/export test teardown. The owner accepts proceeding with product work before every stabilization item is closed; this does not change the recorded K24/K26 or K17 status. The modal slice adds development-only Testing Library/jsdom dependencies; no saved-schema migration or AI infrastructure is needed. Planned features are not defects and should not become an unlimited stabilization scope.

Demo-media progress: still-image import/insertion/preview, visual clip movement with snapping and cross-track dragging, visual edge trimming, adding, reordering and removing empty visual/audio tracks, unused asset removal, layered preview, layered video/image export, and dedicated audio rows with placement, move/trim, mute/reorder, synchronized preview, and loop-on-extension export are implemented with focused local coverage. Undo/redo is implemented with engine-confirmed inverse-command history. Missing-media relinking restores matching original-media references without automatically preparing proxies. The owner has accepted the basic relink and asset thumbnail/context-menu flows; full edge-case acceptance remains separate. Autosave/backup recovery now has explicit status and recovery guidance. Other M3 work includes broader track management and error/loading states.

- Audio clip movement and trim are implemented.
- Timeline navigation supports manual horizontal scrolling during playback, an explicit Follow playhead toggle, deeper 0.01-400 px/s zoom, Fit timeline and hour-aware rulers for long videos. Focused local coverage is separate from owner acceptance.
- Missing-media relink flow is implemented for matching original-media fingerprints; the owner confirmed the basic relink flow works. Asset thumbnail cards and right-click actions are implemented and owner-approved. Autosave/backup-recovery polish now distinguishes pending, unconfirmed, rejected and failed edits, offers explicit retry for confirmed save failures, and keeps backup recovery guidance visible; focused validation and manual acceptance are tracked separately.
- Broader track management.
- Track renaming and lock/unlock are implemented for visual/audio rows with autosave and engine-confirmed Undo/Redo; manual acceptance remains pending.
- Error and loading states in every pane.
- Import/preview feedback polish now distinguishes active imports from uncertain recovery, displays queued/running/failed preview preparation and offline Relink guidance, offers right-click thumbnail reload, and explains pending-edit control locks. Manual acceptance and remaining stabilization gaps are separate.

### Next priority - Fast time-to-edit for long video

**Direct-source playback and optional optimization controls implemented; representative long-video acceptance pending.** Complete that acceptance before moving to M4: editing supported originals must not wait for full-video conversion. The three-hour high-resolution workflow demonstrates why lowering proxy resolution alone is insufficient.

1. Direct-source video preview, independently loaded thumbnails, actual decode/readiness checks and bounded actionable fallback.
2. Auto preview policy with optional background proxies, explicit prepare/cancel/retry, compatible cache reuse and safe paused source switching. Deliver and measure these first.
3. If measurements require it, separately design demand-driven playable segments for unsupported/slow sources.
4. Tune preview profiles, encoding/hardware paths and background resource budgets using measured evidence, preserving original-source export.

Phases 1-2 now provide original/silent-video range playback, independent original thumbnails, a five-second initial decoded-frame deadline, project-guarded prepare/cancel/retry, cancellation settlement, existing-cache reuse and paused-only proxy adoption. Import/open/relink no longer queue conversions. Profile/format-version cache invalidation, automatic performance detection, segments, selectable quality/hardware tuning and broad latency certification remain deferred.

See [Preview and Export: fast time-to-edit](./05-preview-and-export.md#approved-next-priority-fast-time-to-edit) for implementation boundaries, proposed latency targets, acceptance coverage and interruption risks. These remain targets, not verified long-video performance claims. The owner closed the project before implementation; do not reopen or encode their long source as an automated test.

### Properties before M4 (owner-approved)

- Implemented first slice: resizable Properties immediately right of Preview, with the hideable Assistant farther right; selection-driven clip info, source trim, static zoom/center/opacity and reset. Visual changes apply to video/images in preview and original-source export, autosave, support Undo/Redo and respect track locks. Older layouts receive a default properties width; existing assistant visibility is preserved. When space is tight, side panes share the available width while preserving saved preferred sizes and a usable Preview; hiding Assistant restores that room. Manual acceptance remains separate from focused local checks.
- Implemented next slice: saved forward 0.25x..4x speed on video/audio clips, pitch preservation, duration/source mapping, speed-aware trim/split, all-later same-track ripple, autosave and exact Undo/Redo. Other tracks remain fixed; still images remain 1x. Whole-frame rounding has explicit split rejection when no source boundary preserves both halves. Focused local tests include synthetic real FFmpeg frame/color/pitch checks; manual long-video acceptance remains pending. The transport speed control remains preview-only and is not exported.
- Owner-approved priority before animations: [error catalog and recovery usability](./18-error-catalog-and-recovery.md). Initial edit/save slice implemented: context-aware messages, explained safe actions, explicit not-applied rejection responses, and a bounded temporary unknown-only inbox with persistent local development tasks. Focused API/storage/recovery checks pass; manual desktop acceptance requires relaunch. Investigate/catalog/test each unknown during subsequent development; remove matching records only after verified resolution. Existing diagnostic logs remain separate. Extend the pattern to import/preview/export afterward.
- After recovery usability, design and implement entrance/exit animations, including durations and preview/export consistency (implemented; see below). Between-neighbor transitions such as crossfades were later deferred by the owner (2026-11-05); animations stay per clip. No nonfunctional animation controls are exposed.
- Implemented import recovery adoption: operation-specific catalog notices, per-file partial results, explained receipt/review controls, unknown-only durable follow-ups and specific duplicate/path/access codes. Recovery retains duplicate guards and explicit review; generic import failure envelopes still create investigation tasks. Desktop acceptance requires relaunch. Preview/export recovery adoption remains next.
- Implemented preview recovery adoption: distinct offline/permission/format/decode/network/readiness guidance, preparation/cancellation/status catalog contexts, collapsed raw details and unknown-only development follow-ups, including off-timeline optimization failures. Unconfirmed preview job requests remain gated until a successful status refresh without locking timeline editing. Guidance is below the canvas to avoid obscuring it. Owner reports the preview test walkthrough passes after relaunch (2026-11-03); this is not broad codec certification.
- Implemented export recovery adoption: rejected starts, uncertain start/status/cancellation, known cleanup/duration failures and unknown background failures use contextual catalog notices and sanitized local follow-ups. Immediate replies, polling and cancellation must identify the same export attempt before adoption; lost cancellation replies prevent repeated cancellation until status is confirmed. Busy-export inspection is explicit. Help/manual guidance updated; desktop export acceptance remains pending after relaunch.
- Owner reports the export recovery walkthrough looks good (2026-11-03); this is not exhaustive failure-path or codec certification. The subsequent [export settings slice](./05-preview-and-export.md#export-settings-implemented) is implemented locally: MP4/H.264, project or selectable output fps including 60/fractional rates, aspect-preserving project/720p/1080p/4K resolution and three quality presets. Output conversion preserves project timing; resolved settings follow the attempt through recovery, and ffprobe verifies codec/size/rate/duration before publication. Focused automation is separate from pending desktop settings acceptance after relaunch. Other codecs and custom dimensions remain deferred.
- Implemented supporting [offline Help](./19-in-app-help.md) on Projects and the editor: About/version, task guides, available/limited/planned features and searchable live edit/save, import, preview and export error definitions. Development follow-up records remain separate.
- Owner reports a 1080p / 60 fps export looks good (2026-11-03). This accepts that tested output combination, not every preset, default export, cancellation or failure/recovery path.
- Owner priority update (2026-11-03): defer the dedicated unknown-error inbox review and plan animations/transitions next. Keep existing records and automatic recording intact; do not clear unresolved tasks. Investigate errors that block the active work, but do not make a broad inbox review a prerequisite for animation planning.
- Resume M4 after these owner-prioritized editing slices; demand-driven preview segments and tuning remain evidence-driven, not automatic prerequisites.

### Animation catalog - approved starter scope

**Status: implemented locally; desktop acceptance pending after relaunch (2026-11-05).** Five entrance
and five exit presets for video/still-image clips. None is a separate choice,
not one of the five. Each end has an independently selected preset and duration.

| Entrance | Stable catalog ID | Exit | Stable catalog ID |
|---|---|---|---|
| Fade in | `entrance.fade` | Fade out | `exit.fade` |
| Zoom in | `entrance.zoom` | Zoom out | `exit.zoom` |
| Slide from left | `entrance.slide-left` | Slide to left | `exit.slide-left` |
| Slide from right | `entrance.slide-right` | Slide to right | `exit.slide-right` |
| Rise from below | `entrance.rise` | Drop downward | `exit.drop` |

Use one shared animation catalog for selection, readable descriptions, defaults,
supported parameters and preset behavior/version. Persist stable IDs and versions,
not display names or UI list indexes. Preview and export must consume the same
timing/evaluation contract, rather than separately authored look-alike effects.
New presets can extend the catalog over time; existing saved presets must retain
their meaning. This animation catalog is distinct from the error catalog.

Entrance effects settle at the clip's normal appearance; exits begin there and
leave it. Preserve saved static appearance and clip speed, compose animation with
those properties, and keep effects inside the clip's timeline duration without
silently moving neighbors or changing source trims. The implemented
[timing contract](./05-preview-and-export.md#entranceexit-animation-catalog) defines
percentage-of-clip lengths (default about 0.5 seconds), smoothstep easing,
80%-to-normal zoom, off-canvas slide endpoints and non-overlapping windows.

Owner feedback (2026-11-05): percentage animation lengths on one shared two-handle
bar, appearance/speed sliders with − / + are implemented locally; Properties Trim
was removed as a duplicate of timeline edge trimming. Desktop acceptance pending.

Delivered scope and remaining boundary:

1. Shared catalog, saved schema/commands, preset/timing contract and short-clip
   duration validation are implemented.
2. Properties selection, removal/None, autosave and exact Undo/Redo are wired with
   track locks and existing recovery safeguards. Handle trim, split and speed
   edits consistently; reject or explain invalid durations rather than silently
   dropping effects.
3. Matching preview/original-source export, focused synthetic frame checks,
   Help/catalog content, rejection guidance and manual steps are implemented.
   Desktop owner acceptance is still pending.
4. Two-point zoom (owner-approved 2026-11-05) is implemented locally; desktop
   acceptance pending. One zoom range per clip with a two-handle bar, Set start/end
   at playhead and start/end scale sliders. Before the start point the clip uses the
   start zoom; after the end point it holds the end zoom, with smooth easing between.
   Zoom centers on the clip's saved position, composes with appearance and
   entrance/exit animations, and matches in preview and export (real-FFmpeg frame
   check). Points follow trim/speed; split keeps the motion exact. Timeline diamond
   markers show the points (live during drags), and clicking empty timeline space
   keeps the clip selected. Focus-point picking and multiple ranges are planned
   separately in [future features](./10-future-features.md#multiple-zooms-per-clip-planned-not-scheduled).
5. Crossfades deferred (owner decision 2026-11-05): animations stay strictly per
   clip; a clip's exit plays, then the next clip's own entrance (or none). Neighboring
   crossfades are a much-later optional idea in [future features](./10-future-features.md#crossfades-deferred).
6. Split audio and Escape to deselect (owner-approved 2026-11-05) are implemented
   locally; desktop acceptance pending. The video clip is muted, its sound moves to a
   free or new audio track as an independent clip, in one Undo step.
7. Timeline-as-truth audio (owner decision 2026-11-05) is implemented locally;
   desktop acceptance pending. Every stacked visual clip's own sound plays in
   preview and is summed in export (previously export kept only the top clip's
   sound). Video/overlay tracks gained Mute, which silences sound but keeps the picture.
   Audio-track clips are also summed at full level (2026-11-19 fix: the final mix had
   divided every input by the clip count, making exports with many audio clips very quiet).
   Audio clips that end at the end of their file no longer replay trimmed-away audio in
   export (2026-11-19 fix: only clips running past their file loop; real-FFmpeg regression).
8. Canvas editing (owner-approved 2026-11-05) is implemented locally; the owner
   tried it on the desktop on 2026-11-05 and reported it works (general acceptance,
   not a step-by-step checklist pass). Preview placement is verified against export by a
   real-FFmpeg pixel check. Click selects the top-most picture; drag moves it;
   corner handles resize proportionally; snapping guides align to canvas edges,
   center and other pictures (Alt or the Snap toggle to bypass). Canvas edits pause
   playback first. Right-click layer order moves the clip between visual tracks
   (inserting one when needed) as one Undo step. Free resize and crop are backlog
   in [future features](./10-future-features.md#canvas-free-resize-and-crop-backlog).

9. Frame stepping (owner-approved 2026-11-09) is implemented locally; desktop
   acceptance pending. Previous/Next frame buttons and unmodified Left/Right arrows
   pause and move one project frame, bounded to the first/last included frame.
   Form controls, splitter keys and Help/Export dialogs retain keyboard behavior.
   This is navigation only, not a saved edit. The crop plan is in
      [future features](./10-future-features.md#crop-plan-2026-11-10).
      Crop interaction choices were approved on 2026-11-10: button toggle and
      right-click Crop section, Free-form or project-aspect-locked modes, Properties
      fields and canvas handles. Data/commands, rendering and controls are now
      implemented locally; desktop crop acceptance is pending. Auto-captions follow crop
      (see [Captions Concept](./15-captions-concept.md)). Free resize and multiple
      zooms remain deferred.

10. Canvas aspect controls (owner-approved 2026-11-10) are implemented locally:
       Preview offers 16:9, 9:16, 1:1 and 4:3, changing the project canvas and export
       together through `SetProjectCanvas`, with autosave and Undo/Redo. Existing clip
       edits stay unchanged and media refits. All four MP4 dimensions and fitted
       letterboxing are verified with real FFmpeg; desktop acceptance remains pending.
       Crop rendering and controls are implemented locally (items 11 and 13).

11. Saved crop rendering (2026-11-10, local) now runs before fit/transform/motion
    in both Preview and FFmpeg. Canvas bounds, hit-testing and resize snapping
    use the retained source aspect. Source-pixel rounding and asymmetric odd-pixel
    image/video crops are covered by geometry and real-export pixel tests, including
    zoom/fade and portrait/landscape canvases. Controls are described in item 13.

12. Fit to canvas (owner-approved 2026-11-10, implemented locally) is available
    beside Preview and in the picture's right-click menu. It centers the selected
    visible picture and resets base scale to 100%, preserving opacity, crop and
    effects, through the existing appearance command and history. The owner
    confirmed Fit works. The owner reported a short export looks good after the handle
    fix; this is general acceptance, not full effect/export certification.

13. Crop controls (owner-approved, implemented locally): Preview toggle and a
    right-click Crop section share Free-form/Project aspect locked modes with
    Properties. Four edges/four corners preview drafts and commit one command on
    release; Escape/cancellation discards the gesture. Properties has source-percent
    fields, Apply/Reset/Cancel draft. Lock uses source pixels and the project ratio
    on the next crop edit. Existing transforms, effects, timing and audio survive.
    Focused automation is passing; desktop and short-export crop acceptance remain
    pending. Captions infrastructure is the next planned feature after acceptance.

14. Crop interaction/menu correction (owner-requested): crop now trims edges in
    place, keeping the original source footprint/anchor in Preview and export
    instead of refitting the crop. Active Crop excludes move/resize/Appearance/Fit
    and cancels any pending transform gesture. The canvas right-click menu is a
    viewport-clamped body portal, no longer clipped by the Preview. This supersedes
    the initial crop refitting contract; saved insets are unchanged. Desktop
    acceptance of the correction remains pending.

15. Caption foundation (owner-approved, implemented locally): one plain-text
    `captionCues` lane outside media tracks, safe integer start/exclusive-end
    project frames, nonblank text up to 2000 characters and no overlap. Add/set/remove
    commands autosave with exact inverses and atomic-batch validation. Manual cues
    stay timeline-fixed through media edits; FPS adoption/change is blocked when
    cues exist. New projects/saves use schema v2; v1 loads migrate in memory with
    an explicit notice and existing backup-safe saves. Unsupported versions are
    rejected without falling back to an older backup. The owner accepted crop
    controls before starting this slice.
16. Manual caption workspace and Preview (implemented locally; owner testing
    deferred until UI availability): collapsed cue-density strip below the media
    timeline, shared zoom/scroll/playhead, chronological text list and frame-exact
    selected-cue editor. Add/apply/delete, drag move/retime, split and merge use
    confirmed autosave/Undo/Redo without changing media selection or clips.
    Preview draws saved plain multiline text with fixed styling. Editor playback
    includes later cue ends; exports remain media-only with explicit warnings.
    SRT/burn-in, styling controls and auto-generation remain unavailable.
    Next planned slice is SRT import/export and burned-in output.

A future custom animation editor is an exploratory idea, not approved build scope.
Keep the catalog data-driven and behavior versioned so it can grow, but do not
build a plugin framework, arbitrary scripting or a general keyframe editor now.
See [future animation editor](./10-future-features.md#custom-animation-editor-concept-only).
Unknown-error inbox review (2026-11-05): the desktop engine data directory has no
inbox file, so no unknown error has ever been recorded (a missing file reads as an
empty list; any record or resolution would create it). Nothing to investigate;
automatic recording stays enabled for future unknowns.

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
