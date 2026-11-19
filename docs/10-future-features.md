# 10. Future Features

[Back to index](./README.md)

This document tracks current prototype issues as well as deferred features. Future features below are not implemented unless explicitly marked.

## Known limitations backlog

Found during foundation and later slices. Review their acceptance gates before expanding or distributing the prototype.

| # | Limitation | Plan |
|---|---|---|
| L1 | ~~Engine cleanup on a force-killed shell~~ | **Resolved in M2 Slice A:** stdin-close watchdog (`ENGINE_EXIT_WHEN_PARENT_GONE`), verified by force-killing the shell on Windows |
| L2 | The desktop shell needs the Vite dev server running; no packaged build | Packaging when feedback requires installable builds; not an already scheduled milestone |
| L3 | No native file dialogs or drag-and-drop paths | Folder picker (Slice A) and media picker (Slice B) done; drag-and-drop paths still to do |
| L4 | Engine falls back to the token `dev-token` if `ENGINE_TOKEN` is unset | Refuse the default outside dev mode |
| L5 | `/health` spawns FFmpeg on every call | Cache the probe result for a short TTL |
| L6 | React component coverage is limited to modal/creation/export interaction; no tests for Electron `main.ts` | Modal interaction tests now exist; expand to remaining editor flows and Electron lifecycle/native IPC |
| L7 | No Host-header validation (DNS-rebinding hardening) | Optional; the token already blocks this |
| L8 | Export uses one FFmpeg input per clip, so a timeline with several hundred cuts exceeds the Windows command-line limit (refused with TOO_MANY_CUTS). Overlapping tracks are not composited either. | Switch to a filter script file (needs newer FFmpeg in CI) or a segment-by-segment render with concat in M3 |

## Legal and publication readiness backlog

These R entries track publication/integration prerequisites, not demonstrated runtime defects; they do not change the K/L issue counts. Reassess them in every full review and whenever a trigger below is reached. The [Review status](./16-review-plan-and-system-status.md#legal-and-publication-gate-status) records the current stage and proceed/hold decision. This is risk tracking, not legal clearance.

| ID | Requirement | Trigger / acceptance gate | Current status |
|---|---|---|---|
| R1 | Choose a license for original code and documentation and establish contribution terms | Before describing the repo as licensed open source, encouraging reuse, or accepting external contributions: owner approves the license; add its unmodified standard text with appropriate notices, document scope/exclusions and align applicable manifest metadata. Confirm contribution rights. | Verified 2026-10-12: Apache-2.0 standard text, scope/notice, JS/Python metadata and contribution terms published through `8866a97`; copyright template fields replaced with `Copyright 2026 tombeng027` in focused commit `5c6e852`, pushed to main. Earlier live recognition confirmed. Recheck provenance on each contribution; binary/model gates are separate. |
| R2 | Independent branding and accurate public claims | Before new promotion, demos or sponsor pitches: verify About/README/marketing against implemented features, distinguish planned AI and avoid implied affiliation with third-party brands. | Corrected source wording published through `8866a97`; live About and remote synchronization rechecked on 2026-10-12 at 12:34 review. Target claims and historical archives are labelled; minor remaining status/estimate wording corrected in the review follow-up. Check each new demo/pitch. Not trademark/legal clearance. |
| R3 | Third-party software and binary compliance | Before any downloadable build, including alpha/beta: inventory exact shipped dependencies/binaries, retain applicable licenses/notices and meet source-availability obligations. Inspect Electron/Chromium notices and the exact FFmpeg build/codecs; evaluate codec-patent/distribution questions for intended markets. | Open, before distribution; FFmpeg currently runs externally, not bundled. Source-only development is not binary-release clearance. |
| R4 | Exact AI model/artifact rights and conditions | Before integrating, automatically downloading or redistributing models: record source/version, license, required attribution/use conditions and evaluation limits. Runtime licenses do not cover every model. | Open, before M4-M6 integration; planned Qwen3, Llama 3.1 and CLIP artifacts are not cleared. |
| R5 | Demo/support media rights and privacy boundaries | Before publishing demos or collecting support data: verify footage/music permissions and applicable personal-data basis; redact paths/tokens/personal information, disclose collection/retention and describe local-processing/network limits accurately. | Open, before demos/support collection; no blanket privacy or media-rights clearance. |

Owner confirmed on 2026-10-12 that the original project/specs/prompts are their own, without proprietary or employer/client material. This is a provenance declaration, not exhaustive verification of generated code or third-party rights. For a Philippine maintainer, adding an open-source license ordinarily does not require filing an application; copyright registration, trademarks and third-party permissions are separate matters. Obtain qualified counsel when a material rights or distribution question cannot be resolved from the applicable terms.

## Known issues

Current defects and reliability gaps, including significant data/job risks as well as smaller usability problems. Priorities and acceptance gates below determine fix order; not every issue is a cheap cleanup.

Before fixing a listed issue, use [QA and Fix Readiness](./17-qa-and-fix-readiness.md) to verify the diagnosis, agree measurable acceptance conditions and reconcile them with the engineering plan. Keep issue IDs and status authoritative here; that reference does not introduce a second backlog.

| # | Issue | Impact | Plan | Status |
|---|---|---|---|---|
| K1 | An engine started from a shell whose PATH predates the FFmpeg install reports FFmpeg as unavailable. | Dev only; a fresh shell or the Electron app is fine. | Show a "restart your terminal or set `FFMPEG_PATH`" hint in diagnostics when FFmpeg is missing. | Open |
| K2 | The "Frame rate" select and the "use first video's frame rate" checkbox shared a label. | Accessibility and testing. | Reworded the checkbox label. | Fixed |
| K3 | The native folder and media pickers were only checked through the bridge, not by clicking them. | Low. | Check manually once; add an IPC test seam if it breaks. | Open |
| K4 | Real-FFmpeg tests are skipped when FFmpeg is not on PATH, so a stale shell reports green with fewer tests run. | Hidden loss of coverage. | CI installs FFmpeg (confirmed: CI run 4 passed with the install step). Tests now print a skip warning locally and fail in CI if FFmpeg is missing. | Fixed |
| K5 | A stale engine from an earlier session can keep port 7878, so a new engine fails with `EADDRINUSE` while the old one answers requests. | Confusing dev failures; wasted time during the Slice B live test. | Print the port owner hint on `EADDRINUSE`; consider a random free port when launched by Electron (already the case) and a clear message in dev. | Open |
| K6 | The proxy can be one frame shorter than the asset's computed duration (179 vs 180 frames). | The preview could show a frozen or black last frame. | Preview clamps to the proxy's real duration; verified live. | Fixed |
| K7 | Media is not verified when a project opens, so a moved or deleted source file is only discovered when it is used. | A missing file would break preview and export with an unclear error. | On open, check each asset path and flag missing ones as "offline" in the assets pane; export refuses with a clear list. | Fixed in Slice C: the engine reports offline assets (/project/media-status); the client flags them in the assets pane and timeline, blocks Add to timeline, and export refuses with the file names |
| K8 | In copy mode the file is copied before the command batch is committed; if the batch fails, an orphan copy stays in `media/`. | Wasted disk only. | Track newly owned copies and delete only those on rejected/failed commit; surface deletion failure. | Fixed locally: rollback and cleanup-failure regressions; committed copies and existing files are preserved |
| K9 | A proxy that finishes after its asset was removed fails `SetAssetProxy` with `NOT_FOUND` and shows as failed. | Harmless noise. | Treat `NOT_FOUND` as "cancelled". | Open |
| K10 | No project schema migration path yet. | None until the schema changes after projects exist. | Version 1 is currently checked; add a migration hook before the first saved-schema change, whether required by M3, candidates or captions. | Open, before schema change |
| K11 | The `S` and Delete shortcuts were ignored while a toolbar button had focus (for example right after clicking Split or Play). | Shortcuts seemed to stop working until the user clicked elsewhere. | Only Space is left to a focused button; covered by unit tests (`shortcuts.test.ts`). Found in the pre-Slice C review. | Fixed |
| K12 | Edits are planned from the client's last known project, so two quick edits (for example `S` pressed twice) can send a stale second batch. | The engine rejects it safely, but the user sees a spurious error. | Serialise edits in the editor (queue, plan at send time); do it with undo/redo in M3. | Open |
| K13 | Every command batch rewrites `project.json` and copies the previous file to `.bak`. | Fine for click edits, wasteful for drag edits. | Coalesce or debounce autosave in the engine before M3 drag editing. | Open, before M3 |
| K14 | The top bar shows a fixed "Autosaved" label; a failed save only appears as a message in the timeline toolbar. | A save failure is easy to miss. | Real save status in the top bar (saving, saved, failed) with the export UI work. | Fixed in Slice C (saving, autosaved, save failed) |
| K15 | Quick-start shutdown selected all Electron processes and fixed-port owners; startup accepted any listener and continued after timeout. | Could stop unrelated apps or report readiness incorrectly. | Per-project PID/creation-time ownership including descendant creation checks, graceful desktop close, resilient cleanup with exit waits, client/window readiness, duplicate refusal and reverse-order startup rollback; integration tests and Windows CI. | Fixed locally and verified in hosted Windows CI after K34 setup correction; optional real owned-Ollama test remains pending |
| K16 | Export start reserves the job only after asynchronous validation; cancellation during output verification can still finalize the file; reset during preflight does not stop job start. | Concurrent jobs, obsolete-project jobs or unexpected successful output after cancel. | Reserve before validation, bind generation, check cancellation through finalization and settle child/file cleanup before forgetting jobs. | Fixed locally: concurrent/preflight/probe/finalization/shutdown regressions; cancelled work cannot publish success; cleanup failures are coded |
| K17 | Editor keyboard shortcuts remain active behind the export modal; export start preflight can be dismissed before running state arrives. | S or Delete can autosave unintended edits; a late export start can be hidden behind a closed dialog. | Shared native modal, background shortcut gate, focus containment/restoration and guarded start phase. | Component regressions and hosted JS CI pass, but owner manual test on 2026-11-03 reports Tab/Shift+Tab traversing app menus and Escape having no effect. Treat native/browser focus acceptance as failed pending reproduction and resolution; do not infer it from component tests. |
| K18 | Export polling/cancellation and default-folder lookup failures are silently ignored. | Stuck progress or unexplained missing default location. | Explicit errors and retry states. | Verified locally: coded poll/cancel failures, explicit status retry, non-overlapping polling, obsolete-response/unmount guards, guarded cancel/cleanup acknowledgement and 15-second recovery deadlines. Default-folder warnings were already fixed. Later correlated export-start recovery is recorded under partial K24 |
| K19 | Client blocks export for any offline asset; engine only blocks assets used by the render plan. | Unused missing media prevents an otherwise valid export. | Share the used-asset rule. | Verified locally: shared render-plan IDs, used/unused/audio-only/hidden/gap policy regressions; engine file preflight retained |
| K20 | Test cleanup could read a user's newer launch state; failed shutdown could lose child ownership, and launcher errors lacked a recovery catalog. | Unexpected session shutdown, stranded children, difficult troubleshooting. | Block normal launches during tests; cleanup captured test identities only; persist descendant identities before stop; coded local diagnostic logs and recovery guide. Command-name FFmpeg inference and malformed state validation fixed too. | Fixed locally and verified in hosted Windows CI after K34 setup correction; optional real owned-Ollama verification pending |
| K21 | Logs can grow beyond a storage target, and the editor has no storage-warning UI. | Disk pressure may go unnoticed between launcher operations. | Session logs, conservative retention and terminal warnings first; then periodic in-app warnings with usage/configuration and Open logs / Preview cleanup / Retry controls. | Launcher retention/terminal warnings and bounded engine structured logs are implemented and tested locally; in-app storage monitoring and cleanup/recovery controls remain pending |
| K22 | Import captures the starting folder/project before asynchronous probing/copying, but commits against whichever project is open later; concurrent imports each capture a stale duplicate set. | Switching from A to B can insert A's media into B; simultaneous imports can register duplicate content and copy-target selection can race. | Bind import, commit and proxy callbacks to project opening generation; serialize imports and allocate copy targets exclusively. | Fixed locally: switch/close/same-folder reopen, queued commit, duplicate/collision and stale-proxy regressions; PROJECT_CHANGED returns HTTP 409 |
| K23 | Saved-project parsing checks shapes, not relational timeline invariants. | A structurally valid file with missing asset references, reversed ranges, duplicate IDs/orders or overlaps can open and break editing/rendering. | Shared project-invariant validation on load/save and atomic command batches. | Fixed locally: invalid relationship/range/ID/order/overlap/track/transform/link fixtures rejected; validated backup fallback and unchanged-state/write tests pass |
| K24 | Failure-edge coverage remains incomplete across editor API calls and media/proxy refresh/reconciliation; operation recovery is in-memory and cannot establish outcomes after engine restart or record eviction. | An operational failure may be hard to distinguish from an empty result or stale state; an unresolved mutation must not be blindly retried. | Keep typed results and bounded request deadlines consistent across API calls; exercise timeout, transport, malformed-response and stale-snapshot failures through UI recovery paths. Preserve conservative operation recovery when authoritative status is unavailable. | Partial/local: all 16 client API wrappers have focused transport, non-JSON HTTP, invalid-success, 15-second timeout/abort, and stalled-body coverage. UI tests cover retry/reconciliation, stale media snapshots, stale recent/default-folder responses after engine configuration changes, import/command status retry after transient status-read failures without resubmitting, and a delayed refresh across same-project close/reopen. A typed/cleared location is not overwritten by a delayed default. Picker rejection/late-selection guards, media-status identity/revision guards, proxy reconciliation, preview retry and K32 clip-boundary handling are separately verified. Remaining: broader media/API edge review and manual platform acceptance; engine operation records are bounded and non-durable. |
| K25 | Export output name is unique only to the second. | Rapid successive exports can reuse the final/partial path; replacement or rename failure is platform-dependent. | UUID job/output identity and exclusive hard-link publication on the same volume. | Fixed locally: same-clock exports remain distinct and an occupied output is never replaced; unsupported hard-link filesystems fail explicitly |
| K26 | Expected-domain failures are not consistently surfaced/correlated, and safe redaction/capture guarantees do not cover every existing log and response path. | User-correctable failures may lack actionable codes; diagnostic output may expose details outside the new structured engine records. | Define coded outcomes for expected failures where recovery needs them; verify UI correlation and privacy boundaries separately for structured diagnostics, responses and legacy/component logs. | Partial/local: unexpected route and selected project/background/import/export failures use coded responses or status with server diagnostic IDs; structured engine JSONL/stderr records use allowlisted metadata and bounded retention. UI consumers retain validated IDs, and health recovery details display inline. Expected-domain coverage and broad redaction/capture guarantees remain open; see the K26 acceptance gate in the run guide. |
| K27 | Recent-project bookkeeping can fail after create/open changes the session; saving a backup-recovered project copies corrupt main data over the usable backup before replacement succeeds. | UI can report failure while the engine switched projects; failed recovery-save can lose the only valid backup. Backup-only projects are disabled in recent list despite being openable by folder. | Separate bookkeeping warnings from core outcome, preserve validated backup through replacement and align recent availability with recovery. | Fixed locally: nonfatal API/editor warnings, backup-only availability, damaged-index preservation, injected write/replace failures and retry tests; power-loss/multi-engine guarantees not claimed |
| K28 | Layout limits are per pane, not constrained by window width/height. | Maximum saved pane sizes can exceed the minimum desktop window, leaving no useful preview or pushing content offscreen. | Viewport-aware clamping/rebalance and minimum/default-window manual/component tests. | P3, source-confirmed geometry; visual verification pending |
| K29 | Retention reports warnings but exits successfully after partial cleanup; usage stays pre-deletion on failure, metadata writes are non-atomic, and file handles are released before deletion. | Automation/UI cannot reliably distinguish completed cleanup from partial work; a later deletion failure can leave metadata-less logs protected indefinitely. The lock check is not a lifetime guarantee. | Explicit partial/failed result and exit semantics, accurate remeasurement, metadata-last deletion/atomic writes and failure-injection tests; retain conservative active-writer guards. | Fixed locally: completed/partial/failed results and CLI exit codes; actual post-cleanup accounting; atomic close metadata; metadata-last deletion while holding delete-compatible file handles; lock, failure, retry and CLI regressions. Hosted verification remains pending |
| K30 | New-project Cancel and form controls remain enabled during create; completion still calls onCreated after the dialog closes. Native folder-picker waits also leave navigation available. | A user can cancel, open another project or start another create, then a late result opens the earlier project unexpectedly; cancellation did not cancel its filesystem effects. | User chose locked creation until response: disabled form/Cancel, visible non-cancellable state, synchronous duplicate/navigation guards, picker error recovery and shared modal focus policy. | Verified locally and in hosted JS CI run 38203819548: deferred success/failure/picker/navigation tests and warnings preserved; browser acceptance remains earlier local evidence. Request timeout/ambiguous transport recovery remains under K24 |
| K31 | Matching the first imported video's frame rate requires no existing assets, including audio. | Importing audio first leaves the default fps when the first video arrives despite the checked option. | Adopt the first video only while the timeline is empty; plan against authoritative state inside the commit queue. | Fixed locally alongside import serialization: audio-first, mixed, concurrent and reopened imports; nonempty timeline preserves fps |
| K32 | Preview chooses the last clip at end-1 but seeks using the end position; same-source discontinuities use drift tolerance instead of forcing a cut seek. | A trimmed clip can show its exclusive out-frame when stopped; sub-0.25s removed ranges can still appear during same-source playback. | Track source mapping/continuity, hold before discontinuities and clamp to inclusive clip/proxy bounds; real playback/component tests. | Verified locally: four failing-before component regressions; 11 final component cases; decoded-frame colour-fixture browser acceptance for trimmed end, short cut, contiguous split and gap. Boundary hold added after first browser pass exposed one removed red frame. Not all-media/rates/platform frame-exact certification; publication/hosted evidence recorded separately |
| K33 | Proxy unit tests use shared fixed temp names; real import/export suites leave mkdtemp media/project directories behind. | Tests can overwrite/delete a same-named unrelated temp file, interfere across runs and accumulate storage outside log retention. | Unique owned roots, teardown after writer settlement and explicit fixture-removal assertions. | Fixed locally: pass/failure/cancel coverage and existing-file sentinels; no sweep of prior temp folders |
| K34 | Clean dependency installation does not provision Electron 44's executable; Windows CI stops at DEPENDENCIES_MISSING, while an already-provisioned local machine passes. | New developers and hosted launcher checks cannot start the desktop; the old recovery hint only repeats pnpm install. | Explicit desktop setup script and Windows CI installer step; name the missing dependency and its recovery command; include child diagnostics in unexpected test exits. | Verified locally and in hosted CI run 38198160629: clean-install reproduction, explicit installer/repeat invocation and launcher/retention regressions passed. QA severity High; P2; clean-setup/hosted gate passed |

Review priorities and evidence are maintained in [Review Plan and System Status](./16-review-plan-and-system-status.md). Fixed-local statuses describe maintained regression evidence, not hosted CI or released changes.

## Triage

Tiers follow common QA terms. Tier 1 blocks forward work, Tier 2 must be done before the milestone that depends on it, Tier 3 is scheduled cleanup, Tier 4 is fix-if-cheap or accept.

| Tier | Meaning | Items |
|---|---|---|
| Tier 1: Blocker | Project/job and persistence acceptance gates | K22/K16 and K23/K27 fixed locally; no new P1 demonstrated in latest review |
| Tier 2: Major | Fix inside stabilization or before the dependent slice | Remaining K24 mutation/media recovery and K26 diagnostic integration; K12 before undo/redo, K13 before drag editing |
| Tier 3: Moderate | Schedule with the relevant surface | K1, K5, K28, L4, L5, K10 (before first schema change), L8 (export scalability before larger jump-cut sequences) |
| Tier 4: Minor | Fix if cheap, or accept explicitly for the prototype | K3, K9, L3 (drag-and-drop), L6 (add UI coverage with stabilization), L7 (dedicated hardening review before broader distribution) |
| Deferred | Not a scheduled commitment | L2 (packaging when feedback requires installable builds) |
| Resolved | Maintained local evidence; hosted coverage where explicitly recorded | K2, K4, K6, K7, K8, K11, K14, K15, K16, K17, K18, K19, K20, K22, K23, K25, K27, K29, K30, K31, K32, K33, K34, L1 |

Decision: M2 capabilities are implemented; reliability gates are not all closed. Core recovery fixes are published through `cc9d006` with successful hosted CI run 38206315653; the license attribution follow-up is published in `5c6e852`. K18/K19/K32 and the export-start/create/open/picker/import/command recovery, proxy/media/preview refresh paths and bounded K26 diagnostics have local evidence but the newest work is not published. The 2026-11-03 follow-up adds malformed-SSE/reconnect/stale-snapshot regressions, 15-second recent/default-folder deadlines with retry UI, correlated safe diagnostics for export cleanup, and a durable engine-owned structured log; see [Review Plan](./16-review-plan-and-system-status.md). The latest full local gate passed; this K29 follow-up also passed its focused Windows failure-injection and CLI checks, but no fresh hosted or manual platform acceptance was claimed. Remaining K24 work is broader media/API failure-edge coverage; K26 still needs expected-domain/background-error integration and broader redaction/capture guarantees. K29 is fixed locally, with hosted verification pending. K21's in-app warning/cleanup UI and broader M3 expansion remain beyond this stabilization slice. K1 is mitigated by launcher PATH refresh; manual-launch diagnostics remain open.
## Platform
- **Mobile as remote editor:** the client connects to a PC engine over LAN with token auth, using a stacked responsive layout and touch interactions.
- **Standalone on-device editing:** run `timeline-core` on-device with a native media backend; consider a Capacitor or Tauri wrapper. The pure command layer and shared schema are designed for this.
- Cloud sync and project sharing.
- Collaboration.

## Editing
- **Auto-captions with a separate, collapsible caption timeline** (concept note: [Captions Concept](./15-captions-concept.md)); to be built once the prototype is solid
- Text and titles
- Transitions, effects and filters
- Keyframes, speed changes, reverse
- Audio waveforms, volume, fades, beat sync
- Multiple export presets and hardware encoding
- Proxy management and storage cleanup
- Project templates

### Custom animation editor (concept only)

Owner idea recorded 2026-11-05: eventually let users create and reuse their own
entrance/exit animations in the growing animation catalog. This is not implemented
or scheduled, and is not part of the approved ten built-in starter presets in the
[animation plan](./09-milestones.md#animation-catalog---approved-starter-scope).

Before scheduling, design the editable properties/keyframe model, easing, duration
rules, save/rename/delete behavior, local preset storage and portability, version
compatibility, validation and preview/export parity. Decide whether sharing/import
belongs in that release rather than assuming it. Prefer validated declarative
animation data, not executable user scripts. Current planning only reserves stable
preset IDs and behavior versions; it does not commit to a custom-editor architecture.

### Multiple zooms per clip (planned, not scheduled)

Owner feedback (2026-11-05): the current single two-point zoom per clip works and
stays as delivered, but zoom should eventually be addable multiple times at
different parts of the timeline, with a guided workflow. Plan before building:

1. **Guided workflow:** Add zoom starts a new zoom; Set start places a diamond
   marker at the playhead; after moving the playhead, Set end places the second
   diamond; then choose start/end scales.
2. **Multiple ranges:** each zoom has its own points and scales; ranges must not
   overlap. Clicking a range's diamonds selects it for editing in Properties.
3. **Draggable timeline markers** that snap like clip edges.
4. **Optional focus point** so a zoom can target a spot instead of the clip center.
5. **Data:** convert the single `zoom` to a list (a one-item list for existing
   projects, no user-visible migration). Split, trim, speed and export handle every
   range, keeping preview/export parity.

Open questions: should a zoom attach to the timeline and span clips rather than
one clip; between ranges, hold the last scale or return to 100%; adjustable easing.

### Crossfades (deferred)

Owner decision (2026-11-05): keep animations strictly per clip. When a clip ends
with an exit animation, the next clip plays its own entrance as configured, or just
appears. Overlapping neighboring clips (crossfades/transitions) is a much-later
optional idea; it would need overlap, source-handle and duration rules first.

### Canvas free resize and crop (backlog)

Owner decision (2026-11-05): canvas editing ships with move, proportional resize,
snapping and layer order. Stretching a picture without keeping its proportions
remains backlog; crop is now implemented locally as described below. Free resize
still needs separately designed saved X/Y scale data and matching export behavior.

#### Crop plan (2026-11-10)

Crop comes first; free resize stays deferred. The owner approved the interaction
choices below on 2026-11-10. Slices (a)-(c), the data/command foundation,
preview/canvas geometry and export, are implemented locally. Slices (d)-(e) now
add controls, Help and manual checks; desktop crop acceptance is pending.

- **Data:** optional visual-only `crop` on a clip: `{ left, top, right, bottom }`
  as fractions of the source picture (0..0.9 each; `left + right` and `top + bottom`
  each below 0.95, retaining more than 5% of each source dimension). Absent means no crop,
  so older projects need no migration. Audio rows reject it. Invalid values return
  `INVALID_CROP`, now included in the shared error catalog and Help's live list.
- **Order of operations (owner-corrected):** fit the original source and trim
  edges in place without automatic enlargement/recentering, then apply the saved
  transform and animation/zoom around the unchanged source center. Preview,
  `clipCanvasRect` and export share the trimmed bounds and source-pixel rounding.
- **Preview:** an overflow-hidden wrapper shows only the cropped region of the media.
- **Export:** RGBA exact-pixel crop restored onto a transparent original-sized
  footprint before the existing scale: offsets and retained
  sizes are floored to whole source pixels, with at least one retained pixel per
  dimension. Preview/shared geometry use the same source window. A real-FFmpeg
  pixel check verifies placement, removed content, motion and fit.
- **Editing:** `SetClipCrop`, with one Undo step per completed drag.
  Properties has four percent fields plus Apply, Reset and Cancel draft. The canvas has a Crop mode (a
  button toggle, to keep it separate from move/resize) with edge and corner handles.
  The right-click menu also has a Crop section for entering/exiting Crop mode and
  choosing Free-form or Aspect-locked. These are shared controls for the same mode,
  not separate settings. Aspect-locked uses the project canvas width/height ratio;
  numeric fields and handles must both obey the selected mode. Crop edits pause
  playback first, like other canvas edits. Snapping must not break the locked ratio.
  Active Crop mode excludes move/resize, Appearance and Fit; crop only trims
  source edges. Right-click menus escape canvas clipping and stay within the viewport.
- **Out of scope:** rotation, non-proportional resize, animated or keyframed crop,
  and shaped masks.
- **Slices:** (a) schema, command, error code and tests; (b) preview and canvas
  geometry; (c) export and pixel check; (d) Properties and canvas handles; (e) Help,
  docs and manual checklist.
- **Slice (a), implemented locally:** optional `ClipCropSchema`, `SetClipCrop`
  and inverse, visual-track/lock validation, persistence and regression coverage.
  Slices (b)-(c) now propagate crop through every render segment, clip the preview
  media, update canvas bounds/resize snapping and render matching FFmpeg output.
  Controls are now implemented locally; manual UI acceptance remains pending. See the
  [rendering contract](./05-preview-and-export.md#saved-crop-rendering-2026-11-10-local).
- **Canvas aspect controls (owner-approved 2026-11-10, implemented locally):**
  Preview has 16:9, 9:16, 1:1 and 4:3 presets. These change the saved project canvas
  and export shape through `SetProjectCanvas`, not just the preview display.
  Existing clips keep their edits and refit; playback pauses and normal autosave
  and Undo/Redo apply. Presets retain the current long edge where possible,
  rounding down to even exact-ratio dimensions (tiny canvases use the minimum
  even ratio unit). The selected dimensions are displayed. Custom existing sizes
  remain readable and Undo restores them exactly. Aspect-locked crop uses the
  current project ratio on each crop edit.

## AI
- Additional quick actions: silence removal, auto-captions (see [Captions Concept](./15-captions-concept.md)), highlight reels, filler cut, rhythmic or beat-aligned assembly
- Multi-step edit plans with review
- Natural language timeline commands (split, trim, append)
- Model selection and benchmarking per task
- Stronger action detection (video models, optical flow, pose, or object tracking) beyond frame-level CLIP

## Rendering
- GPU (CUDA) acceleration for the vision service, with VRAM coordination against Ollama
- Overlay compositing, static transform rendering and crop are implemented, with canvas editing in Preview; next rotation/free resize ([backlog](#canvas-free-resize-and-crop-backlog)), blend modes and keyframed position/scale/opacity
- Option to switch an asset between reference and copy-into-project modes
- WebGL or GPU preview and compositing
- Real-time effects

## Extensibility
- Plugin system for quick actions
- Packaging and installers (including FFmpeg licensing review before distribution)
