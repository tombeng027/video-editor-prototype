# 16. Review Plan and System Status

[Back to index](./README.md)

This is the reusable starting point for system reviews, not a claim that every path is tested. Use it with [Milestones](./09-milestones.md), the authoritative issue IDs in [Known issues](./10-future-features.md), and the [Run guide](./13-run-and-manual-testing.md). Do not maintain competing issue lists here.

For issue diagnosis and before implementing an approved fix, use [QA and Fix Readiness](./17-qa-and-fix-readiness.md): compare QA acceptance conditions with the engineering cause/fix assessment, investigate factual disagreements, and escalate unresolved product or risk decisions to the user.

## Product contract

- Windows-first, local desktop editing: create, import, edit, preview, save, reopen and export reliably.
- React/TypeScript client, thin Electron shell, Node/TypeScript engine, shared schemas and pure commands; Python vision remains a separate service.
- Preview uses proxies; final export uses originals. Integer project frames and rational frame rates are the shared time contract.
- AI is suggestive by default. Later actions require reviewed proposals and candidates; raw model output never becomes an edit.
- The first semantic quick action is a timestamp-bounded, action-described jump-cut sequence, not beat detection.
- Mobile/on-device editing, captions, GPU compositing and broader effects remain future work. Captions retain their separate collapsible workspace concept.
- Diagnostics must be actionable without silently guessing success; cleanup must not destroy active logs, project data or operational ownership state.

## Review workflow

1. **Establish the baseline.** Record date, branch/commit, working-tree changes, platform, relevant configuration and tests actually executed. Preserve unrelated changes. Never call an uncommitted local result a released or hosted-CI-verified feature.
2. **Select the scope and specialist lens.** For a slice, inspect changed surfaces and their callers, jobs, persistence and UI consumers. Use the matching specialist notes below to explain the context and reasoning. At milestone gates, cover every subsystem row below. Follow asynchronous operations across their entire lifetime, not just their success route.
3. **Check the contract.** Compare code, UI, schemas and docs. Label target designs explicitly. API/schema support is not proof of a working UI feature.
4. **Exercise failure boundaries.** Concurrent starts/edits, switch/close/reopen during work, cancellation at each await, process exit, malformed data, missing files, permissions, disk pressure and lost API/event connections. Bind jobs to a project identity/generation, not merely whichever project is currently open.
5. **Collect evidence.** Reuse existing tests first. For findings, apply the QA assessment in [QA and Fix Readiness](./17-qa-and-fix-readiness.md): record expected/actual behavior, source links, impact, conditions, severity separately from priority, confidence and whether reproduced or source-confirmed. Separate future design risks from present bugs. Use synthetic media/isolated folders; leave user projects and unrelated processes untouched.
6. **Validate the exact requirement.** Test thresholds and result shapes, not just a green command. UI/accessibility claims need component or manual evidence. A helper test does not prove dialog focus or click behavior.
7. **Update records.** Add/update issue IDs in the backlog, refresh this matrix and evidence ledger, and correct directly affected status statements. Mark a fix verified only after its regression passes. List deferred checks explicitly. In every full review, refresh the legal/publication R entries and gate status below; remind the owner of pending decisions and hold only the activities whose triggers have been reached.
8. **Make the gate decision.** State proceed/hold, next bounded slice and acceptance criteria. Before editing, reconcile the QA and engineering assessments using [QA and Fix Readiness](./17-qa-and-fix-readiness.md). Agreement permits work only within approved scope; unresolved behavior/data/compatibility decisions require user input. Do not expand scope automatically or turn review findings into runtime fixes without agreeing the work.

### Finding record

Use: `ID | priority | surface / specialist lens | failure condition and user impact | reasoning / violated contract | source/reproduction | next action | verification needed | status`.

This is the compact backlog summary. Use the [QA and engineering assessment template](./17-qa-and-fix-readiness.md#reusable-assessment-template) for the supporting diagnosis, severity, acceptance conditions and pre-fix decision; the backlog format and existing issue IDs remain unchanged.

- **P1:** data integrity, wrong project/job ownership, broken core export lifecycle; fix before expanding editing.
- **P2:** misleading/silent failures or blocked workflows; fix in stabilization or before the dependent feature.
- **P3:** usability, maintainability and deferred hardening; schedule with the relevant slice.
- Status: `open`, `fix implemented / unverified`, `verified locally`, `verified in hosted CI`, or `deferred with reason`. A green baseline does not close an uncovered bug.

## Specialist context for each review section

These are domain perspectives for the reviewer to apply, not assertions of professional credentials, independent expert sign-off or instructions to launch a separate agent per section. One reviewer can use multiple perspectives. Role labels alone do not make a conclusion accurate: source evidence, reproducible behavior, stated assumptions and appropriate tests do.

Use these notes together with the same-ID subsystem matrix below. Reviewers must distinguish the current Windows/local prototype from future requirements, explain why a concern matters to this product, and avoid prescribing production-scale infrastructure without a demonstrated need.

| Section | Specialist perspective | Context and questions to reason through | Evidence appropriate to the conclusion |
|---|---|---|---|
| S01 Schema/time/commands | Domain-model and type-safety engineer | Time conversion and reversible commands are the shared manual/AI contract. Do shape-valid projects also obey relational invariants? Are rounding, frame boundaries and inverse ordering consistent? | Invalid-project fixtures, rational/mixed-fps boundary tests, command/inverse round trips and unchanged-state assertions on rejected batches |
| S02 Projects/persistence | Storage and recovery engineer | User edits are more valuable than recent-list metadata. Where is the commit point? Which copy remains valid after interruption, failed rename or recovery-save? Can the UI outcome disagree with the active engine project? | Filesystem failure injection at write/backup/replace steps; disk and in-memory state comparison; reopen/recovery tests |
| S03 Import/media identity | Media-ingestion and concurrency engineer | Probing/copying outlives a click and can outlive a project session. Who owns the work at every await? Are sampled hashes used only for the identity guarantees they provide? | Deferred probe/copy tests with switch/close/reopen; duplicate and concurrent import cases; exact copy/orphan outcomes |
| S04 Proxies/media transport | Background-job and streaming engineer | A proxy is derived data, but its completion mutates project metadata. Can stale callbacks survive reset? Can status reconnect safely, and can readers handle incomplete/missing files? | Deferred runner/callback tests, child-exit/cancel evidence, SSE reconnect/malformed-event tests and byte-range assertions |
| S05 Timeline/editing | Interactive-editor and state-management engineer | User intent must be ordered against authoritative state. Do rapid edits, background refreshes and history preserve selection and operation order? Is one gesture one undo/save unit? | Rapid-edit/deferred-response tests, history round trips, gesture/component tests and persisted-state checks |
| S06 Preview/audio | Playback and audiovisual-synchronization engineer | Preview is approximate, not permission to misrepresent the render contract. How do cuts, buffering, seeks, gaps and mixed rates affect what users see/hear? Which audio/transform semantics are actually supported? | Clock/seek boundary tests plus real-media playback observations, decode/play failure states and preview/export comparisons; label unmeasured timing |
| S07 Render/export | FFmpeg/render-pipeline and job-lifecycle engineer | Output correctness and cancellation are separate guarantees. When is a job reserved? Can validation, probing or finalization proceed after cancel/switch? Can another job overwrite output? | Deterministic concurrent/deferred-phase tests, no-output/no-partial assertions, same-clock output tests and real ffprobe frame/audio checks |
| S08 UI/accessibility/layout | UX, accessibility and desktop-interaction reviewer | Keep video editing focused while making failures recoverable. Can keyboard/pointer users operate dialogs without changing the background? Does layout remain usable at supported dimensions? | Component focus/shortcut tests, actual native-picker checks, minimum/default-window walkthroughs and observable loading/error/retry states |
| S09 Engine/API/diagnostics | API-contract and observability engineer | Clients need bounded, typed outcomes, not generic errors or silent success. Which failures are expected, where are unexpected failures recorded, and what diagnostic data is safe to display/share? | API contract/timeout/disconnection tests, code-to-UI tracing, local-log checks and redaction review; a dedicated vulnerability audit is a separate scope |
| S10 Electron/process lifecycle | Desktop-runtime and IPC engineer | The thin shell owns native boundaries and engine lifetime, not editing rules. Are sender/path checks, startup failure and engine exit visible? Does close actually settle child work? | IPC/launch-helper tests plus actual desktop startup/close/failure observations; platform-specific claims only where exercised |
| S11 Windows launcher | Windows process-ownership and automation engineer | PID alone is not identity and a listener alone is not readiness. Do locks, descendant snapshots and retries preserve ownership without touching unrelated apps/services? | PID/creation-time and suite-isolation tests, port-owner preservation, rollback/failed-stop retry and real owned-service checks when available |
| S12 Retention/storage warnings | Filesystem-safety and operations engineer | Storage targets are soft when active evidence must be preserved. Which paths are eligible, when does age begin, and can partial cleanup be distinguished from success? What does measured usage exclude? | Exact threshold/result-shape tests, links/locked files/unknown metadata cases, deletion-failure injection, dry-run side effects and UI warning recovery tests |
| S13 AI/vision | AI-automation and evaluation engineer | Similarity scores are not guaranteed action detections. Guidance must not mutate; proposals/candidates need review. Are ambiguity, false matches, resource costs and model/version changes evaluated? | Proposal validation/no-mutation tests, labelled action clips, empty/ambiguous/adversarial inputs and measured latency/memory with specified model/configuration; planned-only features get design review, not invented runtime results |
| S14 Docs/quality/distribution | QA, release and technical-documentation reviewer | Claims must match evidence and scope. Which tests are missing/skipped, what is only local/uncommitted, and can a fresh user reproduce setup? Does the next slice satisfy its gate without scope growth? | Exact test/CI results, fresh-install/manual acceptance where applicable, source-to-doc comparison, milestone/backlog alignment and release/demo claim checks |

### Notes to write in future review results

For each section in scope, use this compact structure; summarize unchanged sections without duplicating the full matrix:

1. **Perspective and scope:** section ID, specialist lens, current feature boundary and dependent surfaces.
2. **Contract and reasoning:** expected behavior, why it matters to the user's workflow, and assumptions or tradeoffs.
3. **Evidence and limits:** source/tests/reproduction, platform/configuration, and what was not exercised. If no issue was found, say "no issue found within the inspected scope," not "fully safe."
4. **Conclusion and gate:** finding IDs or no finding, priority rationale, acceptance test needed and proceed/hold/defer recommendation.

When sections disagree, resolve the shared contract rather than letting one perspective win by title. For example: storage pressure does not justify deleting active logs; responsive aspirations do not imply certified mobile support; AI convenience does not bypass confirmation or undo; fast preview does not establish exact export correctness.

## Subsystem review matrix

Snapshot: **2026-10-12, Windows local working tree**. "Implemented" means capability exists, not production certification.

| ID / subsystem | Current capability | Review entry points | Required checks and present gaps | Next gate |
|---|---|---|---|---|
| S01 Schema/time/commands | Version-1 shape plus shared relational validation on load/save/atomic batches; integer/rational time and inverse commands | [Schema](../packages/schema/src/project.ts), [Reducer](../packages/timeline-core/src/reducer.ts), [Persistence tests](../apps/engine/src/persistence.test.ts) | K23 locally verified for references, IDs/orders, ranges, overlap, track/transform/link compatibility. Shape schema remains independent of timeline-core; storage adds relational checks. Image/transform/link fields are not end-to-end features. | Persistence gate passed locally; M3 history |
| S02 Projects/persistence | Queued create/open/save, validated main/backup, atomic per-file replacement, nonfatal bookkeeping warnings and backup-only recents | [Session](../apps/engine/src/session.ts), [Store](../apps/engine/src/projectStore.ts), [Persistence tests](../apps/engine/src/persistence.test.ts) | K27 locally verified under write/replace failures; failed save does not adopt state, recovery preserves usable backup. Recent-index damage/permissions are explicit; UI warning is visible. Power-loss/fsync and multi-engine locking are not guaranteed; migration pipeline remains K10. | Modal/error recovery next; before schema changes |
| S03 Import/media identity | Reference/copy import, metadata, sampled hash, serialized duplicate detection, exclusive copy allocation and first-video fps adoption | [Importer](../apps/engine/src/importer.ts), [Probe/hash](../apps/engine/src/media.ts), [Lifecycle tests](../apps/engine/src/lifecycle.test.ts) | K22/K8/K31 verified locally: opening-generation guard, queued commit, copy rollback and fps planning. Preserve regression coverage for switch/close/reopen/concurrency. Hash is not full content-integrity proof; crash-time orphan sweep is not implemented. | Lifecycle gate passed locally; persistence next |
| S04 Proxies/media transport | Serialized CFR proxy generation, generation-bound completion, settled reset/shutdown, SSE/ranges and missing-proxy resume | [Proxy manager](../apps/engine/src/proxy.ts), [Media routes](../apps/engine/src/mediaRoutes.ts), [Client hook](../apps/client/src/useProxyStatus.ts) | Deferred callback/reset and writer-close tests now pass. Asset-removal semantics remain K9; SSE loss/bad payload and refresh failures need visible recovery (K24). No dedicated proxy retry UI. | Error/stream recovery slice |
| S05 Timeline/editing | Add video to one track, select, split/delete, scrub/zoom; engine owns state | [Editor](../apps/client/src/components/Editor.tsx), [Timeline](../apps/client/src/components/Timeline.tsx), [Operations](../apps/client/src/timelineOps.ts) | Rapid edits and background refreshes must not adopt stale state (K12). Undo/redo buttons are disabled; move/trim gestures, snapping, relink and track management are planned. One commit per gesture/save strategy remains K13. | M3-A, then M3-B/C |
| S06 Preview/audio | One video element, shared clock, proxy seek/clamp, video audio and rate control | [Preview](../apps/client/src/components/Preview.tsx), [Playback](../apps/client/src/playback.ts), [Clock](../apps/client/src/clock.ts) | Missing/corrupt proxy and rejected play need visible states (K24). Next-source preloading, separate audio, mute/link/transform rendering are not implemented. Confirm gap/cut/end behavior and mixed fps with real media. | Stabilization; explicit M3 media contract |
| S07 Render/export | Originals, flattened top-track plan, MP4 preset, progress, duration verification, generation-bound reservation and unique exclusive outputs | [Plan](../packages/timeline-core/src/renderPlan.ts), [Exporter](../apps/engine/src/exporter.ts), [Lifecycle tests](../apps/engine/src/lifecycle.test.ts) | K16/K25 verified locally through preflight/probe/finalization/reset/shutdown/collision tests. Hard-link publication requires a supporting filesystem and fails explicitly otherwise. Client used-media rule remains K19; many-cut command length is L8. | Lifecycle gate passed locally; modal/error policy next |
| S08 UI/accessibility/layout | Landing/editor, native pickers, persistent resizable panes, shared native modal policy, save status and export dialog | [Landing](../apps/client/src/components/Landing.tsx), [Modal](../apps/client/src/components/Modal.tsx), [Dialog](../apps/client/src/components/ExportDialog.tsx), [Layout](../apps/client/src/layout.ts), [CSS](../apps/client/src/styles.css) | K17/K30 locally verified: input isolation, focus, locked creation/navigation and export preflight. Expose polling/cancel failures (K18). Clamp layout to window dimensions (K28); verify real pickers (K3). No Settings, drag/drop, search, frame-step or caption UI. | Export/close recovery and preview correctness next |
| S09 Engine/API/diagnostics | Loopback service, typed lifecycle/store/recent failures and successful project warnings, token/Origin checks and health probes | [App](../apps/engine/src/app.ts), [API client](../apps/client/src/projectApi.ts), [Config](../apps/engine/src/config.ts) | No unified unexpected-error code/logging pipeline (K26); no general API timeout (K24). Recent-list errors now reach landing instead of false empty success; other silent paths remain. Cache health probes (L5); dev-token behavior is L4. Not a dedicated vulnerability audit. | Error-observability slice; before distribution |
| S10 Electron/process lifecycle | Dynamic engine port/token, isolated preload, native dialogs, engine parent-exit watchdog | [Desktop](../apps/desktop/src/main.ts), [Launch helpers](../apps/desktop/src/engineLaunch.ts), [Watchdog](../apps/engine/src/parentWatch.ts) | Check actual engine exit/startup dialogs and close with jobs active. Helper/launcher tests do not cover all renderer, picker or navigation interactions (L6/K3). Other desktop platforms unverified. | Desktop acceptance; packaging only when needed |
| S11 Windows launcher | Readiness, owned PID/time/tree cleanup, rollback, locks, suite isolation and explicit Electron setup | [Common](../scripts/launcher-common.ps1), [Start](../scripts/start-app.ps1), [Stop](../scripts/stop-app.ps1), [Tests](../scripts/test-launcher.ps1) | Hosted Windows startup failed on missing Electron binary (K34); explicit setup, recovery hints and diagnostic regressions now pass locally and in hosted run 38198160629. K15/K20 launcher regressions pass there too. Preserve unrelated services; real launcher-owned Ollama remains unverified. | Setup/hosted gate passed; preserve regressions |
| S12 Retention/storage warnings | Per-session logs, JSON age/soft-budget policy, protected sessions, terminal warnings and manual dry run | [Policy](../scripts/log-retention.ps1), [Safety tests](../scripts/test-log-retention.ps1), [Cleanup](../scripts/cleanup-logs.ps1) | K21 remains partial: no in-app warnings/timer/controls. Failures after partial deletion need accurate results/retry metadata (K29). Disk warning covers log drive, not all project/export drives. Legacy logs count but are not deleted. | Finish CLI error semantics; then UI integration |
| S13 AI/vision | Ollama/vision health probes; Python health stub only | [Assistant design](./06-ai-assistant.md), [Pipeline design](./07-jump-cut-pipeline.md), [Vision stub](../apps/vision/app/main.py) | No chat/action tools, CLIP, inference jobs or evaluations. M4 guidance cannot mutate; M5 proposals require validation; M6 needs labelled clips, cancellation, candidates and measured timing. | M4-M6 only after manual workflow gate |
| S14 Docs/quality/distribution | Indexed docs, isolated fixtures, Vitest/Testing Library modal coverage, lint/typecheck, Linux JS/vision CI and Windows checks | [CI](../.github/workflows/ci.yml), [Modal regressions](../apps/client/src/components/modal.test.tsx), [Test strategy](./12-testing-and-settings.md), [Public guidance](./14-content-and-marketing.md) | K33 settled teardown/removal assertions preserved. Component coverage now includes modal interaction, not full editor/Electron flows or an installer. Preserve an approved Git baseline; unpushed changes are not hosted-CI verified. | Each slice and release claim |

## Pre-fix review findings (historical)

This records the original findings, before the priority-fix slice below. The backlog and current inventory carry updated status; reproduced defects are not still open merely because their original evidence is preserved here.

| Priority | IDs | Evidence and consequence |
|---|---|---|
| P1 | K22 | **Reproduced:** pause import probing in project A, open B, resume import; B receives A's asset. Engine serialization covers the eventual write, not the earlier job's project identity. |
| P1 | K16 | **Reproduced in specialist pass:** two concurrent starts launch two runners; cancel during duration probe still yields `done`; reset during preflight still starts a runner. Coverage must gate each asynchronous phase, not just cancellation while FFmpeg is running. |
| P2 | K23 | **Reproduced:** saved-project schema accepts a clip with a nonexistent asset and reversed source range. The loader uses that schema without relational validation. |
| P2 | K24/K26 | **Source-confirmed:** close and recent-list failures are discarded; media/proxy refresh and preview play failures are hidden; general API calls have no timeout. Unexpected engine errors have no common application code/local log pipeline. |
| P2 | K25/K27 | Export filenames have only second precision. **Reproduced:** injected recent-write failure rejects create while the new project is persisted and active. Recovery-save copying corrupt main data over the good backup is source-confirmed; filesystem failure-injection tests are still needed. |
| P2 | K17-K19/K21 | Background modal shortcuts, silent export polling/cancel failures, unused-offline-asset export refusal and launcher-only storage alerts remain open. |
| P2/P3 | K29/K28 | **Source-confirmed limits:** cleanup checks handles then releases them before deletion, returns success-shaped JSON after partial failure, and uses non-atomic metadata writes (P2 before cleanup UI). Pane maxima exceed minimum window dimensions (P3). Existing happy/locked-file tests do not cover all failure windows. |
| P2 | K30-K33 | New-project completion can override cancellation/navigation (source-confirmed); audio-first fps matching is reproduced; preview end/discontinuity concerns have source/helper evidence but no browser-frame proof; test fixture ownership/cleanup is source-confirmed. |

Smaller maintenance observations:

- Duplicate `.modal` / `.modal-backdrop` CSS rules make dialog styling depend on later overrides. Consolidate when touching modal UX; not a blocker by itself.
- Layout localStorage persistence is intentionally best-effort and silent. Distinguish this preference-only fallback from silent failures affecting project data or jobs.
- Vision package description still says CLIP arrives in M4; the current milestone is M6. Correct alongside the next vision/package update.
- No delivery dates or weekly capacity have been agreed. Review and acceptance gates are commitments to evidence, not invented calendar estimates.

## Evidence ledger: 2026-10-12

- Baseline committed SHA before this local stabilization work: `8662cb1`. Launcher, retention, API/UI and documentation changes remain uncommitted; this review adds documentation only.
- Fresh `pnpm typecheck` and `pnpm lint`: passed.
- Fresh `pnpm test`: **16 files / 147 tests passed**, with refreshed PATH and real FFmpeg available. This is not UI end-to-end coverage.
- Fresh `scripts\test-launcher.ps1`: passed, including readiness, duplicate refusal, process ownership, rollback, failed-stop retry and preservation of an existing Ollama-compatible service. Test-owned app processes stopped.
- Fresh `scripts\test-log-retention.ps1`: passed. Synthetic tests cover age/budget, recent/active/preserved/unknown sessions, links, in-use files, disabled cleanup, malformed config, legacy storage and warning thresholds. Expected warning output is part of these cases.
- Two isolated TypeScript reproductions confirmed K22 and K23. Temporary reproduction source and named synthetic files/folders were removed. They are evidence, **not yet committed regression tests**.
- Vision health-stub source/config reviewed; Python tests were not rerun in this review. No CLIP runtime exists to validate.
- Not run: new hosted CI, real owned-Ollama test, visual editing/accessibility walkthrough, long-project performance, disk-full failure injection, installer/cross-platform acceptance or AI evaluation.

## Specialist review pass: 2026-10-12 (requested at 10:02 +08:00)

Same runtime baseline: `main`, committed `8662cb1`, local stabilization changes still uncommitted. This historical pass applies the S01-S14 lenses above rather than treating role labels as independent sign-off. Only documentation changed during that review; subsequent runtime fixes/evidence are recorded below.

### Section conclusions and reasoning

| Section / perspective | Contract and reasoning | Evidence and limits | Conclusion / gate |
|---|---|---|---|
| S01 Domain/type safety | Valid field shapes are insufficient if clips reference absent assets or invalid ranges; all entry paths must preserve the same project contract. | K23 invalid-reference/reversed-range reproduction repeated; schema/core tests pass. No generated-property or migration suite. | Hold integrity gate on K23; K10 before schema evolution. |
| S02 Storage/recovery | The core project outcome must not depend on optional recent-list bookkeeping; at least one known-good recovery copy must survive save failure. | K27 create failure injected into recent.add: API-level operation rejects while session/file already changed. Backup ordering source-confirmed, not disk-full reproduced. | Address K27/K23 after lifecycle ownership; include backup-only recent availability. |
| S03 Media/concurrency | An import is owned by its originating project, and duplicate/copy decisions must be made against serialized authoritative state. | K22 cross-project and same-content concurrent imports both reproduced. Reference-mode proof does not certify copy collision handling. K31 audio-first adoption reproduced. | K22 is first feature-blocking fix; pair K8 cleanup and K31 fps policy with import tests. |
| S04 Jobs/streaming | Cancelling/resetting a proxy must invalidate every callback and wait for file writers before cleanup; progress loss is a recoverable error, not success. | Source inspection of reset/pump/onDone, SSE and refresh handling; baseline proxy/range tests pass. No late-rename/callback/child-close failure injection this pass. | Include proxy generation/settlement in lifecycle regression scope; K9/K24 remain. |
| S05 Interactive state | A write queue on the engine does not serialize client planning or prevent stale refresh adoption; history needs ordered intent and versions. | Editor/operations inspected; helper/reducer tests pass. No component rapid-edit or history UI coverage. | K12 gate for M3-A; K13 before gestures. Treat import/refresh state as part of the same ordering contract. |
| S06 Playback/sync | Proxy drift tolerance must not skip semantic edit boundaries, and sourceOut is exclusive even when the source continues after a trimmed clip. | Helper evidence: end position maps to sourceOut; needsSeek ignores a 0.2s discontinuity. No actual browser-frame/audio measurement. | K32 plus visible decode/play recovery under K24; retain accepted cross-source stalls as a documented limitation. |
| S07 Render/lifecycle | Job reservation, cancellation and output identity are correctness boundaries, not UI conveniences. | K16 three deterministic fake-runner reproductions; real-FFmpeg baseline frame/audio tests pass. No cancel-during-rename or locked-part failure test. | K16 first alongside K22; K25 in same export slice, K19 shared used-media rule. |
| S08 UX/accessibility | Cancel must have honest semantics, dialog focus must isolate input, and completion must not unexpectedly change the active project. | K30 source-confirmed; K17 focus/keyboard and K28 geometry confirmed in code. Picker/visual browser acceptance not performed. | Shared modal policy and K17/K30 component tests; K28 before expanding workspace controls. |
| S09 API/observability | Returning success-shaped fallbacks hides operational failures; timeouts on mutations can leave uncertain commit outcomes and must not imply safe automatic retry. | Close/recent/media/proxy/export result handling, health and generic API helper reviewed. No common unexpected-error log pipeline. | K18/K24/K26: codes, retry/reconcile states and bounded requests; keep health and mutation timeouts distinct. |
| S10 Desktop/IPC | Native lifecycle must make engine failure visible and avoid force exit before jobs settle; helpers do not prove real dialog UX. | Launch/IPC/watchdog source and existing tests; actual launcher startup/close passes. No native-picker click, abrupt engine-exit or cross-platform walkthrough. | No new isolated finding; existing L6/K3 and job-settlement checks remain gates, not certification. |
| S11 Windows automation | Readiness and ownership require process identity and observable response; unrelated processes/services must survive. | Fresh launcher suite passes, including rollback and retained-child retry. Real owned-Ollama and hosted runner unverified. | K15/K20 remain verified locally, not closed for all platforms/service setups. |
| S12 Filesystem/operations | Cleanup must preserve active evidence and report partial outcomes honestly; storage warnings alone are not an enforced cap. | Fresh retention suite passes at synthetic thresholds. K29 failure-window source evidence remains; no post-open deletion-denial injection. | K29 before UI cleanup controls; K21 then nonblocking periodic alerts; no hard-cap claim. |
| S13 AI evaluation | No AI path should be evaluated as implemented when it is only a design. Ranked similarity requires labelled action evaluation before marketing guarantees. | Health-stub/design boundary unchanged; no Python/model run in this pass. | M4-M6 remain planned; no new model/dependency work before manual-workflow gates. |
| S14 QA/release/docs | A green test is useful only if its fixtures are owned and cleaned and its claim matches tested scope. | Fresh 147-test/typecheck/lint/PowerShell passes; inspection afterward found fixed-name proxy fixtures and missing media/export suite teardown (K33). VS Code test tool discovered zero tests, so CLI was used. | Fix K33 before more broad suite runs; keep hosted CI/manual gaps visible; preserve approved baseline before release claims. |

### Additional evidence from this pass

- Fresh application checks: typecheck/lint passed; **16 files / 147 tests passed** with refreshed FFmpeg PATH. Retention and launcher suites passed again. Existing unrelated Ollama-compatible service survived; test-owned client/desktop/engine stopped.
- Isolated fake-operation assertions reproduced K22 cross-project import and concurrent duplicate import; K23 shape acceptance; K16 concurrent start, cancel during probe and reset during preflight; K27 recent-write outcome mismatch; K31 audio-first fps matching.
- K32 is **helper/source evidence only**, not a claim that browser pixels were measured. K30, K29 and K33 remain source-confirmed and need regression/failure-injection tests.
- Temporary reproduction source and its exact synthetic files/folders were removed. These assertions must become maintained regression tests in the fix slices; they do not increase the committed 147-test baseline.
- The ordinary media/export suites currently leave some synthetic temp data behind (K33). No broad temp cleanup was attempted: old folders are not assumed to belong to this invocation. Fix suite teardown rather than sweeping shared temp storage.
- No hosted CI, Python rerun, owned-Ollama lifecycle, visual/accessibility walkthrough, long-media benchmark, model evaluation or dedicated security audit was performed. This is a broad engineering review, not a guarantee that every possible issue was found.

## Priority-fix slice: local implementation and evidence

Scope: test safety (K33), import/project ownership (K22), export lifecycle (K16) and coupled copy/output identity (K8/K25). First-video fps matching (K31) was fixed in the same authoritative import planner, with its existing opt-in/empty-timeline policy preserved. No packages, saved-project schema, AI infrastructure or unrelated UI behavior were changed.

| Specialist / contract | Implementation and maintained evidence | Outcome / remaining limit |
|---|---|---|
| S03 ingestion/concurrency | Opening generation captured before queued import; checked after preparation and inside queued commit/proxy metadata; serialized imports; COPYFILE_EXCL allocation; copied-file rollback. [Lifecycle regressions](../apps/engine/src/lifecycle.test.ts) cover switch/close/same-folder reopen, stale queued commit, concurrent duplicates, preexisting-file preservation and commit/cleanup failure. | K22/K8 locally verified. Already committed media is not deleted on a later project change. Interrupted-process orphan recovery is not a general sweeper. |
| S03 timebase policy | Fps adoption is planned against current state inside the session queue. Audio alone does not consume "first video"; a nonempty timeline prevents a rate change. Audio-first, mixed batch, concurrent, reopen and concurrent timeline-edit tests pass. | K31 locally verified; independent audio playback/editing UI is still future work. |
| S04/S07 job ownership | Export reserves before preflight; reset retains the reservation until settled. Generation/cancellation checks cover runner, duration probe and publication. Proxy reset suppresses stale completion and cleans its own output. | K16 locally verified: concurrent start yields one runner; preflight cancellation/reset starts none; probe/finalization cancellation leaves no final/partial output. |
| S07 output identity | UUID final/partial names; no-overwrite same-volume hard-link publication; rollback after cancellation during publication; explicit cleanup-failure code/path. Same-clock and occupied-final-path tests pass. | K25 locally verified on this Windows filesystem. Unsupported hard-link filesystems fail rather than overwrite; no portability claim. A completed `done` output is the commit boundary, not deleted by a later cancel. |
| S04/S10 writer settlement | FFmpeg error/abort waits for child close; project hooks and engine close await proxy/export settlement. [Child-close tests](../apps/engine/src/ffmpegRun.test.ts) and deferred engine-close tests prove cleanup does not race a late writer. | Local lifecycle checks pass. Duration probing can still delay cancellation/shutdown until it settles; actual native-window acceptance remains separate. |
| S09 observable failures | PROJECT_CHANGED/EXPORT_CANCELLED conflicts and typed import failures reach API routes; cleanup errors retain paths and cause/message. The [run guide](./13-run-and-manual-testing.md) documents recovery codes and commit semantics. | General unexpected-error logging/UI codes/timeouts remain K24/K26. Stale cleanup failures use engine stderr instead of replacing the next project's status. |
| S14 QA ownership | Proxy unit tests use unique roots; real import/export suites remove only their own roots after app settlement. Teardown asserts ENOENT; regression fixtures cover pass/failure/cancel and preserve existing-file sentinels. | K33 locally verified. Prior temp folders were not swept or assumed owned. L6 component/Electron coverage remains pending. |

Validation:

- `pnpm test`: **18 files / 180 tests passed**, including 33 new lifecycle/child-settlement regressions and real FFmpeg/ffprobe media/export tests; refreshed PATH, no real-media skips.
- `pnpm typecheck`, `pnpm lint`, `git diff --check`: passed. Git's existing CRLF-normalization notices are not test failures.
- Windows `scripts\test-launcher.ps1`: passed against the changed engine; readiness/ownership/rollback/retry and external-service preservation still pass. Test-owned app processes stopped.
- VS Code's test interface still discovers no tests; the existing Vitest CLI was used.
- A new audio fixture initially used native milliseconds as clip frames; corrected to project frames before the passing full run. This was a regression-test fixture error, not a runtime workaround.
- Retention code/policy unchanged; its earlier passing safety-suite evidence remains historical, not a fresh run for this slice.
- No hosted CI, Python rerun, owned-Ollama test, visual/accessibility walkthrough, long-media benchmark or disk-full test. Changes remain local/uncommitted.

## Persistence-integrity slice: local implementation and evidence

Scope: K23/K27 plus tightly coupled recent-list error visibility under K24. Existing version-1 project fields are unchanged; optional operation warnings extend API responses, not saved projects. No dependencies or migration were added.

| Specialist / contract | Evidence | Outcome / limit |
|---|---|---|
| S01 domain/type safety | Shared `validateProject` reuses reducer time/range/track rules. Load/save and atomic batches reject invalid relationships; 13 invalid fixture variants cover IDs, orders, references, source ranges, mixed-fps bounds, overlap, transforms and links. Valid unsorted/locked/missing-media projects still open. | K23 verified locally. API Zod shape schemas alone are not relational validators; storage/core enforce relationships. Missing original media remains offline, not project corruption. |
| S02 storage/recovery | Unique exclusive temp files; validated main only may replace backup, backup replacement is atomic before main replacement. Injected main/backup write/replace failures, corrupt/missing-main recovery saves, failed edit retry and cleanup failure pass in [Persistence tests](../apps/engine/src/persistence.test.ts). | K27 backup safety verified locally. Failed commits do not adopt state; usable backup survives recovery failure and successful recovery save. Not fsync/power-loss or independent-engine concurrency certification. |
| S02/S09 operation outcomes | Recent-update failures return successful create/open with RECENT_UPDATE_FAILED warnings retained by GET /project. Backup-only recents use validated recovery availability; damaged index is preserved and permission/list failures are coded. | K27 bookkeeping/recovery availability verified locally. No automatic index-repair control; folder open is the workaround. |
| S08 interaction / S09 observability | Optional API warnings survive client parsing and appear in editor status; recent-list errors appear on landing, not "No recent projects". Local integrated-browser smoke used synthetic fetch responses: damaged-index alert visible; successful create closed the dialog, opened editor, and displayed RECENT_UPDATE_FAILED. | Visible flow checked, not component automation or real native-picker acceptance. Mocked SSE endpoint was unavailable; this was not streaming acceptance and K24 SSE recovery stays open. |
| S14 QA | New isolated failure-injection suite plus existing lifecycle/core/client tests. Mock injection resets between cases; owned roots are removed after tests, and the temporary browser client was stopped. | No broad temp cleanup, no user projects modified, no commit/push. |

Validation: **19 files / 215 tests passed** with real FFmpeg available; typecheck/lint and production client build passed. New coverage includes 34 isolated persistence regressions and one client warning/result test. The first targeted run caught two test-setup mistakes (a swapped missing/damaged-index assertion and module-mock reset between failure cases); both corrected before passing runs. Editor problems check reported no errors. Browser smoke is synthetic response/UI evidence, not a real-engine end-to-end test. No new hosted CI, launcher/retention/Python rerun, disk-full or power-loss test for this slice; earlier launcher evidence belongs to the lifecycle slice.

## Pre-publish review gate: 2026-10-12

User authorized a quick review, commits and push of the accumulated stabilization baseline. Reviewed pending configuration/API/UI changes, project/job ownership and persistence boundaries, launcher/retention ownership and CI wiring. This is a bounded engineering review, not a new exhaustive audit or release certification.

- Fresh checks: **19 files / 215 tests passed** with real FFmpeg; typecheck, lint and production client build passed.
- Fresh Windows launcher and retention safety suites passed. Injected denial/invalid-policy/locked-file warnings were expected test evidence, not hidden failures. Test-owned processes were stopped; unrelated Ollama remained untouched.
- No new blocking regression identified in this scope. Existing K17/K30 modal/input, K18/K19 export interaction/policy, K24/K26 observability and K29/K21 retention/UI gaps remain explicit; the known partial-cleanup result/metadata limits under K29 are not certified by a green safety suite.
- Publish source, tests, scripts, CI definitions and docs only. Demo media, sample project contents, dependencies, build output and local process/log files are excluded. The saved-project format remains version 1.
- Gate: proceed with a reviewed prototype baseline on `main`, not M3 expansion or an installable release. Hosted CI is pending at this gate; actual push/check outcomes are confirmed separately from local tests.
- Earlier entries describing local/uncommitted work are historical evidence from those review/fix turns, not a permanent claim about the latest Git state.

## QA/engineering fix assessment: K34, 2026-10-12

First application of [QA and Fix Readiness](./17-qa-and-fix-readiness.md). Scope: clean desktop provisioning and the directly coupled missing-dependency/test diagnostics. Baseline `6a83f2e`; the new QA reference was already a local documentation change. No editing features, dependency versions, saved-project fields or process ownership semantics changed.

### QA evidence and acceptance

- **Expected:** documented first-time setup prepares the desktop; Windows CI can launch the owned client/window, verify the engine and stop owned processes. Missing dependencies produce an actionable code and recovery path.
- **Actual:** [hosted run 38197224023](https://github.com/tombeng027/video-editor-prototype/actions/runs/38197224023) passed JS and vision but failed launcher startup (`start-app` returned 1). Its uploaded diagnostic artifact records `DEPENDENCIES_MISSING` at the dependency preflight. Repeating the old `pnpm install` hint does not install the binary.
- **Reproduction:** an isolated workspace with pnpm 12.9.1 and pinned Electron 44.5.1 successfully installed the package without `dist/electron.exe`; running its explicit installer then provisioned version 44.5.1. No existing workspace binary was removed to reproduce this.
- **Impact:** clean Windows setups cannot launch. QA severity **High**, priority **P2** with a clean-setup/hosted gate; no demonstrated user-data loss. Workaround: `pnpm --filter @ve/desktop setup:electron` after dependency installation.
- **Confidence:** high for the missing provisioning step: hosted artifact, package metadata and isolated reproduction agree. Corrected hosted desktop acceptance subsequently passed in run 38198160629, not inferred from local success.

### Engineering cause and pre-fix reconciliation

Electron 44.5.1's package has no automatic install lifecycle script; it exposes `install-electron`. Allowing Electron build scripts does not invoke a nonexistent hook. An already-installed local binary masked the omission. The fix adds a named desktop setup script, calls it explicitly in Windows CI and updates first-time setup instructions. Startup validates exact dependency files but never silently installs them. The shared preflight helper provides the same missing-file decision for startup and isolated regression fixtures.

The test runner also previously reduced an unexpected child failure to an exit-code assertion. It now includes bounded child stdout/stderr so the underlying coded reason is visible without first downloading the artifact.

| QA acceptance condition | Engineering correction / validation | Agreement and result |
|---|---|---|
| Clean installation produces a usable Electron executable | Explicit package-provided installer; isolated pinned-version reproduction/install | Agreed; executable/version checked locally, repeat installer succeeds |
| Already-provisioned setup remains supported | Installer checks the existing version; repository setup and desktop typecheck | Agreed; local setup succeeds without dependency version or lockfile changes |
| Missing dependency has an actionable stable failure | Shared preflight distinguishes Vite from Electron and names the recovery command | Agreed; owned missing-file fixtures pass with DEPENDENCIES_MISSING |
| Failed integration test exposes the actual child reason | Bounded stderr/stdout included on mismatched exit | Agreed; intentional TESTS_RUNNING mismatch includes the child code |
| Ownership, readiness, rollback and unrelated services remain safe | Existing full launcher integration and retention suites | Agreed; both pass locally; owned processes stop and existing Ollama survives |
| Windows hosted acceptance actually executes | Windows CI installer step precedes launcher tests | Agreed; approved runtime commit 3e89be1 passed hosted launcher and retention checks |

**Pre-fix gate: proceed.** User authorized investigation/assessment/fix; QA and engineering agree on contract and scope. No product-policy decision or data migration is needed. Installation failures remain nonzero; readiness/ownership checks are not relaxed. Restoring the previous source version alone would reintroduce the missing setup step, so retain the documented installer workaround if reverting.

### Post-fix QA and limits

- Passed: isolated clean-install reproduction and explicit installer, repeat invocation, repository `pnpm install --frozen-lockfile`, desktop setup/typecheck, lint and PowerShell parser checks.
- Passed: full launcher integration including four new dependency/diagnostic assertions, then retention safety checks. Expected synthetic denial/locked-file/configuration warnings remain explicit.
- Teardown verified: dependency fixtures removed, client listener stopped, owned desktop/engine stopped, existing Ollama preserved. No user project/media modified.
- At the local gate K34 was **verified locally** only; no fresh local full Vitest/Python run was claimed for this setup-only change. Real owned-Ollama and other desktop platforms remain unverified.
- User then authorized commit/push and hosted verification. Runtime commit `3e89be1` was pushed without rewriting history; [corrected hosted run 38198160629](https://github.com/tombeng027/video-editor-prototype/actions/runs/38198160629) passed **launcher, JS and vision**. K34 is now **verified in hosted CI**, and the clean-setup/hosted gate passes. Documentation/reference changes are recorded separately; this evidence identifies the tested runtime commit.
- The original failed run remains useful evidence: a green local baseline did not prove clean-hosted readiness. Neither the passing retention suite nor this setup fix closes K29's partial-cleanup semantics.

## Full review and interaction fix: 2026-10-12 (requested at 11:10 +08:00)

Baseline: clean `main` at `ef8f353`; [hosted run 38198401658](https://github.com/tombeng027/video-editor-prototype/actions/runs/38198401658) passed launcher, JS and vision. User authorized a full review and the highest-priority fix, not an automatic commit/push. Apply the [QA/engineering reference](./17-qa-and-fix-readiness.md); current source and maintained regression evidence take precedence over historical findings above.

### S01-S14 review and priority reassessment

| Section / perspective | Reviewed evidence and conclusion | Remaining gate / priority |
|---|---|---|
| S01 domain/type safety | Schema, shared range/ID/reference validation, frame helpers and render-plan contract; full regression suite preserves rational/mixed-fps and atomic-batch checks. No new blocking defect found in inspected entry points. | K10 before saved-schema changes. Shape support for images/transforms/links is not a promise of rendering them. |
| S02 storage/recovery | Store, session queue/generation, recent index and project routes; backup/write-failure regressions remain passing. No new demonstrated data-loss defect in this scope. | K24 close-result visibility and ambiguous transport recovery remain P2; power-loss and independent-engine concurrency remain uncertified. |
| S03 ingestion/identity | Import queue, exclusive copy allocation, generation-guarded commit/callback and first-video fps logic; lifecycle/media regressions preserved. | K9 removed-asset completion is scheduled maintenance; do not reintroduce copied-media or opening-generation races. |
| S04 streaming/background jobs | Proxy reset/publish/callback cleanup and range/SSE routes reviewed. Writer settlement regressions pass. Client event parsing and refresh still lack visible failure handling. | K24 malformed/lost SSE and proxy-refresh recovery P2; reconnect is not proof of fresh editor state. |
| S05 interactive state | Editor command planning/result adoption, assets import and timeline selection/clock consumers reviewed. Modal keys have no guard before this slice; command planning/refresh responses still have ordering limits. | K17 immediate safety slice; K12 authoritative client intent/results before M3 history, K13 before drag saves. |
| S06 playback/sync | Preview clip selection, source seek/clamp, clock and timeline configuration reviewed. Exclusive-end seek and same-source discontinuity concerns remain; play rejection is swallowed. | K32 and K24 preview errors P2. Source/helper evidence is not measured frame/audio acceptance. |
| S07 rendering/lifecycle | Export reservation, preflight/generation guards, cancellation, exclusive publication and cleanup reviewed; real-FFmpeg/lifecycle tests preserved. Client can dismiss the start preflight before the response. | Coupled K17 start-phase isolation now fixed; K18 polling/cancel recovery and K19 used-asset policy next. L8 before large timelines. |
| S08 UX/accessibility | Create/landing/export/shortcuts/layout/CSS reviewed. Create can complete after Cancel; picker waits leave navigation available; export permits background keys and lacks modal containment. Pane maxima still exceed minimum window dimensions. | K17/K30 selected highest actionable P2 slice (QA High for unintended saved edits/project transitions). K28 P3; K3 real picker acceptance still open. |
| S09 service/diagnostics | API result parsing, config, route errors, health probes and project warnings reviewed. Close discards its result; most project calls have no deadline. Recent failures/warnings remain explicit. | K24/K26 P2, with operation-aware reconciliation rather than blindly retrying mutations; L4/L5/L7 remain separately scheduled. Not a dedicated security audit. |
| S10 desktop ownership | Main/preload, dynamic engine/token launch, native dialog wiring and exit paths reviewed against hosted launcher evidence. | L6 main/IPC tests and K3 real picker acceptance; packaging L2 remains deferred. No claim of all native interactions or other platforms. |
| S11 Windows operations | Existing owned-process/readiness/lock/rollback paths and explicit Electron setup remain the verified baseline. No launcher source changed in this slice. | K34 hosted gate stays passed; optional real owned-Ollama acceptance remains pending. Do not call historical hosted tests verification of new UI code. |
| S12 retention/storage | Age/soft-budget policy, protected writers and measurement/deletion paths reviewed. K29 still returns success-shaped results after partial deletion and can lose metadata too early. | K29 P2 before K21 in-app controls; do not wire a UI to unreliable cleanup outcomes. Alert timing/deduplication/drive scope still need decisions. |
| S13 AI/vision | Vision health stub, engine readiness probes and milestone contract reviewed; no agent/model edit execution exists. | M4-M6 remain future work; previous hosted Python health tests are evidence, not a new local Python rerun or CLIP validation. |
| S14 QA/docs/distribution | Backlog/milestones/test strategy compared with source and prior hosted result. Found stale hosted and component-coverage statements; corrected directly related docs. | New modal component coverage closes only part of L6. Full release, screen-reader, native picker, performance and disk-full acceptance remain separate gates. |

**Priority conclusion:** no new demonstrated engine P1 regression in this review. Existing interaction defects are the highest actionable slice because they can autosave unintended edits or switch the project after an apparent cancellation. Fix K17/K30 first; then export/close recovery and used-media consistency, preview boundaries and diagnostics. Preserve the architecture and hold M3 expansion. This review covers all subsystem entry points and current maintained tests, not every execution path or exploitability.

### K17/K30 QA and engineering gate

- **QA expected/actual:** modal input must stay in the dialog, and Cancel must mean no submitted creation remains. Existing code has CSS overlays/ARIA without inertness or containment, unconditional window shortcuts, enabled creation Cancel/fields, and no start-phase/picker navigation guard.
- **Evidence:** pre-fix source-confirmed contracts, then maintained deferred-response component tests and native-browser acceptance. No fabricated pre-fix test-run result is claimed.
- **Decision:** user chose **lock creation until the engine responds**, with disabled fields/Cancel and visible Creating state. Successful response must still open the committed project and preserve warnings; simply dropping callbacks would leave client and engine disagreeing.
- **Engineering cause/fix:** use one native `dialog.showModal()` wrapper for background inertness, explicit key containment/dismissal policy and opener focus. Add editor shortcut gating plus synchronous pending refs for creation, native picker navigation and export start. Keep engine commit/cancellation semantics unchanged. Consolidate duplicated modal CSS using the previous effective dimensions.
- **Alternatives/risk:** client-side abort or dismiss-and-ignore is not true filesystem/session cancellation. Avoid fake cancellation. Native dialog support is appropriate to the current Electron/browser target; older/other platforms are not newly certified. No saved-schema/API-format change. New development-only Testing Library/user-event/jsdom tooling provides component evidence.

| Acceptance condition | Implementation / verification | Gate |
|---|---|---|
| No split/delete/play shortcut behind export | Shared modal key isolation plus Editor guard; actual Editor component and real-browser key checks | Agreed; passes locally |
| Tab/Shift+Tab contained; opener focus restored | Shared modal boundary handling/native top layer; component and browser tests | Agreed; browser found disabled Create opener prevented restoration, corrected and regression added |
| Create cannot be cancelled, mutated or duplicated after submit | Disabled fieldset/actions, pending guard, non-cancellable status, native cancel/Escape guard | User-approved; deferred success/failure/duplicate tests and browser pass |
| Success adopts the committed response including warnings | Creation stays owned until onCreated; no ignored successful callback | Agreed; exact one-callback/warnings assertion passes |
| Reported failure allows retry/Cancel | Reset pending/busy and retain coded API error; no weakened validation | Agreed; invalid-input and failure/retry tests pass |
| Folder picker cannot race conflicting navigation | Landing/new-project pending guards, disabled actions and FOLDER_PICK_FAILED recovery | Agreed; deferred picker/open/rejection tests pass; actual native picker acceptance still K3 |
| Export start cannot be hidden or duplicated during preflight | Starting status, disabled actions, synchronous guard and nondismissible policy | Agreed; deferred start/failure and browser pass; running Cancel remains available |
| Existing engine behavior stays intact | Full client/core/engine suite including real FFmpeg | Agreed; no engine/runtime schema changes |

**Pre-fix gate: proceed after the creation-policy decision.** No other material product disagreement. K24 deadlines/uncertain mutation outcomes and K18 polling/cancel failure recovery are deliberately not hidden behind the modal fix; an unresponsive request can still leave a busy operation unresolved and needs the next recovery slice.

### Post-fix QA evidence

- Maintained component tests cover modal focus/key boundaries, creation success/warnings/failure/validation, duplicate submission, picker waits/rejection, delayed default location, landing navigation, export preflight/running state and actual Editor shortcut isolation/restoration.
- Initial test failures were fixture setup issues: jsdom lacks native dialog methods, and the page has multiple status regions. The test shim is explicit and status queries are scoped; browser native-modal evidence is separate.
- Browser smoke used synthetic fetch responses only, with no project/media writes. Verified native `:modal`, blocked background focus, Tab boundaries, idle Escape/focus return, locked pending creation and preflight, one committed response, blocked edit/play keys and resumed Split after close. At 960x620 the pending creation dialog fits (520x443, x220/y88.5). This is not a full editor layout/accessibility certification.
- A first browser script pressed Space on the focused Close button, correctly activating it; the corrected smoke tested Space on the dialog itself. Normal button keyboard activation is preserved.
- Synthetic SSE endpoint was unavailable; this is not streaming acceptance and K24 stays open. Temporary client on 5187 was stopped, listener absence verified, and browser returned to about:blank.
- Final local checks: **20 files / 226 tests passed**, including **11 new component regressions** and real FFmpeg. Frozen-lockfile installation, full typecheck/lint, production client build and editor diagnostics passed. **149 local documentation links** resolve; the unique K1-K34 inventory matches **19 resolved / 15 open-partial**. Tracked whitespace checks passed, and the owned browser-smoke server was stopped with no remaining listener.
- Current changes remain local/uncommitted. Prior hosted green `ef8f353` is the baseline, not hosted verification of this modal slice. No fresh Python or Windows launcher/retention rerun: their source is unchanged and their hosted evidence belongs to the baseline. No new disk-full, screen-reader, real-native-picker or long-media acceptance claim.

### Current open-issue inventory and priority order

Issue descriptions/status remain authoritative in the backlog. There are **15 open/partial K entries** and **7 unresolved/deferred L entries**; multiple rows below share a fix slice, not duplicate implementation work.

| Order / gate | Issue IDs | Work and acceptance requirement |
|---|---|---|
| Completed locally - test safety | K33 | Unique owned roots, settled teardown and fixture-removal/preservation assertions now pass. L6 component/Electron coverage stays open with the relevant UI slice. |
| Completed locally - project/job integrity | K22, K16; coupled K8, K25, K31 | Generation-bound imports/proxies, serialized duplicate/copy decisions, early export reservation, cancel/reset through finalization, writer settlement and no-overwrite output regressions pass. |
| Completed locally - persisted state integrity | K23, K27; watch K10 | Shared relational validation, backup-safe replacement/retry, nonfatal recent warnings and backup-only availability now verified. Migrations still precede saved-schema changes. |
| Completed locally - interaction integrity | K17, K30 | Shared native modal/focus policy, shortcut isolation, locked creation and picker navigation, guarded export start; maintained component and browser evidence. |
| 3 - observable recovery and playback | K18, K19, K24, K26, K32 | Export polling/cancel and close result/retry states; used-asset consistency; request deadlines with mutation reconciliation; cut/end preview correctness and visible media/event failures. |
| 4 - diagnostics completion | K29, K21 | Explicit partial cleanup result/exit and accurate accounting; atomic/retryable metadata handling; then in-app usage/target/protected warnings, periodic monitoring and recovery controls. Agree interval/deduplication/drive scope before implementing UI monitoring. |
| 5 - M3 editing prerequisites | K12, K13, K28; L8 | Serialize client intent/state/history; one gesture/undo/save unit; viewport-aware pane sizes; define large-export limits before long jump-cut sequences. Do not force debounce if coalesced gesture commits satisfy the measured need. |
| 6 - scheduled maintenance/design hardening | K1, K3, K5, K9; L3, L4, L5, L7 | Manual PATH/port recovery, real picker acceptance, removed-asset proxy semantics, deferred drag/drop, non-dev token policy, cached health probes and a separately scoped hardening review before distribution. No exploitability conclusion is made here. |
| Conditional distribution | L2; R1-R5 | Package only when feedback needs installable builds and the owner approves scope/capacity; applicable legal/publication and platform acceptance gates first. Apache-2.0 adoption does not authorize commercial-release expansion. |

Locally resolved K entries: K2, K4, K6, K7, K8, K11, K14, K15, K16, K17, K20, K22, K23, K25, K27, K30, K31, K33, K34. Resolved limitation: L1. K7's missing-media reporting is implemented, but K19 still covers the export policy mismatch; K14's save-status UI exists, but K12/K24 cover broader state/error races. There are 34 K entries: 19 locally resolved and 15 open/partial. Hosted JS/vision and corrected Windows checks passed for baseline ef8f353; the new modal slice is local only and manual acceptance limits remain explicit.

Features that are not bugs: M3 Undo/Redo UI, gestures, snapping, relink and track management; M4 chat; M5 proposals; M6 vision/candidates; Settings, independent audio/compositing, captions, mobile and GPU upgrades. Keep them as roadmap work, not "missing fixes" that endlessly block stabilization.

**Next bounded implementation recommendation:** export polling/cancel recovery and used-media consistency (K18/K19), with the closely related close-result visibility under K24. Follow with K32 preview boundaries and remaining K24/K26 request/event/media observability, then K29 before K21 controls. Do not restart the same broad review without a concrete new question.

## Legal and publication gate status

Snapshot: **2026-10-12, Philippines maintainer, public source prototype**. The live repository review found no project license and no GitHub releases/release assets. Local stabilization changes remain uncommitted. AI integration and packaged distribution remain planned. No legal clearance, trademark search or patent freedom-to-operate opinion is claimed.

The authoritative [R1-R5 backlog](./10-future-features.md#legal-and-publication-readiness-backlog) owns requirements and status. On 2026-10-12 the owner approved Apache-2.0 for original code/documentation: [LICENSE](../LICENSE), [scope/notice](../README.md#license-and-participation), package metadata and [contribution terms](../CONTRIBUTING.md) are implemented in source. The owner subsequently approved focused commits and push for licensing, modal stabilization and documentation; licensing commit is `5fd8ced`. Verify remote synchronization before outreach; the earlier no-license GitHub observation predates this publication batch. Third-party and per-contribution rights still need their applicable checks. Live GitHub About was verified after the owner's update with independent wording and AI explicitly planned. R2 source wording is corrected, with ongoing per-demo verification required.

**Decision: proceed with routine development and the next approved stabilization fix.** The R1 license decision is approved and implemented locally; publish the license and contribution terms before inviting reuse or merging external contributions against the public repository. Before promotion/demos/support collection, check R2/R5. Before model integration or download automation, check R4. Before the first downloadable alpha/beta/installer, check R3 and applicable R1/R2/R4/R5 requirements; do not defer compliance until after publication.

Local licensing validation: the root license matches the official Apache-2.0 text with line endings normalized; six JS manifests and Python metadata declare Apache-2.0. Existing private-package flags remain unchanged (they prevent package publication, not source licensing). Frozen dependency-lock validation passed; 172 local documentation links/fragments and tracked whitespace checks passed. No runtime behavior changed or fresh runtime acceptance claimed. No separate third-party notice inventory or binary/model legal clearance was completed.

At each full review:

1. Establish the current stage: source-only development, contribution intake, model integration, demo/support collection or binary distribution.
2. Recheck license presence/owner decision, contribution provenance, public claims and any newly selected or shipped third-party artifacts against the R backlog.
3. Update the dated snapshot and evidence, identify due gates and remind the owner of unresolved decisions. Unchanged future gates remain deferred with their trigger, not silently cleared.
4. State exactly which activity may proceed or must hold. Tests, disclaimers and role perspectives do not supply legal clearance; escalate material unresolved rights questions to qualified counsel.

## QA, engineering and legal-readiness review: 2026-10-12 (requested at 12:10 +08:00)

### Baseline, scope and fresh evidence

- Committed baseline remains `ef8f353`; modal, licensing and documentation changes are local/uncommitted. The live public About is corrected, but GitHub still reports no project license because the local license has not been published.
- Inspected current schema/reducer/render-plan, session/store/recent/import/proxy/routes/export lifecycle, client timeline/preview/modal/API/state consumers, Electron lifecycle, launcher/retention source and documentation index/specs/status/marketing/contribution terms. Existing S01-S14 matrix remains the subsystem inventory; this is a cross-system review, not exhaustive line-by-line certification or a dedicated vulnerability audit.
- VS Code test discovery returned zero tests; the existing CLI then passed **20 files / 226 tests**, including real FFmpeg. Fresh full typecheck, lint, client production build and frozen-lockfile validation passed. Final record validation passed **179 local documentation links/fragments**, tracked whitespace, six JS license declarations and canonical Apache license matching. Unique K1-K34/R1-R5 inventories remain unchanged.
- No new native-browser, Electron picker, screen-reader, Python runtime, Windows launcher/retention, disk-full or power-loss acceptance was executed. Earlier native-modal smoke and hosted Windows/Python results remain historical evidence, not fresh results for this review.

### QA versus engineering conclusions

| Surface / existing ID | Evidence and impact | Acceptance / gate |
|---|---|---|
| S01-S04/S07 persistence and job ownership | Shared validation, serialized commits, generation guards, backup protection and exclusive export publication are retained; maintained regressions pass. No new P1 data-loss regression was demonstrated within inspected scope. | Preserve existing tests; multi-engine locking, fsync/power-loss and all-filesystem behavior are not certified. |
| S05/S08 input interaction, K17/K30 | Shared modal and immediate pending guards are wired to creation/start/navigation; component regressions pass. | Locally verified as previously recorded; full editor/native-picker accessibility remains outside this evidence. |
| S07/S09 export recovery, K18/K19 | Export polling/cancel failures are discarded; interval polls may overlap and stale responses can overwrite newer state. Client blocks all offline assets while the engine filters to render-used assets. | Highest next runtime slice: coded visible recovery, ordered/non-overlapping polling with obsolete-response guards, explicit cancel state, shared used-asset rule. |
| S02/S09 close and mutation uncertainty, K24 | App changes to Landing without awaiting close; API close discards its typed result. API calls have no general deadline. Create/open routes await job/proxy hooks after the session commits, so a hook failure can reject a committed operation. | Close must expose outcome and retry/reconciliation. For mutation failures/timeouts, determine authoritative state before retry; post-commit hook failures must not appear as an uncommitted create/open. Source-confirmed hook path; no new fault-injection claim. |
| S03/S08 media picker, K24 | [AssetsPane](../apps/client/src/components/AssetsPane.tsx) awaits the native picker outside error handling and before busy state; unlike Landing/Create, rejection is not displayed. | Surface a coded picker failure and guard conflicting import interaction. Source-confirmed, not a new native runtime reproduction. Group with K24 rather than duplicate the backlog. |
| S06/S09 preview/events, K32/K24/K26 | Last-frame/discontinuous-source behavior and silent play/refresh failures remain; malformed SSE JSON is parsed without recovery. | Real-media cut/end acceptance and coded media/event recovery; broad diagnostics still incomplete. |
| S10-S12 lifecycle/cleanup, K29 before K21 | Ownership-aware launcher is preserved; retention still releases file handles before deletion and cannot accurately account for every partial-delete outcome. | Preserve active/unknown logs; correct partial outcome/accounting/metadata before adding cleanup UI. No fresh Windows acceptance. |
| S05/S08 M3 prerequisites, K12/K13/K28/L8 | Client intent is not queued, pane limits are not viewport-aware and long exports retain a command-line limit. | Existing bounded M3 prerequisites remain; no enterprise or commercial expansion is justified by this review. |

QA and engineering agree on the current priority order. Source-confirmed failures do not become closed merely because unrelated tests pass. This review does not authorize runtime fixes, file removal, history rewriting or publication.

### Documentation and legal-readiness findings (at review time)

The claim corrections below were implemented in the subsequent documentation slice. Runtime issues and R3-R5 gates remain open; the later record distinguishes correction from publication.

- **R1:** Apache-2.0 original-work license/scope and contribution terms exist locally; publication remains pending. This does not clear third-party artifacts, all provenance, trademarks or patents. No legal opinion or freedom-to-operate conclusion is supplied.
- **R2/R5:** [marketing](./14-content-and-marketing.md) still says "local and private" / "footage is not uploaded", and [pipeline](./07-jump-cut-pipeline.md) says "nothing leaves the computer". Replace absolutes with the actual default-local architecture, configured endpoint/network/download exceptions and support-data boundaries before promotion. No media-upload implementation was demonstrated; this is a claim-precision finding, not evidence that footage is currently uploaded.
- **S14/R2:** [data model](./03-data-model.md) describes split audio and CSS/FFmpeg overlay handling in present tense even though its status banner says planned; [persistence](./04-commands-and-persistence.md) says copy UI shows disk-space/progress without that UI existing. Target banners help but specific claims still need local labels. The vision manifest still places CLIP in M4 rather than M6. These are documentation corrections, not instructions to implement missing features.
- **S14:** [architecture](./02-architecture.md) says all boundary inputs are validated, although SSE JSON failure is not handled. [preview/export](./05-preview-and-export.md) describes holding the final frame as implemented while K32 remains unresolved. Narrow guarantees to maintained evidence and link known limitations.
- **R3/R4:** exact release artifacts/notices, FFmpeg libx264/GPL and codec-patent questions, Electron/Chromium notices and exact model conditions remain stage-specific gates. A project license is not a replacement. No tracked media/model/binary assets appeared in the inspected tracked inventory; this is not exhaustive history/third-party clearance.
- Contributor guidance does not require assignment of copyright or promise sponsor delivery. Actual sponsor agreements, if any, require separate review; the public Sponsors profile reviewed earlier is not a contract audit.

### Public documentation and project-fit recommendation (not an approved removal policy)

The bounded editor fits an open-source repository: usable current code, tests, setup instructions, explicit limitations, a roadmap and an approved permissive license. AI-assisted provenance is not a reason by itself to conceal technical decisions; reviewers need understandable, tested and maintained code.

Keep architecture, API/schema, run/test instructions, known limitations, technical decisions, contribution terms and a concise QA/release record public. They help contributors and employers evaluate engineering judgment. Publicly documenting a decision is not a promise to implement every idea.

Separate private material by content, not by the presence of a decision: employment/job-search details, personal capacity/budgets, sponsor negotiations/contact information, unpublished commercial strategy, credentials, user media/logs and sensitive incident reports should not be public by default. The marketing plan and archived prompts/specs are optional public material, not required to make the code open source; consider extracting a concise public purpose/roadmap and keeping detailed personal planning privately. The extensive review ledger can be summarized for public onboarding while retaining detailed private operational records if the owner chooses.

No demonstrated confidential-content disclosure was established from the inspected documentation, and no complete secret/history audit was performed. Do not hide known user-impacting limits or licensing conditions merely to improve appearances. Moving a file into a gitignored folder inside a public repository does not erase published history or guarantee confidentiality; use a genuinely separate private location for future sensitive planning. Any historical remediation needs separate, explicit approval and coordination, not automatic history rewriting.

**Gate: proceed with bounded stabilization; hold publication claims that depend on unpushed licensing and hold binary/model releases under R3/R4.** Prioritize claim corrections/public-document policy before contributor outreach, then K18/K19 with closely related K24 close visibility. Private/public documentation restructuring requires the owner's decision; no documents were removed or moved in this review.

## Documentation disclosure and claim corrections: 2026-10-12

Owner approved keeping technical documentation public while separating detailed personal/business planning into a local location outside this Git repository. Current public scope statements retain community/QA purpose, capacity and explicit approval gates without personal career details. The public participation guide replaces speculative funding tiers, budgets and promotion schedules; contribution and license terms remain public and unchanged.

Technical architecture/API/schema/testing/known-issue records remain public. The detailed review ledger is retained as evidence, with historical findings labelled; optional archives now clearly state that maintained docs supersede them. No user-impacting limitation was hidden. No Git history was rewritten: earlier published text may remain in history/copies, and a separate local folder is not encrypted or automatically backed up.

Source corrections cover default-local versus absolute privacy claims, planned split audio/overlay compositing, import busy state versus nonexistent copy-byte/disk-space UI, unbenchmarked command latency, boundary-validation limits, K32 last-frame limits and the M6 vision metadata description. R2 corrections are included in the approved publication batch, not legal clearance. R5 still requires permissions/redaction for actual demos/support; R3/R4 still gate exact binary/model artifacts.

The owner approved publishing the complete inspected working tree in focused commits: licensing `5fd8ced`, previously tested modal stabilization `c94a327`, and this documentation slice. The local personal/business planning is outside the Git repository and excluded. This documentation slice does not implement K18/K19/K24 runtime recovery or authorize commercial expansion. Earlier review snapshots describe the then-uncommitted state; remote synchronization and hosted CI are separate checks, not assumed from local validation.

Validation for this slice: **175 local documentation links/fragments passed**, six JS license/private declarations passed, the local planning folder was verified outside the Git worktree, public Markdown contains no private-folder/file reference or explicit personal career-planning statement, frozen-lockfile consistency and tracked whitespace checks passed. Link totals differ from earlier runs because public guide content changed and this checker excludes fenced source examples. No new runtime suite was needed for documentation and package-description changes; the earlier 226-test run is retained as prior evidence, not a fresh run.

## Priority and next acceptance gates

**Decision: architecture stays; hold M3 feature expansion until the data/job stabilization gates pass.** M1-M2 capabilities exist, but "M2 complete" is not "all reliability risks closed."

1. **Test ownership and project/job isolation (P1): passed locally.** K33/K22/K16/K8/K25/K31 have maintained regressions. Preserve them when changing persistence, job callbacks or shutdown. This is not hosted-CI or all-filesystem acceptance.
2. **Persistence integrity: passed locally.** K23/K27 regressions cover invalid saved relationships, backup preservation on failed save and recent bookkeeping/core outcome separation. No saved-schema migration was needed.
3. **User-visible recovery:** K17/K30 modal/input integrity passed locally. K18/K19 plus K24/K26/K32 remain: export retry states, close failure, operation-aware deadlines, media-event loss and preview cuts/end/errors. Do not describe all editor errors as covered by the launcher's catalog.
4. **Finish diagnostics scope:** K29 then K21 in-app nonblocking alerts, periodic checks, usage/target/protected reporting and Open logs / Preview cleanup / Retry. Reuse the verified retention policy rather than duplicating deletion logic. Decide alert interval/deduplication and drive scope before implementation.
5. **Preserve a reviewed baseline:** approved commit/push, hosted JS/vision/Windows checks and any pending manual acceptance. Never commit or publish as a side effect of a review.
6. **M3-A:** serialized client planning/history and Undo/Redo (K12); then M3-B gesture/save strategy (K13), then M3-C relink/tracks with a defined preview/export media contract.
7. **M4-M6:** guidance, proposals, evaluated jump-cut candidates. Packaging only if feedback requires it; captions/mobile remain deferred.

Resources: existing Node/pnpm/FFmpeg and Python tooling are sufficient for stabilization/M3. No new models, GPU, paid services or dependencies are needed just to review or fix these lifecycle boundaries. Allocate new UI-test tooling only when implementing its test coverage; benchmark model resources in the AI milestones.

## Efficient future reviews

Apply the [maintainer-purpose and scope gate](./01-overview-and-scope.md#maintainer-purpose-and-scope-gate) to every full review and significant feature proposal. Explain community/workflow/QA value, maintenance and time costs, milestone fit and open-source compatibility. Hold unapproved commercial/enterprise/platform expansion; sponsorship and permissive licensing do not themselves authorize more features or release commitments. Personal/business planning stays outside the public repository; ask the owner about capacity rather than publishing private assumptions.

| Trigger | Required scope |
|---|---|
| Any change | Changed subsystem plus its UI/API/persistence/job consumers; related docs; smallest relevant tests |
| Project/schema/history change | S01-S05 plus migration/backup/failure and rapid-edit tests |
| Job/cancel/process change | S03-S07, S09-S12; concurrent start, switch, close, cancellation at each phase and cleanup retry |
| Modal/layout/input change | S05/S06/S08; pointer and keyboard checks at minimum/default window sizes; focus restoration |
| Logging/retention/config change | S09/S11/S12; malformed settings, exact thresholds, active/unknown/in-use logs, dry-run side effects and result shape |
| AI/model/prompt change | S01/S09/S13 plus R4 for new model/artifact integration; proposal evals, no-mutation boundary, empty/ambiguous results and labelled action clips |
| Full review | All subsystem rows plus dated R1-R5 gate status; remind the owner of pending licensing decisions without blocking unrelated routine development |
| Contribution intake or open-source positioning | S14 plus R1/R2; owner-approved project license, contribution rights and accurate independent claims |
| Milestone/release/demo claim | All rows; refreshed evidence ledger, manual vertical slice, status/docs/marketing claims, relevant platform acceptance and applicable R1-R5 publication gates |

For the next review, update this snapshot rather than creating another review-plan file. Keep source links and issue status current, retain meaningful acceptance evidence in tests/backlog, and remove stale claims. Do not skip an area solely because it passed a prior review.
