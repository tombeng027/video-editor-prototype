# 16. Review Plan and System Status

[Back to index](./README.md)

**Still-image export compatibility (2026-11-19, local):** the demo export reported
`Error opening input files: Option not found`. The same failure was reproduced
with a synthetic GIF on local FFmpeg: its demuxer rejects the exporter’s `-loop`
input option. The exporter now repeats the first decoded image frame in the
filter graph instead. Five focused export tests passed, including real GIF/PNG
overlays with exact frame counts and visible overlay near the end; engine
typecheck and changed-file lint passed. No project data or diagnostic records
were changed. Engine relaunch and retry of the original demo export are pending.

**Manual caption workspace / Preview (2026-11-10, local, uncommitted):** owner
chose to defer manual foundation testing until captions are available in the UI
and approved continuing. Captions now have a collapsed-by-default count/density
strip below the media timeline. The expanded lane shares zoom, horizontal scroll
and playhead, with a chronological text list and whole-frame selected-cue form.
Expanding makes room in the resizable timeline area. Add/Apply/Delete, constrained
move/edge-retime, split and chronological merge all use existing confirmed
autosave/history; split/merge batches are atomic Undo steps. Draft text/timing
does not save until Apply; invalid/overlapping timing is reported, not submitted.
Gestures cancel on Escape, capture loss/cancellation, project changes or edit
locks. Selecting cues pauses/seeks without altering media selection; caption
focus isolates media S/Delete shortcuts. Unrelated refresh preserves wording
drafts; late confirmation adopts a new saved cue instead of offering a duplicate
Add. Preview draws saved literal multiline text with fixed bottom-centered
white/shadow styling, independently of media transforms/crop. Editor playback
includes later caption ends; engine exports remain media-only and both the panel
and Export dialog warn explicitly. SRT/burn-in, styling controls and generation
remain future slices.

Focused checks passed **130 distinct tests across 8 files** (128 in the affected
workspace/Preview/timeline/export/Help gate, one selected Editor history test,
and one safe-integer drag regression added during final review). Client
typecheck, changed-file lint, production build and whitespace checks passed.
Existing >500kB bundle advisory remains. Browser inspection could not reach the
local app; no connection retries or user-project changes were made, and the
shared page was returned to blank. Desktop visual/manual acceptance remains
pending; the running dev client can receive these client-only changes. No
relaunch, full suite, CI, subagents, dependencies or commit for this slice.
Related model/command/UI/Preview/caption docs, Help and manual checks updated;
error catalog reviewed without new codes, unknown-error inbox review still
deferred. Next planned slice: SRT import/export and burned-in output.

**Caption foundation (2026-11-10, local, uncommitted):** owner accepted crop and
approved one plain-text lane, timeline-fixed manual cues and a schema-v2 save
format with explicit v1 migration. `captionCues` is separate from media tracks;
start/end use safe integer project frames with an exclusive end. Text is
nonblank, up to 2000 characters, retained verbatim. Cues cannot overlap; IDs share
the media entity namespace. `AddCaptionCue`, `SetCaptionCue` (text/timing) and
`RemoveCaptionCue` use existing atomic command/autosave/inverse history paths,
including exact original array-order restoration. Media edits do not move cues.
FPS changes and first-video FPS adoption are blocked once cues exist.
Saved v1 opens migrate in memory, retain existing optional media edits/timestamps,
and show a migration warning; opening alone changes no files. The next normal
save writes v2 and preserves the prior validated main backup. Unsupported versions
are explicitly rejected without fallback to an older backup or overwriting newer
data. Older binaries remain unsafe for upgraded projects; keep a separate copy.
The initial K10 v1-to-v2 migration path is now covered, not a guarantee of
arbitrary future-version compatibility.
Focused checks passed **207 tests across 11 files**, covering new schema/cue/
migration/persistence tests, existing reducer/persistence/project behavior,
first-import FPS guards, unsupported-open navigation and Help/catalog. Affected
schema/core/client/engine typechecks, changed-file lint, client build and diff
whitespace check passed; existing chunk advisory unchanged. New test copies
were adjusted to the schema/core packages' existing library targets before the
clean final gate. Docs/Help/catalog/manual migration checks updated; unknown-error
review remains deferred. No full suite, CI, subagents, commit or relaunch.
Caption controls, Preview subtitles, cue-based playback duration, SRT/burned-in
output and speech generation are deliberately unavailable in this slice.
Next: the collapsible caption workspace and manual editing/Preview.

**Crop constraint affordances (2026-11-10, local, uncommitted):** owner reported
the preceding in-place crop/menu correction looks good. Free-form and project
aspect choices are now disabled/greyed out until Crop is active in both the
right-click menu and Properties. Menu radio dots visibly mark the current shared
choice; Properties also labels Crop active/off and the selected constraint.
No saved crop data or render behavior changes. Focused checks passed **33 tests
across 3 files**, client typecheck, changed-file lint, build and whitespace check;
the existing chunk advisory remains. Help and manual steps updated. No relaunch,
full suite or subagents; this small UI change awaits desktop acceptance.

**Crop interaction and menu correction (2026-11-10, local, uncommitted):** owner
reported crop/resize interference and a clipped right-click menu, and explicitly
chose trimming edges in place rather than automatic refitting. Preview/shared
geometry and export now retain the original source scale/anchor; crop only trims
the visible source edges. This intentionally supersedes the earlier local
refitting behavior for existing crop insets; no project data migration is needed.
Export restores the exact crop onto a transparent original-sized footprint before
existing fit/transform/effects. Asymmetric visible bounds and subsequent resize
snapping follow the original transform anchor. Active Crop blocks move/resize,
Appearance and Fit, cancelling any pending transform gesture/draft. Menus are
fixed body portals above the editor, measured/clamped to the viewport, scrollable
when necessary, and dismissed by Escape/outside click/outside scroll/resize.
Focused checks passed **96 distinct tests across 7 files**, including **16**
export-argument/real-FFmpeg checks, source landmarks at identical exported pixels,
crop/zoom/fade bounds, exclusive gestures, odd-source drag mapping, portal placement
and dismissal, asymmetric snapping and existing Preview/Help behavior.
The known parallel-load two-point-zoom timing flake recurred; the owner approved
one isolated rerun, which passed. Affected schema/client/engine typechecks, lint,
client build and whitespace check passed; existing chunk advisory unchanged.
Browser visual verification could not connect to the local app; connection retries
were stopped and the shared browser was returned to blank. Desktop acceptance is
pending; engine export changes need an app relaunch. No full suite, CI, subagents,
commit or relaunch was performed for this correction. Docs/Help/manual checks
updated; error catalog unchanged and unknown-error review remains deferred.

**Crop controls (2026-11-10, local, uncommitted):** Preview Crop toggle, shared
right-click/Properties Free-form and Project aspect locked modes, four edge/four
corner handles and Properties source-percent fields with Apply/Reset/Cancel draft
are implemented. Drafts only change Preview; a completed gesture or Apply saves
one `SetClipCrop` through existing confirmation/autosave/history. Reset removes
crop without changing other clip edits. Escape, lost capture, cancellation and
blocked/changed selection discard gestures; clicks/no-ops do not save. Lock uses
source pixel dimensions and the current project ratio on each crop edit; extreme
ratios have explicit guidance. Draft source mapping is captured before live
refitting; numeric fields mirror canvas drafts. Crop gestures do not snap.
Focused checks passed **8 files / 89 distinct tests**, including crop geometry,
controls, cancellation/guards, existing Properties/Preview/Help, confirmed
crop Undo/Redo and the real-FFmpeg crop/zoom/fade pixel regression. The first
gesture assertions needed floating-point tolerances; the integration fixture
needed jsdom pointer-capture support before its clean rerun. A pointer-noise
regression now protects whole-source-pixel rounding. Client typecheck, changed-file
lint, production build and diff whitespace check passed; the existing chunk-size
advisory remains. Docs/Help/manual checks are updated; schema/error definitions
need no change. Unknown-error follow-up review remains deferred. No full suite,
CI, subagents, commit or app relaunch. Desktop crop acceptance is pending; the
owner has separately accepted Fit to canvas.

**Fit to canvas (2026-11-10, local, uncommitted):** owner reported the export
looked good and approved Fit preserving crop/opacity/effects. Preview and the
picture's right-click menu now center/reset base scale through `SetClipTransform`,
with normal autosave/history and pause-to-edit. Track locks and pending/closing
states are respected. This does not remove animated zoom; letterboxing is allowed.
The owner subsequently confirmed Fit works. Help, technical docs and manual checks are updated;
no new schema/error codes or catalog changes. Unknown-error review stays deferred.
Focused checks passed **4 files / 62 tests**, client typecheck, changed-file lint,
production build and `git diff --check` (existing chunk advisory unchanged).
The first new guard test caught cached track-lock state in the Preview action;
Fit now reads current project membership/locks. No full suite, CI, subagents or
app relaunch were run.

**Canvas handle alignment fix (2026-11-10, local, uncommitted):** owner reported
inset handles after resizing/moving a clip in 9:16 and switching to 16:9. A
confirmed mismatch was found: selection/hit-testing used resting appearance while
Preview applied zoom/animations. Selection, hit-testing and snapping now use the
displayed transform at the paused playhead. Gestures invert that transform before
saving appearance, preserving effects and avoiding double-applied zoom. The
exclusive timeline endpoint uses the same last included frame as Preview.
Fully offscreen slide endpoints cannot invert their position; handles are disabled
with playhead guidance. Focused canvas/Preview checks passed **3 files / 53 tests**,
client typecheck and changed-file lint; **6 Help tests**, client production build
and `git diff --check` also passed (existing chunk-size advisory unchanged).
An isolated browser test with the actual
Preview and a synthetic image verified portrait-to-landscape changes and pane
resizing with maximum border error below **0.02 CSS pixels**; no user project was
modified. Owner retest is pending. No new error codes, full suite, CI or subagents;
unknown-error inbox review remains deferred.

**Crop rendering (2026-11-10, local, uncommitted):** saved crop now propagates
through every visual render segment and is applied before fit/transform/motion
in Preview and FFmpeg. Shared whole-source-pixel rounding retains at least one
pixel per dimension. Preview uses the original source window even for optimized
media. Canvas selection, hit-testing and resize snapping use cropped dimensions.
Focused checks passed **99 distinct tests**: **67** across
geometry/crop/Preview/canvas, **16** Help/render-plan tests, **14** export-argument
tests and **2** selected real-FFmpeg tests. The final Preview/canvas rerun passed
**44 tests**, including crop add/reset without media remounts or stale transforms
and cropped resize snapping. Real exports cover asymmetric
odd-pixel video/image crops, portrait/landscape fit, zoom/fade, and uncropped
placement. Affected typechecks, changed-file lint and client build passed; the
existing >500 kB chunk advisory remains. No full suite, CI or subagents were used.
The existing error definition needs no change; Help and technical docs distinguish
render support from pending controls. Manual crop acceptance is deferred until
controls exist; no app relaunch was performed and inbox review remains deferred.
Next: Crop toggle/right-click modes, Properties fields and canvas handles.

**Canvas aspect controls (2026-11-10, local, uncommitted):** Preview now offers
16:9, 9:16, 1:1 and 4:3 through `SetProjectCanvas`. The control changes project and
export dimensions together, preserves clip edits, pauses playback, and uses normal
autosave/history/recovery. The long edge is preserved where possible with even,
exact-ratio dimensions. Custom original dimensions are restored exactly by Undo.
Focused evidence: **44 tests** across aspect/crop/catalog/Help, the preview suite,
**2 selected editor aspect tests**, **1 selected engine persistence test**, and
**1 selected real-FFmpeg test** verifying all four MP4 shapes and letterboxing.
Affected schema/core/client/engine typechecks, changed-file lint and client build
passed (existing >500 kB chunk advisory). The initial aspect tests compared fixture
timestamps from separate wall-clock calls; fixed timestamps now make the fixtures
deterministic, including the tightly related crop fixture. No full suite, CI or
subagents were used. Manual desktop acceptance and an app relaunch are pending.
Crop rendering and controls remain the next slice; inbox review remains deferred.

**Crop foundation (2026-11-10, local, uncommitted):** owner-approved controls are
a Crop toggle and right-click Crop section, Free-form or project-canvas-aspect-locked
modes, with both Properties fields and canvas handles. Only the data/command slice
is implemented: optional visual-only crop insets, `SetClipCrop`, exact inverse,
saved-project validation, and `INVALID_CROP` in the shared catalog/Help error list.
Preview, export, controls and manual crop acceptance are still pending; cropped
projects are not ready for production use. Focused checks passed **5 files / 111
tests**, plus **1 selected engine autosave/reopen/Undo/Redo test** (36 unrelated
engine tests skipped), affected schema/core/engine/client typechecks,
changed-file lint, client production build and `git diff --check`. The build
retains its existing >500 kB chunk advisory. The first typecheck found a test-only `structuredClone` call
outside the core package's configured libraries; the fixture copy now uses its
existing factory instead. The full suite, CI and a new app launch were not run.
The dedicated unknown-error inbox review remains deferred; recording is unchanged.
Next: shared crop preview/canvas geometry and export parity before enabling UI.

This is the reusable starting point for system reviews, not a claim that every path is tested. Use it with [Milestones](./09-milestones.md), the authoritative issue IDs in [Known issues](./10-future-features.md), and the [Run guide](./13-run-and-manual-testing.md). Do not maintain competing issue lists here.

For issue diagnosis and before implementing an approved fix, use [QA and Fix Readiness](./17-qa-and-fix-readiness.md): compare QA acceptance conditions with the engineering cause/fix assessment, investigate factual disagreements, and escalate unresolved product or risk decisions to the user.

**Latest gate evidence (2026-11-03, K29 follow-up):** the accumulated recovery, media freshness and diagnostic changes are local and uncommitted. The JavaScript workspace suite passed **25 files / 327 tests**; the vision suite passed **1 pytest**; Windows launcher and log-retention integration scripts passed; workspace lint/typecheck, client production build and `git diff --check` passed in the full local review. The K29 follow-up then passed expanded Windows retention failure-injection/CLI checks and the launcher integration rerun. The launcher test checks the engine-owned socket without depending on the Windows TCP state label and uses an ephemeral mock Ollama endpoint; the optional real owned-Ollama scenario was not run. No hosted CI or fresh manual browser/native-picker/accessibility acceptance was run. K18/K19/K29/K32 have local coverage; K24/K26 remain partial, and K21's in-app monitoring/cleanup UI remains pending. K29's cleanup prerequisite is met locally. The earlier recommendation to finish K24/K26 before M3 is superseded by the owner's decision to proceed toward a demo while keeping these items open. Current inventory: **23 locally resolved / 11 open or partial**. R1 source licensing/contribution terms remain documented; R2 needs per-promotion checks, while R3/R4/R5 remain trigger-based publication gates. No live release/legal clearance was checked.

**K29 retention follow-up (2026-11-03):** cleanup results now distinguish `completed`/`partial`/`failed` with CLI exit codes `0`/`2`/`1`; JSON stays on stdout while coded warnings go to stderr and the local log. Remaining storage is remeasured after deletion and warning writes, including partial failures; failed sessions remain identified for retry. Close metadata uses a same-directory atomic replacement. Deletion holds delete-compatible handles through removal and removes nonmetadata files before `session.json`, preserving metadata when a file is locked. The isolated Windows retention suite passed with lock/failure/retry injection, metadata write failure, byte-accounting checks and direct CLI exit/output assertions. No hosted verification was run; K29 is locally fixed, while K24/K26 remain partial and K21 UI remains pending.

**Editing features slice (2026-11-04 to 2026-11-05, local, uncommitted):** entrance/exit animation catalog (five presets each, percentage lengths on one shared two-handle bar), slider + − / + appearance and speed controls (Properties Trim removed as a duplicate of edge trimming), one two-point zoom per visual clip with timeline diamond markers, selection kept on empty timeline clicks and Escape to deselect, Split audio (`SplitAudio`/`INVALID_AUDIO_SPLIT`), and timeline-as-truth audio (export sums every stacked visual clip's sound like preview; video/overlay tracks gained Mute), and canvas editing in Preview (select top-most picture, drag to move, proportional corner resize, snapping guides with Alt/Snap toggle, pause-to-edit, right-click layer order via existing track commands; Preview/export placement verified by a real-FFmpeg pixel check; free resize and crop backlogged; owner tried it on the desktop on 2026-11-05 and reported it works). Each slice passed focused tests including real-FFmpeg export checks, affected typechecks, changed-file lint and the client build; the last client+packages run passed 461/462 with one known parallel-load flake (zoom Properties or modal relink) that passes alone. **Full local gate (2026-11-05):** the JavaScript workspace suite passed **37 files / 628 tests**; workspace lint and typecheck, the client production build and `git diff --check` passed. The first run found 3 engine tests with outdated expectations from earlier uncommitted slices (not product regressions): a persistence "invalid transform" case that became valid when position bounds widened, a duplicate-import case expecting `UNSUPPORTED` instead of the newer `ALREADY_IMPORTED`, and a proxy-callback case that relied on import queueing proxies automatically. The tests were updated to exercise the intended rules. Vision pytest, Windows launcher scripts and hosted CI were not run. Owner desktop acceptance is pending for all of these; crossfades and multiple zooms per clip are deferred ([future features](./10-future-features.md)). The unknown-error inbox was reviewed on 2026-11-05 and is empty.

**Frame-step slice (2026-11-09, local, uncommitted):** the approved pre-change JavaScript gate passed **39 files / 642 tests**, workspace lint/typecheck, client production build and `git diff --check`. Previous/Next frame transport buttons and Left/Right arrow shortcuts now pause and move one project frame, bounded to included frames, without editing the saved project. Post-change focused checks passed **6 files / 176 tests**, client typecheck, changed-file lint, client production build and `git diff --check`; owner desktop acceptance remains pending. The initial focused run found a test selector for a nonexistent timeline zoom slider; the test was corrected without changing product behavior. **Button icon pass (2026-11-10):** transport and Split/Delete buttons now use Lucide icons (`lucide-react`) with a primary Play button and a visible keyboard focus ring; aria-labels and tooltips are unchanged. Focused component tests, typecheck, lint, build and `git diff --check` passed (the known clipProperties zoom test flake passes alone). **About credits (2026-11-10):** the Help About tab now shows the developer credit, a thank-you note, external support links (opened in the system browser by the desktop shell) and open-source credits; it stays static and offline. The build retains its existing >500 kB chunk-size advisory. Crop is next for planning, not yet implementation. Dedicated unknown-error inbox review remains deferred by the owner; records and automatic recording are unchanged. No CI, vision or launcher integration suites were run.

**Demoable media direction (owner decision):** proceed with media editing before the remaining stabilization gate is fully closed. Approved behavior: stills default to five seconds and are adjustable by trimming; overlapping visual tracks composite with higher tracks in front; audio clips preserve natural duration, loop when extended, and live on addable/reorderable/muteable audio tracks. Still-image import/insertion/preview are implemented: supported stills import with a five-second project-frame duration, can be added to the first visual track, and render through a token-protected engine source route. The owner confirmed images can be added to the timeline but deferred remaining image issues; this is not full manual image acceptance. K17's reported keyboard-focus failure and partial K24/K26 coverage remain open; they are deferred, not passed.

**Visual demo slice (2026-11-03):** added edge-drag trimming, visual-track creation and adjacent reordering, back-to-front multi-layer preview, and layered video/image FFmpeg export. Focused validation passed **6 files / 96 tests**, including a real FFmpeg pixel check, plus affected-package typechecks and changed-file lint. Manual acceptance for visual trim/order/compositing is still unchecked in the run guide; simultaneous-video sync remains approximate. Audio placement, track controls, synchronized audio and loop-on-extension export remain deferred.

**Audio timeline slice (current):** audio assets can be added at the playhead on dedicated audio rows, with new rows created when existing rows are occupied. Audio clips can be dragged and trimmed; forward moves and extensions apply the same next-clip head trim / consume-and-ripple behavior as visual tracks. Audio rows can be added, reordered and muted. Browser preview synchronizes independent audio elements to the shared playhead and loops extended clips; FFmpeg export includes audio-only tails, loops sources and mixes unmuted audio rows with the visual audio bed. Focused validation passed **9 files / 154 tests**, plus schema/timeline-core/client/engine typechecks and the client production build; manual audio acceptance remains pending. Audio/video sync is approximate, not sample-accurate.

**Visual clip movement/snapping slice (current):** dragging a visual clip moves it along its existing track without changing its source range. Clicks without a drag still scrub. Either edge snaps within 8 screen pixels to time zero, the playhead or another visual clip edge, with a guide shown during the draft; same-track overlap behavior remains governed by the timeline reducer. Manual acceptance remains pending.

**Trim interaction correction (2026-11-03):** trim drag now anchors to the actual pointer-down position, captures pointer events on the timeline container, and commits the final pointer-up position. This avoids handle-width-dependent trim offsets and missed commits; a focused regression covers extending a previously shortened clip back to its source limit. Validation passed **4 focused files / 71 tests**, client typecheck and changed-file lint. Manual playback acceptance remains pending.

**Timeline playhead alignment correction (2026-11-03):** removed a duplicate track-label offset from the red playhead positioning so its visual position matches the frame selected by timeline clicks and scrubbing. Focused timeline validation passed **2 files / 25 tests**; client typecheck/lint and `git diff --check` passed. Refresh/reopen the client to load the updated renderer before manual confirmation.

**Preview pause after clip transition (2026-11-03):** invalidate pending native `play()` requests on pause or source change, pause video elements when sources change and on component cleanup, and prevent stale play-promise completions from restarting playback. The focused preview suite passed **16 tests**; client typecheck and changed-file lint passed. Manual playback acceptance remains pending.

**Same-track trim collision behavior (2026-11-03):** extending a clip trims the head of the next clip when some of it remains, preserving that clip's end. If the extension would consume the next clip, that clip moves intact and following clips ripple forward as needed. The timeline shows affected clip positions/ranges during the drag; `MoveClip` inverses and trim inverses restore the original state. Focused validation passed **5 files / 82 tests**, affected-package typechecks and changed-file lint. Manual acceptance remains pending.

**Command recovery follow-up:** command batches now accept attempt UUIDs and expose bounded in-memory pending/done/failed/unknown status. The editor checks ambiguous outcomes without resubmitting, locks edits/navigation while unresolved, and requires authoritative refresh plus explicit confirmation for unknown outcomes. Focused validation passed: **3 files / 75 tests**, workspace typecheck, changed-file lint, client production build and `git diff --check`. At this checkpoint, the full suite had not yet been rerun after command recovery; the later full local gate at the top of this document supersedes that validation status. The command-recovery work and preceding media/proxy/preview follow-ups remain uncommitted.

**K24/K26 follow-up (2026-11-03):** proxy SSE recovery now has focused coverage for malformed JSON/schema events, failed snapshots preserving last-known status, disconnect/reconnect reconciliation and stale snapshots after engine-config changes. Recent-project and default-folder GETs now have 15-second deadlines and explicit retry controls. Export cleanup failures now use safe correlated background diagnostics and expose the diagnostic ID; import/command status UIs also retain IDs. Validation passed: **65 tests across 5 focused files** (28 filtered), workspace typecheck, changed-file lint, client production build and `git diff --check`. At this checkpoint no full suite, hosted CI or platform acceptance had been run. Broader media/API edges and expected/background-error coverage remain open; health presentation and durable diagnostic capture were added in the subsequent diagnostic follow-up below. The later full local gate at the top supersedes this validation status. These changes are local and uncommitted.

**K24/K26 diagnostic follow-up:** health details/recovery hints now display inline for unavailable or unknown components. Unexpected per-file import failures use safe structured diagnostics and expose the ID in the import failure UI; generic background export failures retain their user-facing message and add a correlated ID without logging the message. The engine now persists structured records under its data directory with three 1 MiB files per run, 14-day inactive-run retention, and a 10 MiB soft aggregate budget; active/uncertain runs are preserved, stderr capture remains intact, and sink failures do not fail engine operations. Sink/error-correlation validation passed: **10 tests across 3 focused files**; workspace typecheck and changed-file lint passed. The earlier UI/recovery slice passed **14 tests across 5 focused files**, workspace typecheck, changed-file lint and client production build. At this checkpoint no full suite, hosted CI or manual platform acceptance had been run; the later full local gate at the top supersedes this validation status. Broader media/API freshness cases remain open. These changes remain local and uncommitted.

**K24 media freshness follow-up:** media-status now returns the active project ID, and the engine rejects the filesystem-scan result if project generation, identity, folder or saved project revision changed while checking. The editor ignores mismatched-project responses and rechecks when asset identity/source metadata changes, not merely when asset count changes. Validation passed: **4 focused tests across 2 files**, workspace typecheck and changed-file lint. No full suite or hosted CI was run. This closes the identified offline-media snapshot ownership edge, not every remaining media/API case; local changes remain uncommitted.

**K24/K26 verification and documentation follow-up (2026-11-03):** reviewed shared API deadline/result handling, operation recovery and project identity guards, proxy reconciliation, preview retry, diagnostic allowlisting/persistence, and relevant UI/test coverage. Corrected stale run-guide statements: editor API calls use the shared 15-second deadline, and structured engine diagnostics are persisted as well as written to stderr. K24/K26 remain partial; the run guide now defines focused acceptance for API failure edges, expected-domain codes, correlation, and the limits of redaction/capture. Focused validation passed: **9 files / 158 tests** across client recovery/preview/proxy and engine diagnostic/project/media/export tests. The diagnostic-sink warning was expected from a test simulating an invalid log directory. No full suite, hosted CI or native/manual acceptance was run; documentation and accumulated code changes remain local and uncommitted.

**K24 API failure-matrix follow-up (2026-11-03):** added a focused regression matrix for all 16 client API wrappers: rejected fetch, non-JSON HTTP error, schema-invalid success, 15-second timeout/abort, and stalled body parsing. Existing UI tests cover recent/default-folder retry, ambiguous mutation recovery, media refresh failures/project mismatch, proxy disconnect/reconciliation and preview retry. Validation passed: **4 focused files / 79 tests**. No production behavior change or full-suite rerun; K24 remains partial pending broader media/API edge acceptance and manual platform checks. Changes remain local and uncommitted.

**K24 stale media snapshot follow-up (2026-11-03):** added an Editor-level regression that changes asset content identity within the same project while an older media-status request is in flight, then resolves the old response after the refreshed snapshot. The old offline result is ignored. The focused modal/editor suite passed: **38 tests**; client typecheck, targeted lint and `git diff --check` passed. No production behavior change or full-suite rerun; K24 remains partial for additional API/media edges and manual platform acceptance.

**K24 stale lookup response follow-up (2026-11-03):** added Landing/New Project UI regressions where old recent-project and default-folder requests resolve after an engine-config change; only the new configuration's result is applied. Added explicit coverage that a user-entered folder is preserved when the default lookup resolves late (alongside the existing explicitly-cleared-location case). Focused modal/Landing suite passed: **41 tests**; client typecheck and targeted lint passed. No production change or full-suite rerun; K24 remains partial pending broader media/API edges and manual platform acceptance.

**K24 project refresh recovery follow-up (2026-11-03):** verified the Editor path triggered after proxy completion: an unreachable authoritative project read displays its code and retry action without replacing the current project; a successful explicit retry adopts the refreshed state and clears the error. Focused modal/editor suite passed: **42 tests**; client typecheck, targeted lint and `git diff --check` passed. No production behavior change or full-suite rerun; K24 remains partial.

**K24 import status retry follow-up (2026-11-03):** added an AssetsPane regression where import times out, the first status request is unreachable, and a later check confirms the same attempt completed. The path remains locked after the failed status read; success adopts the project without resubmitting import. Focused AssetsPane suite passed: **16 tests**; client typecheck and targeted lint passed. No production behavior change or full-suite rerun; K24 remains partial.

**K24 command status retry follow-up (2026-11-03):** added an Editor regression where a command times out, its first status check is unreachable, and a later check confirms completion. Editing and Projects navigation remain locked after the failed read; the retry checks the same attempt, unlocks only after completion, and does not resubmit the batch. Focused modal/editor suite passed: **43 tests**; client typecheck, targeted lint and `git diff --check` passed. No production behavior change or full-suite rerun; K24 remains partial.

**K24 close/reopen stale-refresh follow-up (2026-11-03):** added an App-level regression that starts an authoritative refresh in one Editor, closes and reopens the same project, then resolves the old response. The reopened editor retains its own project state. Related close, export-status, media-refresh and proxy reconciliation UI failure/retry cases were already present in focused tests; the close/reopen case passed in the combined targeted run: **3 files / 70 tests**. Client typecheck, targeted lint and `git diff --check` passed. No production behavior change or full-suite rerun. Native picker, browser codec and accessibility checks remain manual acceptance; K24 remains partial.

**Owner manual acceptance report (2026-11-03):** owner reports native picker and preview-recovery checks “seem to pass”; keyboard check failed because Tab/Shift+Tab traversed menus and Escape had no effect. The uncertain-operation scenario was not attempted. This contradicts relying on component tests alone for K17 focus behavior; K17 manual acceptance is now recorded as failed/pending reproduction. Owner considers current stabilization adequate to proceed toward a demoable product, while still identifying missing image timeline support and audio-track placement as product gaps. Images are explicitly rejected by engine import; audio import is supported, but the Assets pane only exposes timeline placement for video, and separate audio tracks do not currently play in preview or export. Exact image duration/audio placement-and-mix behavior needs owner decision before implementation.

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
| S02 Projects/persistence | Queued create/open/save, validated main/backup, atomic replacement, explicit bookkeeping/preparation warnings and bounded attempt recovery | [Session](../apps/engine/src/session.ts), [Routes](../apps/engine/src/projectRoutes.ts), [Store](../apps/engine/src/projectStore.ts), [Persistence tests](../apps/engine/src/persistence.test.ts) | K27 preserved; K24 create/open deadline and generation-guarded current-result recovery verified locally. Preparation warning preserves committed identity. Records are volatile/bounded, not power-loss/fsync or multi-engine guarantees. Migration remains K10. | Remaining recovery/diagnostics; before schema changes |
| S03 Import/media identity | Reference/copy import, metadata, sampled hash, serialized engine commit and generation ownership; client picker lifecycle guards | [Importer](../apps/engine/src/importer.ts), [Assets pane](../apps/client/src/components/AssetsPane.tsx), [Lifecycle tests](../apps/engine/src/lifecycle.test.ts) | K22/K8/K31 maintained; K24 picker recovery/late-selection discard and import codes verified locally. Sent-import timeout/reconciliation and stale Editor refresh ordering remain open. Hash is not full integrity proof; no crash orphan sweep. | Remaining recovery/diagnostics; K12 before history |
| S04 Proxies/media transport | Serialized CFR proxy generation, generation-bound completion, settled reset/shutdown, SSE/ranges and missing-proxy resume | [Proxy manager](../apps/engine/src/proxy.ts), [Media routes](../apps/engine/src/mediaRoutes.ts), [Client hook](../apps/client/src/useProxyStatus.ts) | Deferred callback/reset and writer-close tests now pass. Asset-removal semantics remain K9; SSE loss/bad payload and refresh failures need visible recovery (K24). No dedicated proxy retry UI. | Error/stream recovery slice |
| S05 Timeline/editing | Add video to one track, select, split/delete, scrub/zoom; engine owns state | [Editor](../apps/client/src/components/Editor.tsx), [Timeline](../apps/client/src/components/Timeline.tsx), [Operations](../apps/client/src/timelineOps.ts) | Rapid edits and background refreshes must not adopt stale state (K12). Undo/redo buttons are disabled; move/trim gestures, snapping, relink and track management are planned. One commit per gesture/save strategy remains K13. | M3-A, then M3-B/C |
| S06 Preview/audio | One video element, shared clock, inclusive clip/proxy clamps, source-continuity seek and boundary hold, video audio and rate control | [Preview](../apps/client/src/components/Preview.tsx), [Preview regressions](../apps/client/src/components/preview.test.tsx), [Playback](../apps/client/src/playback.ts), [Clock](../apps/client/src/clock.ts) | K32 locally verified with component and decoded-colour media evidence; approximate seeks/rates/codecs not fully certified. Missing/corrupt proxy and rejected play still need K24 states. No preloading, separate audio or transform rendering. | Remaining media/error recovery; explicit M3 contract |
| S07 Render/export | Originals, flattened top-track plan, MP4 preset, progress, duration verification, generation-bound reservation and unique exclusive outputs | [Plan](../packages/timeline-core/src/renderPlan.ts), [Exporter](../apps/engine/src/exporter.ts), [Lifecycle tests](../apps/engine/src/lifecycle.test.ts) | K16/K25 maintained; published K18/K19 recovery plus local K24 correlated export-start recovery pass. Unknown starts remain locked until matching status; no durable history/idempotent retry. Hard-link publication requires support; many-cut length is L8. | Preserve lifecycle/recovery; remaining K24/K26 |
| S08 UI/accessibility/layout | Landing/editor, native pickers, persistent panes, shared modal policy, save status and create/open/export/close recovery | [Landing](../apps/client/src/components/Landing.tsx), [Project recovery](../apps/client/src/useProjectOperation.ts), [Modal](../apps/client/src/components/Modal.tsx), [Dialog](../apps/client/src/components/ExportDialog.tsx), [Close consumer](../apps/client/src/App.tsx), [CSS](../apps/client/src/styles.css) | K17/K30 maintained; K18 retry/cancel and partial K24 operation recovery verified in recorded scopes. Native recovery smoke uses synthetic responses, not real picker/accessibility certification. K28 viewport/K3 picker checks remain. No Settings, drag/drop, search or caption UI. Frame-step controls implemented locally (2026-11-09), desktop acceptance pending. | Remaining recovery/layout gates |
| S09 Engine/API/diagnostics | Loopback service, typed lifecycle/store/recent outcomes, guarded close, project/export attempt recovery and common safe route diagnostics | [App](../apps/engine/src/app.ts), [API client](../apps/client/src/projectApi.ts), [Project routes](../apps/engine/src/projectRoutes.ts), [Session](../apps/engine/src/session.ts) | K24 operation deadlines/reconciliation maintained; mutation/media/event recovery remains. K26 partial: unexpected-route/preparation/operation code-ID correlation and safe stderr metadata verified; expected-domain/job/health and durable logging not fully integrated. Cache health probes (L5); dev-token is L4. Not a vulnerability audit. | Remaining K24/K26 recovery before expansion/distribution |
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
| S03 timebase policy | Fps adoption is planned against current state inside the session queue. Audio alone does not consume "first video"; a nonempty timeline prevents a rate change. Audio-first, mixed batch, concurrent, reopen and concurrent timeline-edit tests pass. | K31 locally verified; independent audio playback/editing UI is implemented with focused coverage, with manual acceptance pending. |
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

Features that are not bugs: M3 Undo/Redo UI, snapping, relink and broader visual track management; M4 chat; M5 proposals; M6 vision/candidates; Settings, sample-accurate audio sync, captions, mobile and GPU upgrades. Keep them as roadmap work, not "missing fixes" that endlessly block stabilization.

**Next bounded implementation recommendation:** export polling/cancel recovery and used-media consistency (K18/K19), with the closely related close-result visibility under K24. Follow with K32 preview boundaries and remaining K24/K26 request/event/media observability, then K29 before K21 controls. Do not restart the same broad review without a concrete new question.

## Legal and publication gate status

Initial snapshot: **2026-10-12, Philippines maintainer, public source prototype**. The initial live review found no project license and no GitHub releases/release assets; stabilization changes were then uncommitted. The later 12:34 review verified publication through `8866a97`, GitHub Apache-2.0 recognition and successful hosted CI. AI integration and packaged distribution remain planned. No legal clearance, trademark search or patent freedom-to-operate opinion is claimed.

The authoritative [R1-R5 backlog](./10-future-features.md#legal-and-publication-readiness-backlog) owns requirements and status. On 2026-10-12 the owner approved Apache-2.0 for original code/documentation: [LICENSE](../LICENSE), [scope/notice](../README.md#license-and-participation), package metadata and [contribution terms](../CONTRIBUTING.md) are implemented in source. The owner subsequently approved focused commits and push for licensing, modal stabilization and documentation; licensing commit is `5fd8ced`. Verify remote synchronization before outreach; the earlier no-license GitHub observation predates this publication batch. Third-party and per-contribution rights still need their applicable checks. Live GitHub About was verified after the owner's update with independent wording and AI explicitly planned. R2 source wording is corrected, with ongoing per-demo verification required.

**Current decision: proceed with routine development and the next approved stabilization fix.** The R1 license decision and contribution terms are published; per-contribution and third-party checks remain ongoing. Before promotion/demos/support collection, check R2/R5. Before model integration or download automation, check R4. Before the first downloadable alpha/beta/installer, check R3 and applicable R1/R2/R4/R5 requirements; do not defer compliance until after publication. Later recovery code remains local as stated in the latest gate.

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

## Published-baseline QA, engineering and legal-readiness recheck: 2026-10-12 (requested 12:34 +08:00)

### Scope and verification

- Baseline `8866a97992239bc99d8e1b7e23538b17aa92044d`, main, initially clean working tree; remote main independently matches. This is a follow-up gate review of the published slice, using the existing S01-S14 inventory and earlier cross-system evidence, not a new exhaustive line-by-line audit.
- [Hosted CI run 38203819548](https://github.com/tombeng027/video-editor-prototype/actions/runs/38203819548) completed successfully on this exact SHA: JS, vision and Windows launcher jobs all passed. Earlier "hosted pending" statements are historical, not the latest gate.
- Fresh local modal/API/export-status/project/persistence/export/lifecycle selection: **6 files / 107 tests passed**, including real FFmpeg. Client API/timeline and shared timeline-core selection: **5 files / 69 tests passed**. Total for these non-overlapping selections: **11 files / 176 tests**; this is not a fresh 226-test full-suite claim. Typecheck, lint and frozen-lockfile validation passed. VS Code test discovery returned no tests; the existing Vitest CLI supplied the evidence.
- Re-read shared modal, creation/picker/navigation, export start/poll/cancel, editor/API/close consumers, project hooks/session commit points, backup-save handling, render-plan asset selection and preview boundaries. No new demonstrated critical data-loss regression or higher-priority originating defect was identified within this scope. Existing tests do not cover all runtime interleavings.
- No fresh browser/native-picker, screen-reader, power-loss/disk-full, multi-engine, model inference or installer acceptance. Hosted vision tests verify the health stub, not AI capability. No dedicated vulnerability/secret-history audit or professional legal opinion was performed.

### QA versus engineering reconciliation

| Contract / priority | QA evidence and impact | Engineering response / required proof | Decision |
|---|---|---|---|
| K17/K30 modal isolation and committed-result adoption | Maintained component regressions pass locally and in hosted JS CI; earlier native-browser evidence remains available. | Preserve synchronous pending guards, native modal containment, successful results/warnings and opener focus. | Accepted within recorded coverage; no new modal redesign needed. |
| K18 export state must be observable and ordered | Source still ignores poll/cancel errors and permits overlapping interval polls; late responses can restore obsolete state. Medium provisional severity, P2 recovery priority; not a new runtime reproduction. | Non-overlapping lifecycle-owned polling, obsolete-response guards, coded error/retry UI and guarded cancellation. Cancel request acknowledgement is not job settlement: engine returns running until abort/cleanup completes. Use deferred/out-of-order responses and failure/retry tests. | Agreed next slice; do not claim cancellation completed early or allow unsafe restart. |
| K19 only render-used missing assets should block export | Client uses every offline asset; engine filters by shared render-plan asset IDs. Medium severity, P2; source-confirmed. | Reuse render-plan/asset helpers; test unused/offline, used/offline, hidden/audio-track and gap cases, preserving engine preflight authority. | Agreed; no new rendering/audio feature needed. |
| K24 close must not look successful when outcome is unknown | Client discards typed close result and immediately navigates; close hooks run after session commit. API has no general deadline. Medium provisional severity, P2; source-confirmed. | Preserve typed outcome, visible pending/error/recovery and authoritative reconciliation when commit/transport is uncertain. Test failure, delayed response, post-commit failure and retry without switching the wrong project. Do not blindly retry mutations. | Closely related bounded work; wider create/open/media/event recovery remains explicitly open. |
| K32/K12/K26 and K29 before K21 | Preview cut/end, command ordering, diagnostics and cleanup reporting still have known coverage/behavior gaps. | Keep existing backlog sequence; real-media preview evidence, state-ordering tests and cleanup failure injection remain necessary. | Not closed by green CI; hold dependent M3/cleanup-UI expansion. |

No unresolved QA-versus-engineering product conflict was found for this gate decision. If implementing bounded close recovery requires changing navigation semantics, or requests need a new mutation-retry policy, reconcile the precise acceptance conditions and escalate material behavioral choices before editing runtime code.

### Legal/publication and documentation outcome

- GitHub API now recognizes **Apache-2.0**; live About accurately lists implemented features and marks AI as planned. Root license exactly matches official Apache text after line-ending normalization. Original-work scope and contribution terms remain published; private package flags are not license restrictions.
- Current tracked-file listing contains **136 files**, no private planning file, and no media/model/executable/archive candidates in the inspected extension set. This is current-tree inventory evidence, not exhaustive provenance, transitive-dependency or historical-secret clearance.
- R1 source licensing/publication requirements are met for this baseline, subject to ongoing per-contribution rights checks. R2 wording is published and remains a per-demo obligation. R3 exact binaries/notices/codecs, R4 exact model conditions and R5 demo/support permissions/privacy remain open at their respective triggers, not blockers to ordinary source stabilization.
- Apache-2.0 generally permits proprietary additions atop the licensed foundation; preserve applicable notices/change attribution and check all third-party obligations before distribution. Existing public grants cannot be revoked, and contributors retain ownership. No commercial edition, relicensing, private source fork or delivery commitment is approved by this review. Do not assume future dependencies permit the intended proprietary distribution.
- Corrected stale triage entries that still scheduled resolved K17/K30, added missing resolved K34, updated hosted modal status and removed a remaining suggestion that static overlay rendering exists. Planned AI hardware/tool-quality statements are now explicitly provisional evaluation targets rather than unmeasured fit/quality guarantees. These are documentation corrections, not new runtime fixes or issue IDs.

**Proceed:** next bounded public stabilization assessment/implementation for K18/K19 plus closely related K24 close visibility. **Hold:** M3 feature expansion until its reliability prerequisites; model integration/download automation until R4; downloadable/commercial binary distribution until applicable R3/R4/R5 checks. This is a scoped engineering/readiness decision, not "the software is safe in every circumstance."

This follow-up changes review/status documentation only and is local until separately committed/published. Final validation passed 175 local links/fragments, unique K1-K34/R1-R5 entries, public/private reference checks and tracked whitespace checks. K/L issue counts and priorities remain unchanged.

## K18/K19 and bounded K24 recovery implementation: 2026-10-12 (approved 12:39 +08:00)

### QA and engineering reconciliation before implementation

The 12:34 review established source-confirmed causes and acceptance conditions. Owner additionally selected the conservative close policy: blocking recovery until confirmed close, authoritative status check before retry, and adoption rather than blind closure of another active project.

| Acceptance | Engineering implementation / regression evidence | Outcome |
|---|---|---|
| Export polling cannot overlap or adopt obsolete responses | Response-scheduled polling; effect lifetime/revision guards; deferred poll/cancel and unmount tests | Pass locally |
| Poll/cancel failure is visible and recoverable | Coded failures, explicit status retry, guarded pending cancellation and continued authoritative checks; fake-timer failure/retry tests | Pass locally |
| Cancellation acknowledgement is not cleanup completion | Running acknowledgement shows cleanup pending; restart/close remain blocked until a terminal state; stale pre-cancel success cannot overwrite it | Pass locally |
| Only render-used offline assets block export | Client reuses `buildRenderPlan`/`planAssetIds`; used/unused/audio-only/fully hidden/partly visible/gap fixtures, engine preflight unchanged | Pass locally |
| Close must await confirmed outcome and reconcile uncertainty | Typed literal-true response; native blocking close modal; status check required after failure; no-project cleanup retry, same-project retry and explicit other-project adoption. Engine hook fault injection confirms a 500 after session close, then 404 current state and successful cleanup-confirmation retry with saved work intact | Pass locally |
| A stale close retry must not close another project | Shared optional expected-project ID/folder request; guard inside serialized session close before hooks; mismatch returns 409 PROJECT_CHANGED with current project/files intact; legacy bodyless route remains compatible | Pass locally |
| Recovery requests are bounded without pretending to roll back engine mutations | 15-second deadlines for close/project-read/export-status/cancel, covering fetch and body parsing; client abort plus timeout result, exact threshold and cleared-timer tests | Pass locally |

The identity guard is tightly coupled to the agreed close behavior: checking status only in the UI would otherwise leave a check-to-retry race. It does not introduce a saved-schema change, guarantee multi-client lifecycle scheduling or close create/open-hook uncertainty. Export-start, creation, import and edit requests keep their earlier behavior and remain broader K24 work.

### Validation and scope

- Fresh complete JS suite: **20 files / 240 tests passed**, including real FFmpeg and engine post-commit close fault injection; typecheck, lint and client production build passed. Frozen-lock consistency, 176 local links/fragments, unique K1-K34/R1-R5 inventory, public/private reference and whitespace checks passed. This preserves existing engine ownership, persistence and export regressions.
- Native-browser smoke with synthetic page-local API responses: unused offline asset did not disable Export; poll error was coded, Escape could not dismiss unknown/running status, Retry status reached done and closing restored Export focus. Close failure showed its code, Escape did not dismiss recovery, no-project reconciliation offered cleanup retry, and successful retry returned to Landing.
- The first browser route-interception attempt timed out; switched to a page-local synthetic fetch fixture. This is UI interaction evidence, not real network/engine/FFmpeg failure injection, native-picker acceptance, screen-reader testing or real-media playback. No user projects/media were used. Owned UI server was stopped and its port verified free; browser returned to blank. Synthetic init scripts are restricted to the smoke port, not production.
- No Python, Electron-shell/Windows launcher, real picker, screen-reader, disk-full/power-loss or multi-client acceptance rerun; none was changed or is claimed. Published baseline CI remains historical for this new local slice.
- No dependencies/models/binaries were added; Apache/R1-R5 distribution and privacy boundaries remain unchanged. No commercial feature/repository expansion or publication was authorized.

Current inventory: **34 K entries, 21 locally resolved and 13 open/partial**. K18/K19 join the resolved inventory; K24 remains partial. Next bounded recommendation: **K32 preview end/discontinuity correctness**, then remaining K24/K26 and K29 before K21 UI. M3 feature expansion remains gated.

## K32 preview boundary implementation: 2026-10-12 (approved 13:03 +08:00)

### Baseline and QA/engineering reconciliation

Recovery work was committed/pushed as `cc9d006f1938c5c4e899975e7f4ab62a275114f3`; remote equality and clean worktree were checked before starting K32. [Hosted CI run 38206315653](https://github.com/tombeng027/video-editor-prototype/actions/runs/38206315653) subsequently completed successfully. That verifies the recovery baseline, not this later preview slice.

| Contract | QA evidence / originating cause | Engineering response / acceptance | Outcome |
|---|---|---|---|
| Hold inclusive final trimmed frame | Failing-before component sought 2 s instead of 59/30 s; rational-FPS equivalent failed too. Clip selection clamps end-1, but source seek used the exclusive clock position. | Clamp source target to inclusive clip range before existing proxy clamp. Real 30-fps colour fixture holds frame 62 (blue), not exclusive frame 63 (yellow), at natural end. | Pass locally |
| Short same-source cut is an edit, not ordinary drift | Failing-before forward cut 0.1 s and gap re-entry produced no seek under 0.25 s tolerance. Source key alone does not detect changed source mapping. | Track proxy key and source-minus-timeline offset; reset across gaps/preparing; force changed mappings. Backward/repeated source and same-ID mapping edits also have regressions. | Pass locally |
| Autonomous video must not continue into a removed range before the cut | First decoded-frame browser attempt after the initial fix still observed one red removed frame despite correct seek. A clock-tick seek alone does not constrain native playback advancing ahead of the next tick. | Hold/pause on the final visible frame before a mapping/source discontinuity, gap or end, then seek/resume on the next segment. Final fixture run sampled zero red frames through cut/gap. | Pass locally within tested playback; approximate preview remains explicit |
| Contiguous splits should remain continuous | Same source mapping across adjacent split clips is not a semantic discontinuity. | No forced midpoint seek/pause; component regression and real split at 0.5 s passed. End hold is intentional. | Pass locally |
| Preserve proxy/time/visibility contracts | Short proxy, audio tail gap and project/native FPS can differ. | Existing proxy clamp preserved; rational/mixed-rate, gap/trailing-audio and metadata callbacks covered in components. Highest-order non-audio visibility unchanged. | Pass locally; broad codecs/rates not certified |

No saved schema, rendering/export, AI/model/dependency or commercial scope change. QA/engineering agreement led to the narrow correction, with the native-frame finding driving a second iteration rather than being dismissed as a passing-helper result.

### Verification and limits

- **11 preview component cases**; four demonstrated failures before implementation. Final full JS suite **21 files / 251 tests passed**, including real FFmpeg; typecheck, lint and client production build passed. One test mock type was corrected after typecheck exposed an overly broad Vitest mock annotation; final typecheck is clean.
- Owned FFmpeg-generated **93-frame / 3.1 s / 30-fps H.264** colour source: green frames 0-29, red removed frames 30-32, blue 33-62, yellow 63-92. Browser used the actual Preview component and clock through UI controls, a local synthetic API/range server, real video decoding and canvas/requestVideoFrameCallback samples (CORS enabled only for the fixture).
- Final observed results: trimmed end 2.066666 s / blue; short cut to source 1.1 s, zero sampled red frames and final blue; contiguous split had no seek/pause at 0.5 s and held green at 0.966666 s; gap displayed No clip here, re-entered blue and held blue at 2.066666 s, with zero sampled red frames.
- This is local Chromium synthetic-media acceptance, not proof of every decoded frame on every codec, device, rate, throttled/background tab or audiovisual condition. One-element preview may stall at seeks and intentionally holds a frame at discontinuities; audio may briefly pause with it. Export is unchanged. General play/decode/error recovery remains K24.
- The temporary servers and source file were outside the repository; no user projects/media were used. Both owned servers were stopped, both ports verified free, the named media/server-script fixtures removed and browser returned to blank. Final checks passed 177 local links/fragments, issue inventory, public/private references, frozen-lock consistency and whitespace. No native Electron picker, screen-reader, Python/model or Windows launcher re-acceptance claimed for this client-only change.

Current inventory: **34 K entries, 22 locally resolved and 12 open/partial**. K32 is resolved within the recorded evidence, K24 remains partial. Next bounded recommendation: operation-aware **K24 create/open/export-start uncertainty and picker recovery with K26 diagnostics**, then K29 before K21 UI; K12/K13 still gate dependent M3 work.

## Quick K32 review and next recovery slice: 2026-10-12 (approved 13:14 +08:00)

### Preview review

Directly re-read Preview, source clamps and all 11 component regressions; reran Preview plus timeline/clock tests (**2 files / 30 tests passed**). No new blocker found in the inspected correction. Inclusive source/proxy bounds, short forward/backward mapping changes, gap re-entry and unchanged contiguous mapping match the intended contract. The prior actual decoded-frame proof remains local evidence; no additional all-codec/high-rate/background-tab certification is claimed.

### Export-start QA/engineering reconciliation

- **QA problem:** pending start had no deadline. A lost/invalid response could enable Export again even if the engine had reserved or started a job.
- **Engineering cause:** start omitted the recovery timeout; status was global and could report an earlier export result, so simply reading GET was not sufficient confirmation.
- **Owner decision:** keep the modal locked until authoritative status confirms the attempt, matching the conservative close policy.
- **Implementation:** optional UUID start request/status correlation (no project-file schema migration); ID retained from reservation through progress/terminal states and cleared on reset. Existing bodyless starts remain supported. Start now uses the 15-second fetch/body deadline. Unknown failures expose a guarded Check export status action without repeating POST; only matching non-idle status resolves uncertainty. Explicit known rejections preserve retry/close, while an unexpected idle start response is unconfirmed.
- **Limits:** not durable operation history, idempotent retry, a universal retry guarantee or multi-client job ownership. If no matching attempt exists because the request never arrived or the engine reset, idle does not prove a late request is safe: lock persists; reload only after confirming the old engine stopped. Older engines without correlation cannot reconcile uncertain starts.

### Evidence and gate

- Final JS suite **21 files / 259 tests passed**, including real FFmpeg; typecheck, lint and client build pass. Eight added regression cases cover attempt request/status shape, five client recovery scenarios and two engine lifecycle cases; deadline tests now include start and stalled response bodies. A new attempt clears the previous result so old output is not displayed as success during uncertainty. Existing export reservation/cancellation/publication behavior stays covered.
- Native Chromium smoke on an owned local UI server with **synthetic API responses**: one ambiguous POST, Escape preserved the native lock, earlier terminal attempt failed to unlock, matching terminal attempt allowed Close; **one start / two GET checks**. This verifies native modal behavior, not an actual dropped TCP response or Electron window close. Engine inject tests provide server correlation evidence separately.
- Browser returned to blank, owned UI server stopped and its port verified free. No real user media/project or additional dependencies used. The fixture's unsupported SSE endpoint emitted an expected error; SSE recovery remains open and is not certified by this smoke. Final documentation checks passed 178 local links/fragments, issue inventory/public-private checks, frozen-lock consistency and whitespace.
- K inventory remains **22 resolved / 12 open or partial**: K24 remains partial and K26 open. No model/binary/license scope change. Proceed with the next bounded create/open reconciliation and picker recovery slice, then K26 common diagnostics. Do not claim new code published or hosted-tested before a commit/CI run.

## Reference-led review and create/open recovery: 2026-10-12 (approved 13:41 +08:00)

### Review scope and track check

Used [QA and Fix Readiness](./17-qa-and-fix-readiness.md), the S02/S07/S08/S09 matrix, authoritative K/R backlog and [maintainer-purpose gate](./01-overview-and-scope.md#maintainer-purpose-and-scope-gate). Baseline is `cc9d006` with previously reviewed local K32/export-start changes; no publication authority is inferred from implementation approval. Re-read current export dialog/reservation/correlation and project session/route/caller boundaries; full regressions preserve the preview/export contracts. This is an efficient targeted stabilization review, not a fresh independent audit of every subsystem, secret/history review or legal opinion.

No demonstrated new critical data-loss or higher-priority regression in the inspected scope. K24 create/open remained next because a core workflow could commit before reporting failure or leave an indefinitely pending UI. M3 history/gestures remain gated by K12/K13; cleanup UI remains gated by K29. No dependencies, models, binaries or commercial features were added.

### QA/engineering reconciliation

| Contract / severity and priority | Source evidence / cause | Fix and acceptance | Decision |
|---|---|---|---|
| Committed project must not appear uncreated; Medium / P2 K24 | Create/open set session and persist before onOpened preparation; thrown hook was reported as HTTP failure despite commitment. Source-confirmed before fix; new fault-injection acceptance covers both paths. | Preserve committed result with preparation warning and coded stderr marker, retain recent warnings and saved identity. No deletion/recreation or preparation-success claim. | Agreed; matches existing bookkeeping-warning pattern |
| Bounded mutation must not imply safe retry after lost response; Medium / P2 K24 | API had no create/open deadline; simply checking folder/current project cannot distinguish this attempt or a delayed request. | Owner chose locked recovery. Fresh UUID, 15-second fetch/body deadline, pending/done/failed status and guarded explicit GET check; no automatic resubmission. | Owner-approved |
| Do not adopt stale/different project from recovery | Result snapshot can age; switch/close/reopen changes session generation. | Done status validates generation and returns current project including later committed edits. Wrong/unknown/changed status stays locked. | Agreed; tests cover generation and snapshot distinction |
| Bounded maintainer/runtime cost | A durable transactional operation service would exceed this slice. | At most 16 in-memory attempts, one create/open through preparation; retained ID duplicate rejection. Unknown/evicted/restarted outcomes remain explicit, not a guessed safe retry. | Agreed; no durable idempotency/multi-client certification |

Implementation uses a shared client operation hook for create/open to keep recovery semantics consistent. Existing folder-picker locks, local form validation, backup/recent warnings, typed storage failures and legacy ID-less callers remain supported. A confirmed failed attempt permits user-selected retry with a fresh ID. An unknown/reset attempt may remain locked; reload only after confirming the old engine stopped.

### Evidence and limits

- **21 files / 269 JS tests passed**, including real FFmpeg; typecheck, lint and client production build pass. Ten new cases cover four UI recovery cases, five engine cases and one API shape case; existing deadline coverage now includes create/open/status. Initial test-placement and test-query typing mistakes were corrected before the final passing run.
- Engine fault injection proves create/open preparation warnings with persisted identity, pending status before hook completion, duplicate/busy rejection, failed/unknown/auth/UUID outcomes, current committed edits, generation invalidation and oldest-record eviction at 17 attempts.
- Native Chromium smoke used actual dialogs/client with synthetic API responses, not an actual lost TCP response or Electron picker. Both create and open remained locked on Escape, pending status preserved the lock, and matching completion adopted the editor with a visible preparation warning. One POST per flow, two GET checks per flow, no automatic create/open retry. Unsupported fixture SSE emitted expected errors; SSE correctness is not claimed.
- Browser returned to blank, owned UI server stopped and port verified free. Documentation validation passed 181 local links/fragments plus the final added matrix link target; issue inventory/public-private references, frozen lock consistency and whitespace passed. No real user project/media or unrelated process was used. No Python/model/launcher re-acceptance needed or claimed for this slice.
- K inventory remains **22 resolved / 12 open or partial**: K24 remains partial, K26 open. Next bounded work: media-picker rejection/pending ownership, then common coded diagnostics and remaining media/proxy/SSE/preview recovery. Do not start M3 expansion yet.

### Legal/publication checkpoint

Source-only stabilization remains compatible with the approved Apache-2.0/community scope. R1 original-work licensing/contribution terms remain published; per-contribution and third-party rights remain ongoing. R2 honest claims are updated locally, with per-demo review still required. R3 exact binary/notices/codec review is required before downloads; R4 exact model rights before integration/download; R5 permissions/privacy before demos or support collection. None of those distribution/model/demo gates was newly triggered here. No legal clearance or commercial edition approval is implied.

## Media-picker recovery: 2026-10-12 (approved 13:54 +08:00)

### QA/engineering reconciliation

Applied [QA and Fix Readiness](./17-qa-and-fix-readiness.md) to S03/S08/K24. Baseline remains published `cc9d006` plus local preview/export/create/open fixes; previous unrelated working changes are preserved.

| Acceptance / severity and priority | Evidence / originating cause | Fix / decision |
|---|---|---|
| Picker rejection must be visible and retryable; Medium / P2 K24 | Picker promise rejection had no catch; busy began only after selection. Source-confirmed before fix, not a native OS failure reproduction. | Narrow catch only around the picker, coded MEDIA_PICK_FAILED, reset controls and explicit retry. Cancellation sends no import. |
| Duplicate clicks and mode changes must not create inconsistent work | No synchronous picker/import guard; copy checkbox stayed active during waits. | Guard from picker invocation through import response; capture mode at invocation and lock choice. |
| Leaving must not import a late selection into another session; Medium / P2 K24 | Async picker could finish after component disposal; close keeps Editor mounted until cleanup confirms, so unmount-only guarding is insufficient. | Owner chose navigation allowed/discard selection. Generation invalidation at close initiation, project/engine change and unmount; App wires enabled ownership through Editor to AssetsPane. |
| Sent import is different from unsent picker | Suppressing UI callback cannot undo an engine request; engine retains its established lifecycle/cleanup guards. | Ignore stale UI responses; show that leaving does not cancel submitted work. No success-shaped cancellation, new deadline or automatic POST retry. |
| Retain usable browser retry input | Old form cleared typed path even on failure; import errors omitted codes. | Lock input during submission, retain on batch/per-file failure, clear only on confirmed full success; display codes. |

No schema/API/dependency or saved-data change. This is the bounded picker slice, not general import committed-outcome reconciliation or K12 ordering. No new legal/model/binary gate triggered; R1-R5 scope remains as recorded in the previous review.

### Verification and limits

- **10 added regressions:** nine AssetsPane cases plus actual App close integration; picker failure/cancel, duplicate/mode guards, late resolve/reject, closing before unmount, project replacement/new picker isolation, sent-import stale result and browser path/error behavior.
- Targeted **2 files / 37 tests passed**, then full **22 files / 279 JS tests passed**, including real FFmpeg. Typecheck, lint and production build passed.
- Native Chromium/client smoke with synthetic bridge/API: picker rejection displayed code; empty cancel sent no request; deferred third picker locked mode; Projects close remained pending; resolving its selection sent **zero imports**; confirmed close returned Landing. Three picker invocations total. This is not actual Electron IPC/OS-dialog acceptance, performance or screen-reader certification. Unsupported fixture SSE emitted expected errors and remains outside this acceptance.
- Browser returned to blank, owned UI server stopped and port verified free. Final checks passed 183 local documentation links/fragments, issue inventory/public-private references, frozen-lock consistency and whitespace. No user media/projects or unrelated processes used. Changes remain local/uncommitted, not hosted verified.

K24 remains partial and the inventory stays **22 resolved / 12 open or partial**. Next bounded recommendation is **K26 common unexpected-error codes and safe local diagnostics**, followed by remaining K24 refresh/proxy/SSE/preview and mutation recovery. K29 still precedes cleanup UI; K12/K13 precede dependent M3 expansion.

## Reference review and safe diagnostic slice: 2026-10-12 (approved 14:00 +08:00)

### Track and priority review

Applied the [QA/fix-readiness reference](./17-qa-and-fix-readiness.md), S03/S08/S09 matrix, authoritative K24/K26/K29 backlog and maintainer/legal scope gates. Re-read picker generation/close invalidation, client error parsing, project route commitment/recovery, engine error handling and existing stderr capture. No demonstrated new data-loss/job-ownership blocker outranked K26 in this inspected scope. Maintained tests cover recent preview/export/create/open/picker fixes; this is not a fresh all-subsystem, legal or security audit.

### QA/engineering reconciliation

| Contract / severity and priority | Source-confirmed problem | Correction / acceptance |
|---|---|---|
| Unexpected operational failures need an explicit code and diagnostic context; Medium / P2 K26 | Fastify logging disabled, default raw unexpected-error response and no common record; preparation/operation catches discarded all cause metadata. | Common 500 handler returns ENGINE_UNEXPECTED_ERROR plus server UUID, matching one structured stderr record. Project preparation and unexpected operation failures use same helper; operation status retains ID. |
| Logs must not expose token/media/request details | Raw exception text/stacks or request serialization can contain private data; enabling general request logging would widen collection. | Strict new-record allowlist: timestamp/code/registered route/method/UUID, at most three standard error-class and known I/O-code causes; no arbitrary message/stack/path/header/body/query/param/caller ID. Unknown details deliberately omitted. |
| UI must retain correlation without claiming safe mutation retry | Client cast error payload without validation; command feedback omitted code; failed operation status bypassed the API failure formatter. | Validate shared error schema, append UUID to error text, preserve command code and operation-status ID. Existing conservative recovery stays in place. |
| Do not reclassify client parse problems as internal failures | A blanket 500 handler would change malformed-body semantics. | Fastify 4xx body/content-type/size failures keep their status with INVALID_REQUEST; explicit domain errors unchanged. |

Reuse inherited stderr and launcher capture rather than add packages/file rotation/telemetry. No request logging enabled. Cause classes/I/O codes help classify a failure but do not provide a full private-message/stack trace; complete safe diagnostics remain further work.

### Validation and boundaries

- **23 files / 286 JS tests passed**, including real FFmpeg; typecheck, lint and client build passed. Seven added cases: three reporter/handler privacy/format cases, unexpected project failure/status correlation, client parser/ID contract, failed-operation UI ID and actual Editor command code/ID feedback. Existing close-fault and preparation-warning tests now verify correlated safe records.
- Injected private text in exceptions/causes, paths, bodies, query/params/token and caller request ID; new records/responses exclude those values. Verified valid/distinct server UUIDs, exactly one record per unexpected route failure, registered route template, three-cause depth/cycle limits, ENOSPC classification, malformed JSON 400 and retained current project/save/close contracts.
- No native browser smoke rerun is claimed for this message-plumbing change: component tests exercise actual feedback consumers, and engine inject tests exercise actual error handler. No launcher/Python/model suite re-acceptance claimed; stdout/stderr inheritance/capture was source-inspected.
- New records go to stderr. Windows quick-start's desktop stderr capture provides existing local retention; manual starts have no automatic persistent sink. Expected-domain errors, existing proxy/export/job text and health-error presentation are not fully migrated/redacted; check before sharing logs. No universal privacy/durability guarantee or logging-failure recovery service.
- Baseline remains `cc9d006` with local working changes; no publication or hosted CI implied. No dependencies, model artifacts, binaries or commercial scope added. R1 source terms remain published; R2 per-demo claims, R3 binary/codec, R4 exact-model and R5 media/support privacy gates remain unchanged.
- Final documentation checks passed 184 local links/fragments, issue inventory/public-private references, frozen-lock consistency and whitespace. No server or temporary media fixture was created for this diagnostics slice; editor diagnostics report no errors in the changed runtime files.

## Full reference-led status and priority review: 2026-10-12 (15:52 +08:00)

### Cross-subsystem review

| Scope | Current conclusion | Gate / limits |
|---|---|---|
| S01-S02 schema, commands, persistence | No newly demonstrated integrity regression. K23/K27 acceptance remains supported by local regressions. | No fresh persistence fault-injection rerun in this review; K10 migration gate applies before schema changes. |
| S03-S04 import, media identity, proxies, streaming | Ownership guards and picker discard policy are locally verified. Uncertain sent-import outcome, refresh ordering, proxy/SSE failure recovery remain K24. | Prior regression evidence remains local; don't retry an unknown import until authoritative reconciliation is designed/tested. |
| S05 timeline/editing | Current bounded manual editing contract remains appropriate. | K12 serialized planning/history before Undo/Redo; K13 save strategy before drag editing. Keep M3 gated. |
| S06 preview/audio | K32 boundary behavior is verified within its documented synthetic-browser/codec limits. Play/decode/proxy/refresh failure states remain K24. | No new browser run this review; do not generalize the prior synthetic acceptance. |
| S07 render/export | Reservation/publication contracts and K18/K19 recovery remain intact; export-start attempt correlation is local. | No durable idempotency or multi-client guarantee; local K24 work is not published/hosted-tested. |
| S08 UI/accessibility/layout | Modal/create/open/export/picker ownership regressions support their recorded local claims. | Native picker/accessibility/viewport claims remain limited; K3/K28 and actual platform checks remain. |
| S09 engine/API/diagnostics | K26 partial safe route diagnostics are implemented locally and tested; IDs correlate without implying mutation rollback. | Expected-domain/background jobs, health presentation and durable capture are not comprehensively integrated. |
| S10-S11 desktop/process/launcher | Existing ownership and Windows launcher evidence remains as recorded. | No fresh Electron lifecycle or Windows launcher run in this review; no cross-desktop support claim. |
| S12 operations/retention | Existing conservative launcher retention remains. | K29 partial-cleanup/metadata failure semantics are a prerequisite for cleanup UI; no destructive-cleanup test rerun here. |
| S13 AI evaluation | No model or AI execution behavior has been added. Suggestive/reviewed-proposal boundary remains the target. | R4 blocks model/artifact integration or automated downloads until exact terms/evaluation are recorded. |
| S14 QA/docs/release | Public docs and local evidence distinguish published code from later local stabilization. | Latest 286-test/type/lint/build evidence is dated 14:04, not rerun here. Review itself adds documentation only; no release/hosted-CI claim. |

### Legal/publication gate refresh

- **R1:** owner-approved Apache-2.0 standard license, contribution terms, scope and metadata are published; placeholder copyright fields were replaced by `Copyright 2026 tombeng027` and pushed in `5c6e852`.
- **R2:** existing independent branding and corrected feature claims remain; verify each new demo, promotion or sponsor pitch. No new promotional material was reviewed or published in this pass.
- **R3:** open before any downloadable binary/installer; no binary/codec clearance implied by source-only development.
- **R4:** open before model integration/download/redistribution; no model artifacts added.
- **R5:** open before public demo footage or support-data collection; no media/privacy blanket clearance.

No new licensing decision, code scope or distribution activity is needed for routine stabilization. Continue checking provenance on contributions and hold only the activity whose gate is triggered.

### Prioritized next slices

1. **K24 uncertain import outcome and refresh ownership:** introduce bounded import response recovery with operation identity/status; never repeat a possibly committed import blindly. Prove success/failure/unknown, navigation/same-folder reopen, copied-file cleanup and reconciliation against current engine/project state.
2. **K24 media/proxy/SSE/preview failures:** typed visible refresh/retry states, event reconnection or authoritative refresh, malformed-event handling and rejected play/decode behavior; guard stale responses by project/asset generation. Verify actual UI outcomes, not helpers alone.
3. **K26 integration:** migrate expected/background-job failure reporting and useful health/UI correlation selectively; preserve safe allowlists and avoid raw messages/request logging. Add stderr capture/privacy assertions for each path; do not claim universal redaction until audited.
4. **K29 before K21 cleanup UI:** return accurate partial/failed cleanup results, remeasure after partial deletion, commit metadata safely and inject failure windows while preserving active-writer protections. This prerequisite is now locally implemented and validated; K21 periodic nonblocking warnings/controls remain a separate future slice.
5. **M3 remains gated:** K12 before Undo/Redo; K13 before drag editing; K28 viewport constraints and relevant UI/manual acceptance before layout-dependent scope.

**Gate:** proceed with bounded remaining K24 recovery and continued K26 integration, not M3 expansion. The import outcome-recovery slice is locally validated; K24 remains partial alongside K26. K29's prerequisite is met locally; K12/K13 gate dependent editing work.

## Priority and next acceptance gates

**Decision: architecture stays; hold M3 feature expansion until the data/job stabilization gates pass.** M1-M2 capabilities exist, but "M2 complete" is not "all reliability risks closed."

1. **Test ownership and project/job isolation (P1): passed locally.** K33/K22/K16/K8/K25/K31 have maintained regressions. Preserve them when changing persistence, job callbacks or shutdown. This is not hosted-CI or all-filesystem acceptance.
2. **Persistence integrity: passed locally.** K23/K27 regressions cover invalid saved relationships, backup preservation on failed save and recent bookkeeping/core outcome separation. No saved-schema migration was needed.
3. **User-visible recovery:** K17/K30 modal/input integrity passed locally. K24 import outcomes have bounded operation status and explicit reconciliation; proxy state now refreshes from the authoritative engine snapshot on connect/reconnect/focus with a manual refresh, offline-media refresh failures have visible retry controls, and preview play/decode errors stop retry loops and offer explicit recovery. K32 clip-boundary handling is already verified locally. K26 proxy-job failures now receive safe diagnostic IDs surfaced with the preview-failure badge. Remaining K18/K19/K24/K26 work includes export retry states, close failure, broader media-refresh/mutation recovery and other background-error integration. Focused regressions passed locally; do not describe all editor errors as covered by the launcher's catalog.
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
