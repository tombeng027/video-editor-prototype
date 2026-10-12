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
| L6 | No React component tests and no tests for the Electron `main.ts` | Add Testing Library tests as UI logic grows |
| L7 | No Host-header validation (DNS-rebinding hardening) | Optional; the token already blocks this |
| L8 | Export uses one FFmpeg input per clip, so a timeline with several hundred cuts exceeds the Windows command-line limit (refused with TOO_MANY_CUTS). Overlapping tracks are not composited either. | Switch to a filter script file (needs newer FFmpeg in CI) or a segment-by-segment render with concat in M3 |

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
| K17 | Editor keyboard shortcuts remain active behind the export modal. | S or Delete can change the timeline while exporting. | Gate background shortcuts and contain dialog focus; component tests. | Open, stabilization |
| K18 | Export polling/cancellation and default-folder lookup failures are silently ignored. | Stuck progress or unexplained missing default location. | Explicit errors and retry states. | Default-folder warnings and coded errors fixed locally; export polling/cancellation still open |
| K19 | Client blocks export for any offline asset; engine only blocks assets used by the render plan. | Unused missing media prevents an otherwise valid export. | Share the used-asset rule. | Open, stabilization |
| K20 | Test cleanup could read a user's newer launch state; failed shutdown could lose child ownership, and launcher errors lacked a recovery catalog. | Unexpected session shutdown, stranded children, difficult troubleshooting. | Block normal launches during tests; cleanup captured test identities only; persist descendant identities before stop; coded local diagnostic logs and recovery guide. Command-name FFmpeg inference and malformed state validation fixed too. | Fixed locally and verified in hosted Windows CI after K34 setup correction; optional real owned-Ollama verification pending |
| K21 | Logs can grow beyond a storage target, and the editor has no storage-warning UI. | Disk pressure may go unnoticed between launcher operations. | Session logs, conservative retention and terminal warnings first; then periodic in-app warnings with usage/configuration and Open logs / Preview cleanup / Retry controls. | Launcher-only slice implemented and tested locally; in-app integration and broader service logging pending |
| K22 | Import captures the starting folder/project before asynchronous probing/copying, but commits against whichever project is open later; concurrent imports each capture a stale duplicate set. | Switching from A to B can insert A's media into B; simultaneous imports can register duplicate content and copy-target selection can race. | Bind import, commit and proxy callbacks to project opening generation; serialize imports and allocate copy targets exclusively. | Fixed locally: switch/close/same-folder reopen, queued commit, duplicate/collision and stale-proxy regressions; PROJECT_CHANGED returns HTTP 409 |
| K23 | Saved-project parsing checks shapes, not relational timeline invariants. | A structurally valid file with missing asset references, reversed ranges, duplicate IDs/orders or overlaps can open and break editing/rendering. | Shared project-invariant validation on load/save and atomic command batches. | Fixed locally: invalid relationship/range/ID/order/overlap/track/transform/link fixtures rejected; validated backup fallback and unchanged-state/write tests pass |
| K24 | Failures outside export/default-folder handling remain silent or unbounded: project close/recent list, media/proxy refresh, SSE errors, preview play/decode and general API requests. | False empty recent list, apparent close success, stale media state, frozen preview or indefinitely busy UI. | Return/consume typed results, add request timeout and operation-aware retry/recovery; show codes and avoid success-shaped fallbacks for operational failures. | Partial: recent-list failures now explicitly reach landing UI; close/media/proxy/SSE/preview/timeouts remain open |
| K25 | Export output name is unique only to the second. | Rapid successive exports can reuse the final/partial path; replacement or rename failure is platform-dependent. | UUID job/output identity and exclusive hard-link publication on the same volume. | Fixed locally: same-clock exports remain distinct and an occupied output is never replaced; unsupported hard-link filesystems fail explicitly |
| K26 | Engine disables Fastify logging and has no common coded unexpected-error/local-log pipeline. | Unexpected filesystem/route failures may return generic HTTP errors without retained actionable diagnostic context. | Typed application errors and safe local logging/redaction; wire UI code display beyond launcher/new-project flows. | P2, source-confirmed; broader observability pending |
| K27 | Recent-project bookkeeping can fail after create/open changes the session; saving a backup-recovered project copies corrupt main data over the usable backup before replacement succeeds. | UI can report failure while the engine switched projects; failed recovery-save can lose the only valid backup. Backup-only projects are disabled in recent list despite being openable by folder. | Separate bookkeeping warnings from core outcome, preserve validated backup through replacement and align recent availability with recovery. | Fixed locally: nonfatal API/editor warnings, backup-only availability, damaged-index preservation, injected write/replace failures and retry tests; power-loss/multi-engine guarantees not claimed |
| K28 | Layout limits are per pane, not constrained by window width/height. | Maximum saved pane sizes can exceed the minimum desktop window, leaving no useful preview or pushing content offscreen. | Viewport-aware clamping/rebalance and minimum/default-window manual/component tests. | P3, source-confirmed geometry; visual verification pending |
| K29 | Retention reports warnings but exits successfully after partial cleanup; usage stays pre-deletion on failure, metadata writes are non-atomic, and file handles are released before deletion. | Automation/UI cannot reliably distinguish completed cleanup from partial work; a later deletion failure can leave metadata-less logs protected indefinitely. The lock check is not a lifetime guarantee. | Explicit partial/failed result and exit semantics, accurate remeasurement, metadata-last deletion/atomic writes and failure-injection tests; retain conservative active-writer guards. | P2, source-confirmed failure windows; fix before wiring cleanup UI |
| K30 | New-project Cancel and form controls remain enabled during create; completion still calls onCreated after the dialog closes. | A user can cancel, open another project or start another create, then a late result opens the earlier project unexpectedly; cancellation did not cancel its filesystem effects. | Define in-flight creation UX, prevent conflicting navigation/duplicate submit, reconcile successful commits rather than merely ignoring callbacks, and contain/restore dialog focus (shared K17 policy). | P2, source-confirmed; component/deferred-response test pending |
| K31 | Matching the first imported video's frame rate requires no existing assets, including audio. | Importing audio first leaves the default fps when the first video arrives despite the checked option. | Adopt the first video only while the timeline is empty; plan against authoritative state inside the commit queue. | Fixed locally alongside import serialization: audio-first, mixed, concurrent and reopened imports; nonempty timeline preserves fps |
| K32 | Preview chooses the last clip at end-1 but seeks using the end position; same-source discontinuities use drift tolerance instead of forcing a cut seek. | A trimmed clip can show its exclusive out-frame when stopped; sub-0.25s removed ranges can still appear during same-source playback. | Track clip/source continuity, force seek for discontinuities and clamp to the clip's inclusive final frame as well as proxy bounds; real playback/component tests. | P2, source/helper-confirmed; actual browser-frame reproduction pending |
| K33 | Proxy unit tests use shared fixed temp names; real import/export suites leave mkdtemp media/project directories behind. | Tests can overwrite/delete a same-named unrelated temp file, interfere across runs and accumulate storage outside log retention. | Unique owned roots, teardown after writer settlement and explicit fixture-removal assertions. | Fixed locally: pass/failure/cancel coverage and existing-file sentinels; no sweep of prior temp folders |
| K34 | Clean dependency installation does not provision Electron 44's executable; Windows CI stops at DEPENDENCIES_MISSING, while an already-provisioned local machine passes. | New developers and hosted launcher checks cannot start the desktop; the old recovery hint only repeats pnpm install. | Explicit desktop setup script and Windows CI installer step; name the missing dependency and its recovery command; include child diagnostics in unexpected test exits. | Verified locally and in hosted CI run 38198160629: clean-install reproduction, explicit installer/repeat invocation and launcher/retention regressions passed. QA severity High; P2; clean-setup/hosted gate passed |

Review priorities and evidence are maintained in [Review Plan and System Status](./16-review-plan-and-system-status.md). Fixed-local statuses describe maintained regression evidence, not hosted CI or released changes.

## Triage

Tiers follow common QA terms. Tier 1 blocks forward work, Tier 2 must be done before the milestone that depends on it, Tier 3 is scheduled cleanup, Tier 4 is fix-if-cheap or accept.

| Tier | Meaning | Items |
|---|---|---|
| Tier 1: Blocker | Project/job and persistence acceptance gates | K22/K16 and K23/K27 now fixed locally; interaction/recovery is the next bounded slice |
| Tier 2: Major | Fix inside stabilization or before the dependent slice | K17-K19, K21 (partial diagnostics), K24/K26, K29/K30/K32; K12 before undo/redo, K13 before drag editing |
| Tier 3: Moderate | Schedule with the relevant surface | K1, K5, K28, L4, L5, K10 (before first schema change), L8 (export scalability before larger jump-cut sequences) |
| Tier 4: Minor | Fix if cheap, or accept explicitly for the prototype | K3, K9, L3 (drag-and-drop), L6 (add UI coverage with stabilization), L7 (dedicated hardening review before broader distribution) |
| Deferred | Not a scheduled commitment | L2 (packaging when feedback requires installable builds) |
| Resolved | Done locally | K2, K4, K6, K7, K8, K11, K14, K15, K16, K20, K22, K23, K25, K27, K31, K33, L1 |

Decision: M2 capabilities are implemented; reliability gates are not all closed. Launcher, project/job lifecycle and persistence integrity fixes are verified locally. Next address modal/input and observable recovery, then diagnostics gaps before M3 expansion. K1 is mitigated by launcher PATH refresh; manual-launch diagnostics remain open. See [Review Plan](./16-review-plan-and-system-status.md) for evidence and sequencing.
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

## AI
- Additional quick actions: silence removal, auto-captions (see [Captions Concept](./15-captions-concept.md)), highlight reels, filler cut, rhythmic or beat-aligned assembly
- Multi-step edit plans with review
- Natural language timeline commands (split, trim, append)
- Model selection and benchmarking per task
- Stronger action detection (video models, optical flow, pose, or object tracking) beyond frame-level CLIP

## Rendering
- GPU (CUDA) acceleration for the vision service, with VRAM coordination against Ollama
- Full overlay transforms (rotation, crop, blend modes, keyframed position/scale/opacity), building on the prototype's static transform
- Option to switch an asset between reference and copy-into-project modes
- WebGL or GPU preview and compositing
- Real-time effects

## Extensibility
- Plugin system for quick actions
- Packaging and installers (including FFmpeg licensing review before distribution)
