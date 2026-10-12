# 16. Review Plan and System Status

[Back to index](./README.md)

This is the reusable starting point for system reviews, not a claim that every path is tested. Use it with [Milestones](./09-milestones.md), the authoritative issue IDs in [Known issues](./10-future-features.md), and the [Run guide](./13-run-and-manual-testing.md). Do not maintain competing issue lists here.

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
5. **Collect evidence.** Reuse existing tests first. For findings, record source links, impact, conditions, priority and whether reproduced or source-confirmed. Separate future design risks from present bugs. Use synthetic media/isolated folders; leave user projects and unrelated processes untouched.
6. **Validate the exact requirement.** Test thresholds and result shapes, not just a green command. UI/accessibility claims need component or manual evidence. A helper test does not prove dialog focus or click behavior.
7. **Update records.** Add/update issue IDs in the backlog, refresh this matrix and evidence ledger, and correct directly affected status statements. Mark a fix verified only after its regression passes. List deferred checks explicitly.
8. **Make the gate decision.** State proceed/hold, next bounded slice and acceptance criteria. Do not expand scope automatically or turn review findings into runtime fixes without agreeing the work.

### Finding record

Use: `ID | priority | surface / specialist lens | failure condition and user impact | reasoning / violated contract | source/reproduction | next action | verification needed | status`.

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
| S08 UI/accessibility/layout | Landing/editor, native pickers, persistent resizable panes, assistant placeholder, save status and export dialog | [Landing](../apps/client/src/components/Landing.tsx), [Dialog](../apps/client/src/components/ExportDialog.tsx), [Layout](../apps/client/src/layout.ts), [CSS](../apps/client/src/styles.css) | Gate background shortcuts and contain/restore focus (K17). Expose export API failures (K18). Clamp layout to actual window size (K28); verify pickers (K3). No Settings, drag/drop, search, frame-step or caption UI. | Stabilization; UI tests before M3 |
| S09 Engine/API/diagnostics | Loopback service, typed lifecycle/store/recent failures and successful project warnings, token/Origin checks and health probes | [App](../apps/engine/src/app.ts), [API client](../apps/client/src/projectApi.ts), [Config](../apps/engine/src/config.ts) | No unified unexpected-error code/logging pipeline (K26); no general API timeout (K24). Recent-list errors now reach landing instead of false empty success; other silent paths remain. Cache health probes (L5); dev-token behavior is L4. Not a dedicated vulnerability audit. | Error-observability slice; before distribution |
| S10 Electron/process lifecycle | Dynamic engine port/token, isolated preload, native dialogs, engine parent-exit watchdog | [Desktop](../apps/desktop/src/main.ts), [Launch helpers](../apps/desktop/src/engineLaunch.ts), [Watchdog](../apps/engine/src/parentWatch.ts) | Check actual engine exit/startup dialogs and close with jobs active. Helper/launcher tests do not cover all renderer, picker or navigation interactions (L6/K3). Other desktop platforms unverified. | Desktop acceptance; packaging only when needed |
| S11 Windows launcher | Readiness, owned PID/time/tree cleanup, rollback, locks and suite isolation | [Common](../scripts/launcher-common.ps1), [Start](../scripts/start-app.ps1), [Stop](../scripts/stop-app.ps1), [Tests](../scripts/test-launcher.ps1) | K15/K20 pass locally. Preserve unrelated services; refused starts and failed stops must be visible. Hosted Windows runner and real launcher-owned Ollama remain unverified. | Hosted CI after an approved commit/push |
| S12 Retention/storage warnings | Per-session logs, JSON age/soft-budget policy, protected sessions, terminal warnings and manual dry run | [Policy](../scripts/log-retention.ps1), [Safety tests](../scripts/test-log-retention.ps1), [Cleanup](../scripts/cleanup-logs.ps1) | K21 remains partial: no in-app warnings/timer/controls. Failures after partial deletion need accurate results/retry metadata (K29). Disk warning covers log drive, not all project/export drives. Legacy logs count but are not deleted. | Finish CLI error semantics; then UI integration |
| S13 AI/vision | Ollama/vision health probes; Python health stub only | [Assistant design](./06-ai-assistant.md), [Pipeline design](./07-jump-cut-pipeline.md), [Vision stub](../apps/vision/app/main.py) | No chat/action tools, CLIP, inference jobs or evaluations. M4 guidance cannot mutate; M5 proposals require validation; M6 needs labelled clips, cancellation, candidates and measured timing. | M4-M6 only after manual workflow gate |
| S14 Docs/quality/distribution | Indexed docs, isolated media/export fixtures, Vitest, lint/typecheck, Linux JS/vision CI and Windows checks | [CI](../.github/workflows/ci.yml), [Test strategy](./12-testing-and-settings.md), [Marketing](./14-content-and-marketing.md) | K33 verified locally with settled teardown and removal assertions; no sweep of prior temp folders. No component/Electron editing-flow automation or installer. Preserve an approved Git baseline; unpushed changes are not hosted-CI verified. | Each slice and release claim |

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

### Current open-issue inventory and priority order

Issue descriptions/status remain authoritative in the backlog. There are **17 open/partial K entries** and **7 unresolved/deferred L entries**; multiple rows below share a fix slice, not duplicate implementation work.

| Order / gate | Issue IDs | Work and acceptance requirement |
|---|---|---|
| Completed locally - test safety | K33 | Unique owned roots, settled teardown and fixture-removal/preservation assertions now pass. L6 component/Electron coverage stays open with the relevant UI slice. |
| Completed locally - project/job integrity | K22, K16; coupled K8, K25, K31 | Generation-bound imports/proxies, serialized duplicate/copy decisions, early export reservation, cancel/reset through finalization, writer settlement and no-overwrite output regressions pass. |
| Completed locally - persisted state integrity | K23, K27; watch K10 | Shared relational validation, backup-safe replacement/retry, nonfatal recent warnings and backup-only availability now verified. Migrations still precede saved-schema changes. |
| 3 - interaction/observable recovery | K17, K18, K19, K24, K26, K30, K32 | Modal input isolation and honest creation/cancel UX; API codes/timeouts with mutation reconciliation; used-asset export consistency; cut/end preview correctness and visible media failures. |
| 4 - diagnostics completion | K29, K21 | Explicit partial cleanup result/exit and accurate accounting; atomic/retryable metadata handling; then in-app usage/target/protected warnings, periodic monitoring and recovery controls. Agree interval/deduplication/drive scope before implementing UI monitoring. |
| 5 - M3 editing prerequisites | K12, K13, K28; L8 | Serialize client intent/state/history; one gesture/undo/save unit; viewport-aware pane sizes; define large-export limits before long jump-cut sequences. Do not force debounce if coalesced gesture commits satisfy the measured need. |
| 6 - scheduled maintenance/design hardening | K1, K3, K5, K9; L3, L4, L5, L7 | Manual PATH/port recovery, real picker acceptance, removed-asset proxy semantics, deferred drag/drop, non-dev token policy, cached health probes and a separately scoped hardening review before distribution. No exploitability conclusion is made here. |
| Conditional distribution | L2 | Package only when feedback needs installable builds; license/model/binary and platform acceptance gates first. |

Locally resolved K entries: K2, K4, K6, K7, K8, K11, K14, K15, K16, K20, K22, K23, K25, K27, K31, K33. Resolved limitation: L1. K7's missing-media reporting is implemented, but K19 still covers the export policy mismatch; K14's save-status UI exists, but K12/K24 cover broader state/error races. Hosted verification remains pending.

Features that are not bugs: M3 Undo/Redo UI, gestures, snapping, relink and track management; M4 chat; M5 proposals; M6 vision/candidates; Settings, independent audio/compositing, captions, mobile and GPU upgrades. Keep them as roadmap work, not "missing fixes" that endlessly block stabilization.

**Next bounded implementation recommendation:** shared modal/input policy (K17/K30): honest in-flight creation semantics and focus/background shortcut isolation with targeted component tests. Follow with export polling/cancel recovery and used-media consistency (K18/K19), then remaining K24/K26 observability and diagnostics. Do not restart the same broad review without a concrete new question.

## Priority and next acceptance gates

**Decision: architecture stays; hold M3 feature expansion until the data/job stabilization gates pass.** M1-M2 capabilities exist, but "M2 complete" is not "all reliability risks closed."

1. **Test ownership and project/job isolation (P1): passed locally.** K33/K22/K16/K8/K25/K31 have maintained regressions. Preserve them when changing persistence, job callbacks or shutdown. This is not hosted-CI or all-filesystem acceptance.
2. **Persistence integrity: passed locally.** K23/K27 regressions cover invalid saved relationships, backup preservation on failed save and recent bookkeeping/core outcome separation. No saved-schema migration was needed.
3. **User-visible recovery:** K17-K19 plus K24/K26/K30/K32; test modal focus/shortcut isolation and creation cancel/navigation, export retry states, close failure, media-event loss and preview cuts/end/errors. Do not describe all editor errors as covered by the launcher's catalog.
4. **Finish diagnostics scope:** K29 then K21 in-app nonblocking alerts, periodic checks, usage/target/protected reporting and Open logs / Preview cleanup / Retry. Reuse the verified retention policy rather than duplicating deletion logic. Decide alert interval/deduplication and drive scope before implementation.
5. **Preserve a reviewed baseline:** approved commit/push, hosted JS/vision/Windows checks and any pending manual acceptance. Never commit or publish as a side effect of a review.
6. **M3-A:** serialized client planning/history and Undo/Redo (K12); then M3-B gesture/save strategy (K13), then M3-C relink/tracks with a defined preview/export media contract.
7. **M4-M6:** guidance, proposals, evaluated jump-cut candidates. Packaging only if feedback requires it; captions/mobile remain deferred.

Resources: existing Node/pnpm/FFmpeg and Python tooling are sufficient for stabilization/M3. No new models, GPU, paid services or dependencies are needed just to review or fix these lifecycle boundaries. Allocate new UI-test tooling only when implementing its test coverage; benchmark model resources in the AI milestones.

## Efficient future reviews

| Trigger | Required scope |
|---|---|
| Any change | Changed subsystem plus its UI/API/persistence/job consumers; related docs; smallest relevant tests |
| Project/schema/history change | S01-S05 plus migration/backup/failure and rapid-edit tests |
| Job/cancel/process change | S03-S07, S09-S12; concurrent start, switch, close, cancellation at each phase and cleanup retry |
| Modal/layout/input change | S05/S06/S08; pointer and keyboard checks at minimum/default window sizes; focus restoration |
| Logging/retention/config change | S09/S11/S12; malformed settings, exact thresholds, active/unknown/in-use logs, dry-run side effects and result shape |
| AI/model/prompt change | S01/S09/S13; proposal evals, no-mutation boundary, empty/ambiguous results and labelled action clips |
| Milestone/release/demo claim | All rows; refreshed evidence ledger, manual vertical slice, status/docs/marketing claims and relevant platform acceptance |

For the next review, update this snapshot rather than creating another review-plan file. Keep source links and issue status current, retain meaningful acceptance evidence in tests/backlog, and remove stale claims. Do not skip an area solely because it passed a prior review.
