# 13. Running and Manual Testing

[Back to index](./README.md)

How to launch the prototype on a Windows PC and walk through the manual test checklist. Update the checklist as each slice lands.

### Modal interaction acceptance

With an isolated test project, verify Create and Export keep Tab/Shift+Tab inside the dialog and block background pointer/keyboard edits. Cancel/Escape should close an idle dialog and restore its opener focus. During creation, all fields and Cancel stay disabled and Creating explains the non-cancellable request; a failure permits retry and a successful response opens exactly the committed project. During export start preflight and running export, Escape/Close must not dismiss it; Cancel export remains available while running. Picker failure should show `FOLDER_PICK_FAILED` and unlock retry. Do not use user projects to inject failures. General network deadlines, export polling/cancel errors and real picker acceptance remain separate backlog checks.

**Latest manual report:** the owner observed Tab/Shift+Tab traversing menus and Escape doing nothing. Treat keyboard containment and Escape dismissal as failed/unverified until retested in the running desktop app; component tests are not proof of native focus behavior.

## Prerequisites

| Tool | Needed for | Check |
|---|---|---|
| Node 22+ (24 tested) and pnpm | Everything | `node -v`, `pnpm -v` |
| FFmpeg and ffprobe on PATH | Import, proxies, export | `ffmpeg -version`, `ffprobe -version` |
| Python 3.11-3.12 and `uv` | Vision service (stub for now) | `python -m uv --version` |
| Ollama with `qwen3:8b` | AI assistant (from M4; not used yet) | `ollama list` |

Install FFmpeg with `winget install Gyan.FFmpeg`, then **open a new terminal**. A terminal opened before the install will not see it (known issue K1).

First time only:

```powershell
pnpm install
pnpm --filter @ve/desktop setup:electron
```

Electron 44 exposes an explicit binary installer rather than an automatic package-install hook. Run `setup:electron` after the first dependency install or an Electron upgrade; it checks the installed version and reuses a matching binary. A successful `pnpm install` alone does not prove desktop readiness. Installer failures are nonzero and must be resolved before launching; startup does not download dependencies.

## Quick start (daily use)

One command from the `video-editor` folder starts everything and opens the app:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-app.ps1
```

- Add `-Ollama` to also start Ollama (only needed from M4, when the assistant is built).
- To stop: run `powershell -ExecutionPolicy Bypass -File scripts\stop-app.ps1`. It first asks the desktop window to close, allowing the engine to shut down, then stops only launcher-owned processes. Closing the window yourself first is also fine.
- Add `-Ollama` to stop an Ollama server **started by this launcher**. An existing Ollama service, unrelated Electron apps, manually launched engines/vision services, and other dev servers are left alone.
- Logs and process identities go to `%LOCALAPPDATA%\VideoEditorPrototype\launcher\<project-key>`. Process IDs are checked against their creation times before stopping them.
- Descendant identities are recorded before termination, so a retry can stop a surviving child even if its parent has exited. An incomplete shutdown returns a nonzero exit code, not a success message.
- Duplicate launches and an occupied port 5173 are refused with an error. Client readiness requires an HTTP response from the owned server; desktop startup requires the app window. Startup failures clean up processes started by that attempt.
- The scripts check Node, pnpm, FFmpeg, ffprobe and local dependencies, and build the desktop before starting. They preserve the current PATH and append refreshed system/user paths.
- `FFMPEG_PATH` and `FFPROBE_PATH` are honored; ffprobe is inferred beside a custom FFmpeg binary when omitted. With `-Ollama`, a custom `OLLAMA_URL` must already be reachable; the launcher only auto-starts the default local endpoint. Custom `OLLAMA_HOST` setups must be started manually.
- "App launched" means the client responds and the window is open, not that all component diagnostics are green.
- If process-state JSON is corrupt, the scripts refuse to guess ownership. Close this app's processes manually, rename the reported `processes.json`, then retry. Never delete state while its owned processes are running.
- Quick start uses `http://127.0.0.1:5173`. If you set `VE_CLIENT_URL` to a different address, use the manual launch instructions instead.
- New projects default to `sample-projects\` in this folder. Demo clips live in `demo-media\`. Both are gitignored, so they stay local.
- What each part is: **FFmpeg** is a command-line tool, not a service, and the engine calls it when needed, so there is nothing to start or stop (it only has to be on PATH). **Engine** is started and stopped by the desktop app. **Vision** stays red until the AI milestones. **Ollama** is only needed from M4.

If the window opens but FFmpeg is red, FFmpeg is not on that terminal's PATH. Open a new terminal (or use the script, which refreshes PATH) and check `ffmpeg -version`.

The manual steps below do the same thing in separate terminals, and are useful for seeing logs.

### Launcher regression checks

With the app and any launcher-owned Ollama stopped, and port 5173 free (port 11434 may be free or serve an existing healthy Ollama):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-launcher.ps1
```

This briefly opens the app and checks startup, duplicate refusal, port conflicts, process identity checks, owned shutdown, and preservation of an existing Ollama-compatible service. It creates synthetic test servers when needed, does not run AI models, and never stops an existing Ollama. Do not run while using the app.

It also checks missing dependency recovery instructions, readiness timeout, early process exit, and rollback after failed desktop startup. An unexpected child exit includes the last stdout/stderr lines in the test failure. A separate suite lock prevents simultaneous test runs. The Windows CI job explicitly installs the Electron binary before these checks; desktop availability on the hosted runner is verified by the test itself.

To additionally test real launcher-owned Ollama startup/shutdown, install Ollama, leave port 11434 free, unset `OLLAMA_URL`/`OLLAMA_HOST`, and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-launcher.ps1 -OwnedOllama
```

This optional test does not run or download a model. It refuses to stop an existing service.

### Error codes and recovery

Launcher failures print `[CODE]`, a brief explanation, the log directory, and this guide's path. Unexpected failures use `LAUNCHER_FAILED`; they are not hidden or treated as successful startup.

| Code | Meaning | Workaround / next action |
|---|---|---|
| `ALREADY_RUNNING` | A recorded app process or child is still running | Close your project and run the stop script before restarting |
| `CLIENT_PORT_BUSY` | Port 5173 belongs to another server | Identify its owner; stop it yourself if appropriate, or use manual launch with a different client configuration |
| `TESTS_RUNNING` | Regression tests own this project's launcher | Wait for the suite to finish; do not launch the app during tests |
| `LAUNCHER_BUSY` | Another start/stop operation owns the lock | Wait for it to finish and retry |
| `STATE_INVALID` | Process-state JSON has invalid structure or identities | Close this app's processes manually; rename the reported state file, then retry; do not guess ownership or delete active state |
| `CONFIG_INVALID` | Unsupported quick-start URL or relative executable path | Use absolute executable paths or PATH command names; use the manual launch flow for a custom client URL |
| `TOOL_MISSING` | A required executable cannot be found | Verify PATH, `FFMPEG_PATH`, and `FFPROBE_PATH`; open a new terminal after installation |
| `DEPENDENCIES_MISSING` | The required Vite entry or Electron executable is missing; the message names the path | Run `pnpm install` in the app folder; for Electron also run `pnpm --filter @ve/desktop setup:electron`, then retry |
| `BUILD_FAILED` | Desktop compilation failed before startup | Read the terminal build errors; fix them before retrying |
| `OLLAMA_UNREACHABLE` | Configured existing Ollama endpoint did not respond | Start the configured service manually, check its URL, or omit `-Ollama` for manual editing |
| `STARTUP_EXITED` | A launched process exited before readiness | Read the corresponding client/desktop/Ollama logs; verify configuration |
| `STARTUP_TIMEOUT` | Expected readiness did not arrive in time | Read the logs; check tool availability and any desktop error dialog; stop before retrying |
| `PROCESS_INSPECTION_FAILED` | Process identity or descendant enumeration could not be verified | Unknown processes are not killed; inspect this app's processes manually and retry with the same user account |
| `PROCESS_STOP_FAILED` | A recorded process could not be terminated | Retry shutdown; inspect the named PID and permissions if it persists |
| `STOP_INCOMPLETE` | Cleanup failed or recorded processes remain | Identities are retained for retry; inspect warnings, retry, and verify remaining processes |
| `LAUNCHER_FAILED` | An unexpected launcher error occurred | Read the error message and diagnostic record; report the code, timestamp and reproduction steps |
| `PROJECT_LOCATION_UNAVAILABLE` | The default project directory cannot be created | Choose an accessible directory in Location or set absolute `PROJECTS_DIR`; this appears in the New project UI |
| `LOG_CONFIG_INVALID` | Retention settings are invalid or unreadable; deletion is skipped | Fix the reported JSON file using the defaults below; startup/shutdown can still proceed |
| `LOG_CLEANUP_SKIPPED` | Logs have unknown metadata, links or inaccessible paths | Inspect the named path; do not remove active logs or process state; unmeasurable usage is reported as a lower bound |
| `LOG_CLEANUP_INCOMPLETE` | A selected closed session could not be fully removed | Close viewers using its logs, check permissions and retry cleanup |
| `LOG_STORAGE_LIMIT_EXCEEDED` | Log usage remains above the soft target | Preview cleanup, review protected/legacy logs, or increase the configured target |
| `DISK_SPACE_LOW` | Free space on the log-storage drive is below the threshold | Free space on that drive; log cleanup may not be enough |

Each launcher invocation creates `sessions\<timestamp-id>\` under the log directory. Its `errors.jsonl` contains UTC timestamp, code, message, and (for fatal errors) script location. Cleanup warnings are logged too. Component stdout/stderr goes to `client.log/.err`, `desktop.log/.err`, and `ollama.log/.err` in that session when started by the launcher. Logs remain local; they are not uploaded automatically. They can contain local paths or other diagnostic details, so review/redact them before sharing.

The shared client API helper gives editor API calls a 15-second deadline, aborts the client request at that deadline, validates success/error response shapes, and returns explicit coded failures. This does not cancel or roll back an engine mutation. Create/open, import, commands and export-start use operation-specific recovery where a response can be ambiguous. Recent/default-folder, close, media/proxy status, and other read calls must show failure rather than treating it as empty or current state. K24 remains partial because API-wrapper/UI error behavior and additional media-refresh edges still need systematic acceptance; operation records are bounded and in-memory.

### Export and close recovery acceptance

Use synthetic projects/media, not user work; network fault injection is a test technique rather than a normal workflow.

- Disconnect/intercept export status after start: expect a coded error and Retry status check, with no overlapping polling or dismissible running dialog. Restore the endpoint and retry: expect authoritative progress/terminal state.
- Delay cancel: repeated clicks must send only one request. A running acknowledgement must show cleanup pending, not success; stale pre-cancel polls must not regress state. Reject cancel: expect its code and continued status checking.
- Missing unused, fully hidden or audio-track-only assets must not block an otherwise valid export. Missing visible/render-used originals must still block; engine preflight checks actual files.
- Delay close: Projects navigation stays blocked. Reject/timeout close: expect its code, no landing transition and Check project status before Retry close. Failed status checking must not unlock a blind retry.
- If the engine reports no project after a failed close, retry must confirm cleanup before navigation. If it reports a different project, Use active project must adopt that project without closing it. A stale expected ID/folder must return `PROJECT_CHANGED` and preserve the current project.
- Check actual native focus/Tab/Escape/input isolation. Component tests alone do not certify native pickers or screen readers.

`REQUEST_TIMEOUT` means the client deadline expired, not that an engine mutation was cancelled or rolled back. Use each operation's status/reconciliation path; never infer rollback from timeout alone.

### Ambiguous command recovery (K24 slice)

- Lose or stall a command response beyond 15 seconds. The editor must keep further edits, export and Projects navigation locked; it must not automatically resubmit the batch.
- Check status with the same attempt UUID. Pending stays locked; done adopts the active project's current state; failed unlocks with the engine error; transient status-read failures keep the edit unresolved and allow another status check.
- Fail a status check with `UNREACHABLE`, then return a matching completed attempt on retry. The editor must retain the error and lock after the failed check, query the same UUID, adopt the completion, and never send a second command batch.
- Unknown, evicted or restarted attempts require an authoritative project refresh. A mismatched project must not be adopted; for the same project, the user explicitly confirms inspection before edits/navigation unlock.
- Engine tests verify completed/failed status, duplicate attempt rejection without a second apply, and status invalidation after project-generation changes. Operation records are in-memory and bounded; no durable idempotency or multi-client guarantee is implied.

### Proxy SSE and lookup recovery (K24 slice)

- Emit malformed JSON and schema-invalid proxy events. The editor must retain last-known proxy state, show a reconciliation error if the authoritative snapshot also fails, and recover after an explicit successful refresh.
- Disconnect SSE while a proxy snapshot fails, then reconnect. The client must preserve last-known state and clear the error only after a successful authoritative snapshot; stale snapshots from an old engine configuration must not overwrite newer state.
- During media-status filesystem checks, close/switch/reopen the project or mutate its assets. The engine must return `PROJECT_CHANGED` rather than a stale snapshot; successful snapshots identify their project, and the editor must not apply another project's offline asset IDs.
- Stall `GET /projects/recent` and `GET /projects/default-folder`. Both requests must return `REQUEST_TIMEOUT` at 15 seconds and abort fetch; recent projects and default location must offer explicit retry (manual folder entry remains available).

### Ambiguous export-start acceptance (K24 slice)

- Use an isolated engine/project or synthetic API fixture. Lose the start response after reservation, or stall fetch/body parsing beyond 15 seconds. Start must become explicitly unconfirmed, with no Export again/Close; Escape/native cancel must not dismiss it.
- Check export status: failed reads preserve the lock and show codes. Idle, a missing attempt ID or an earlier attempt's terminal state must not unlock this attempt. A matching running attempt returns to progress/cancellation; matching done/failed/cancelled allows close/retry.
- Ensure repeated clicks produce one start/check at a time; status reconciliation sends only GET, never a second POST. Explicit known start rejection (e.g. OFFLINE_MEDIA) permits retry/close without pretending the export succeeded.
- Engine tests verify UUID validation, progress/terminal correlation, busy rejection preserving the original ID, and reset clearing it. Bodyless starts remain supported.
- If the old engine stopped/reset or the request never arrived, there may be no matching status: keep the conservative lock, or reload only after verifying the old engine stopped. Attempt IDs are not persisted or an idempotent-retry contract. No multi-client lifecycle guarantee is implied.

### Create/open recovery acceptance (K24 slice)

- With synthetic responses/isolated projects, lose or stall create/open response beyond 15 seconds, including body parsing. New project controls/Cancel and Landing navigation must remain locked; Escape/native cancel must not dismiss recovery. Check project operation sends only GET for the same attempt UUID.
- Failed checks, pending, unknown IDs and wrong/changed project status must not adopt a project or submit another create/open. Matching done adopts the current authoritative project with backup/preparation/recent warnings; matching failed unlocks for explicit retry/cancel. Explicit retry uses a new ID.
- Inject a background preparation failure after create/open commits: API must return the saved/open project with `PROJECT_PREPARATION_FAILED`, not imply creation failed or recreate/delete its files. Verify saved identity and the warning in Editor.
- Engine acceptance covers repeated retained IDs, overlapping create/open, authentication/UUID validation, current edits rather than opening snapshots, generation changes and bounded-record eviction. This is not a power-loss, multi-client transaction or durable idempotency guarantee.
- If the attempt is unknown after restart/eviction or never arrived, preserve uncertainty; reload only after verifying the old engine stopped. Broader media-refresh edge cases and selective K26 diagnostics remain separate work.

### Media-picker recovery acceptance (K24 slice)

- Use an isolated/synthetic desktop bridge. Reject `pickMedia`: show `MEDIA_PICK_FAILED`, unlock Import media, send no import and allow explicit retry. Cancel with an empty selection: send no import and clear the previous picker error.
- Defer picker completion: repeated clicks invoke one picker, choosing status is visible and copy/reference choice is disabled. Successful selection submits exactly once using the mode captured when picking began; import status explicitly distinguishes sent engine work from unsent selection.
- Owner permits Projects navigation while choosing. Initiate close but keep close response pending, then resolve/reject the old picker: no import is sent, even though Editor remains mounted behind close recovery. Repeat with unmount/project change; an old result must not clear a newer picker state.
- Defer a sent import, then leave: ignore its stale UI response without claiming its engine work was cancelled. Existing engine lifecycle tests govern project-change/cleanup behavior; ambiguous outcomes use the correlated status/reconciliation flow in [Commands and Persistence](./04-commands-and-persistence.md).
- After an import times out, fail the first status read (for example `UNREACHABLE`) and then return a matching completed attempt. The UI must keep the path locked and outcome unconfirmed after the failed check, retry status with the same UUID, adopt the project only on confirmed completion, and never send a second import.
- In browser-only path input, suppress repeated form submissions, lock input/mode during import, show batch/per-file codes, retain the path on failures and clear it only after full success. Native OS-dialog acceptance is distinct from synthetic bridge/browser and component tests.

### Import catalog and recovery acceptance

- Relaunch after engine changes. Import a valid file alongside missing/unreadable files
  and a duplicate. Verify the added/failed counts, filename-only notices and distinct
  causes. Successful files stay in Assets; guidance says to retry only failed files.
- Technical codes, raw in-memory messages and diagnostic IDs belong in collapsed
  Error details, not the primary explanation. File failures must not claim the
  entire selection failed.
- After a timeout, use **Check import result**; a pending receipt shows neutral
  progress, not a red error. A missing receipt offers **Load Assets for review**,
  explains why review is needed, and does not resend the import.
- Failed or wrong-project/folder review loads must not unlock imports. While loading,
  another status check/review cannot race it. Only **I reviewed Assets - continue
  importing** releases the gate after a matching load; this does not retry anything.
- Inject a new unknown file/batch code in an isolated test. Confirm a persistent
  pending development task with code/stage/outcome/import operation only, never raw
  messages or paths. Repeats group; catalogued failures add no task. Recording
  failure is visible without unlocking an uncertain import.
- In Help, search import codes such as `ALREADY_IMPORTED` and `IMPORT_RECEIPT_MISSING`.
  Confirm applicability shows the import operation and relevant stage/outcome.

### Preview boundary acceptance (K32)

#### Preview error catalog adoption

- After engine relaunch, use a disposable project and short copied test media.
  Supported originals must still play with optimization queued/running/failed,
  and normal progress/cancellation must not create error tasks.
- If an original becomes offline, expect Relink/reconnect guidance, the affected
  asset names, no source playback requests and **Refresh preview status**.
  Reconnect or relink and refresh; verify playback can recover.
- Player errors distinguish blocked permission, unsupported source, network,
  decode and interrupted loads. Codes/raw details stay collapsed. Unknown media
  or play rejections use a safe template and sanitized pending task, not a guessed
  cause. Audio/images must not receive video-optimization controls.
- The initial video-frame deadline stays five seconds and does not automatically
  start conversion. **Retry preview** or **Retry audio** is explicit; press Play
  afterward. Timeline positions, edits and export sources remain unchanged.
- Test job timeouts using isolated mocks, not deliberate crashes on user work:
  no second prepare/cancel is allowed while the confirmation and subsequent
  snapshot refresh fail. Successful refresh releases only the preview-job gate.
  Timeline edit controls remain governed by their own existing guards.
- Failed optimization must show useful general checks (source/disk/permissions),
  optional-original playback guidance and collapsed diagnostic details. An
  off-timeline failed asset still records a local development follow-up. Neither
  polling/rerender nor showing the same failure in Preview should duplicate it.
- Verify new guidance and retry controls remain reachable by scrolling a small
  Preview pane; error text must not overlap the canvas or source/job controls.
- Help search for `PREVIEW_READY_TIMEOUT` explains five seconds, explicit retry
  and optional original-video optimization. Preview availability must not say
  a timeline edit was rejected or promise that export will work.
- Open **Development: unknown-error follow-ups** in the desktop editor. Loading
  must succeed before treating an inbox as empty. Do not remove pending tasks
  merely because new definitions exist; investigate/test exact fingerprints first.

- Use owned/synthetic footage with distinct frame colours before/inside/after the removed range. Decode or sample the actual displayed video frames, not only `currentTime` or helper outputs.
- Trim to a range whose exclusive out-frame has a different colour: paused end and natural playback end must hold the inclusive final frame, including when the original/proxy continues past the trim.
- Join two same-source clips around a short removed range (under 0.25 s): playback must force a cut seek, not use ordinary drift tolerance. Check both forward skips and repeated/backward source ranges.
- Contiguous splits must not force a midpoint seek/pause. Gaps must show No clip here and re-entry must seek to the following clip. Shorter proxies must remain clamped.
- Rational/mixed native/project FPS, mapping edits and trailing audio-track gaps have component coverage. Repeat real-media acceptance on representative codecs/hardware before stronger playback claims; this is still an approximate HTML-video preview.
- Reject `video.play()` and dispatch a media error: verify the preview shows a useful error, does not repeatedly call play on clock ticks and recovers only after explicit Retry preview. Test with both an autoplay-policy rejection and a media decode/load error; successful retry in a synthetic component test does not certify browser codec or permission behavior.

### Export recovery catalog acceptance

- Relaunch after engine/schema changes. Use a disposable project with copied
  media and a short timeline. Start export, confirm progress, and verify a matching
  finished result can reveal its output. Check actual video/audio separately.
- Cancel a long-enough synthetic export. Acknowledgement may leave it running
  while cleanup finishes; Close stays unavailable until a matching terminal
  result. A completed export can win the race with cancellation.
- In isolated API/component fixtures, reject start with `OFFLINE_MEDIA`,
  `EMPTY_TIMELINE` or `TOO_MANY_CUTS`. Expect specific cause/action, unchanged project
  edits and no receipt lookup for a definitively rejected request.
- A busy rejection offers **Check active export**. Inspecting it must not start
  another render; failed inspection stays retryable.
- Inject a lost start reply, then idle/wrong/missing attempt status. Keep Start,
  Export again and Close unavailable; **Check export status** retries only the
  read. Only a matching receipt may show progress or a terminal result.
- During running export, fail a status read. Keep last-confirmed progress, explain
  that it may be stale, stop repeated polls and offer **Retry status check**.
  A wrong/absent attempt must not display an earlier completion or unlock Close.
- Lose a cancellation reply. Repeated cancellation stays disabled until matching
  status is received; status retry never resends cancellation or start. An older
  pre-cancel poll cannot overwrite the cancellation result.
- Known duration mismatch and cleanup failures show specific guidance, with raw
  diagnostic details collapsed. Leftover files must not be presented as verified
  output. A generic FFmpeg failure uses the failed-render fallback and creates a
  sanitized pending task, not a guessed codec/disk diagnosis.
- Force inbox recording failure only in a fixture. The failure must be visible
  without unlocking an uncertain export or retrying any mutation.
- At a small window size, scroll the export modal to reach the buttons and
  expanded details. Escape/focus containment must still respect running and
  uncertain-result locks. In Help, search `EXPORT_CLEANUP_FAILED` and
  `EXPORT_DURATION_MISMATCH`; applicability must describe failed rendering,
  not rejected timeline edits.
- Owner reported the previous preview walkthrough passes after relaunch
  (2026-11-03). This does not certify every codec or replace these export checks.

### Export settings acceptance

- Owner reports a 1080p / 60 fps export looks good (2026-11-03). Other presets,
  default-output and cancellation checks remain separate; this is not exhaustive
  codec, timing or failure-path certification.
- Relaunch after engine/schema updates. Use copied media and a disposable short
  project, not important ongoing work.
- Open Export. Expect MP4/H.264 + AAC, Project rate, Project size and Standard
  quality. The summary shows actual even-pixel dimensions and fps.
- Choose 60 fps, 720p or 1080p and High quality. Verify the summary before starting.
  At a small window size, scroll to reach all selectors and Start/Close. Options
  collapse while running; expanding them must not permit changes. Progress and
  the attempt's summary remain available.
- Play the finished file and inspect its video properties: H.264, selected fps
  and dimensions, expected timeline duration and audio sync. Higher output fps
  is frame duplication/drop, not motion interpolation; upscaling adds no detail.
- Repeat with a portrait or square project. Presets retain its shape, never
  stretch it into landscape; 720p/1080p/4K names use 1280/1920/3840 longest edge.
- After completion, change the next-export form. The completed attempt's summary
  must retain its actual settings. Export again uses the new choices; reopening
  Export resets the form to defaults. Saved project rate/canvas/clips stay unchanged.
- Cancel a long-enough export and wait for cleanup. Keep the existing uncertainty,
  busy inspection and matching-attempt checks in the recovery section above;
  fault injection belongs only in isolated fixtures.
- In Help, check the export guide and search `INVALID_EXPORT_SETTINGS` and
  `EXPORT_SETTINGS_MISMATCH`. Rejection and failed verification have different
  guidance; neither means saved timeline edits failed.

### Entrance/exit animation acceptance

- Relaunch for the saved-schema/engine changes. Use a disposable project with
  copied media, a video/image clip at least two seconds long and another visual
  layer if available.
- Select the clip, expand Properties > Animations. Expect None plus five choices
  for each end. Choose Fade in / Fade out; one bar appears with an entrance handle
  on the left and an exit handle on the right, each at about 0.5 seconds (shown as
  % of clip, seconds and frames). Apply.
  Draft changes alone must not save. Wait for Autosaved.
- Drag the entrance handle right and the exit handle left: they stop where they
  meet, so both together never exceed 100%. − / + change by 1%. A very short
  result shows "Too short to show". With only one end chosen, only its handle shows.
- Scrub to the first included frame, end of the entrance, middle and last included
  frame. Expect transparent, normal, normal, transparent. Playing should follow
  the same progression; audio should not fade.
- Try Zoom in/out, left/right slides and Rise/Drop. Zoom goes from/to 80% of saved
  size; slides go fully outside the canvas. Check a static position/scale/opacity
  adjustment combines with the animation rather than being reset.
- Apply, Undo, Redo and Remove animations. Close/reopen the project and confirm
  applied effects persist. Locked tracks and unconfirmed edits disable controls.
- Try typing entrance+exit over 100%. Expect readable rejection and no saved
  change. Trim or speed up the animated clip: the effects rescale with it instead
  of being rejected. Splitting keeps entrance on the left and exit on the right at
  the same on-screen length (capped at a half's full length). Undo restores the
  original clip/effects. A project saved earlier with fixed-length animations
  still opens and plays the same.
- Export a short sample, including 60 fps / 1080p if desired, and compare timing,
  position/scale/opacity with preview. Other layers starting/ending must not restart
  the animation. There may be small pixel differences from scaling/compression.
- Help > Animation catalog lists all ten real presets with descriptions and
  default/version details. Errors includes `INVALID_ANIMATION`; custom animation
  editing and neighboring crossfades are clearly future features.
- Owner desktop acceptance is pending. Automated synthetic checks are not broad
  hardware/codec, long-project performance or frame-perfect color certification.

### Remaining K24/K26 acceptance gate

Use synthetic projects, fault-injected API responses and owned test files only. Keep this gate focused; it is not a request to rerun the full suite.

**K24 — API and media failure edges**

- The focused client API regression matrix exercises all 16 wrappers with rejected fetch, non-JSON HTTP error, schema-invalid success response and stalled request; it also checks a stalled response-body parse. Expect stable `UNREACHABLE`, `HTTP_<status>`, `BAD_RESPONSE` or `REQUEST_TIMEOUT` results, and an aborted request at the 15-second deadline. Keep actual UI-consumer checks for empty-vs-failed recent lists, default-folder retry, uncertain mutation recovery, failed media refresh, proxy reconciliation and preview retry; helper-only tests do not establish UI recovery.
- For read APIs that refresh recent projects, default-folder location, media status and proxy states, begin a request and then switch/reopen the project, change asset identity/source metadata, or change engine configuration before it resolves. The old response must not overwrite newer state; a default-folder response must not replace a location the user typed or cleared; failed snapshots must preserve last-known state where available and expose a way to retry.
- Start an authoritative project refresh from the first Editor, close that project, and reopen the same project before resolving the old request. The old Editor response must not update the reopened Editor; close/reopen must preserve the newly opened project's own state.
- For create/open, import, command and export mutations, inject lost responses after submission and verify the corresponding status/reconciliation path sends no duplicate mutation. A missing, evicted or restarted-engine attempt remains explicitly uncertain; no test may treat timeout as rollback.
- Cover close, recent/default-folder, media/proxy refresh, and preview recovery through their actual UI consumer, asserting codes/messages and explicit retry/reconciliation rather than only testing the shared helper.

**K26 — expected failures, correlation and privacy**

- Build a bounded inventory of expected filesystem, validation, offline-media, cancellation and cleanup failures at the engine/API boundary. For each, assert the stable domain code and actionable user message; only failures requiring operator diagnosis should receive a diagnostic ID. A normal rejection must not be relabeled as an unexpected 500.
- Inject private paths, tokens, request values and exception messages into representative expected and unexpected failures. Assert the intended response fields remain useful while structured engine records contain only the documented allowlist; test stderr and persisted JSONL correlation by matching the displayed UUID.
- Check legacy launcher/component logs separately from structured engine records. Identify which may include paths or raw output, document that boundary, and do not claim universal redaction or crash-proof capture.
- Verify sink write/initialization failure leaves engine behavior and stderr diagnostics explicit. Do not silently present persistence as successful when the local diagnostic sink fails.

Record the exact test files and outcomes in the review status. Keep K24/K26 partial until the matrix is covered; these checks do not imply hosted CI, native-picker, real-codec, multi-client, crash-proof persistence or universal redaction acceptance.

#### Import/export lifecycle errors

These engine/API codes complement the launcher catalog. Import and export consumers surface their relevant codes/messages and correlated IDs where implemented; consistent behavior across all editor API/UI paths remains part of the K24 acceptance gate above.

#### Common unexpected-engine diagnostics (K26 slice)

- `ENGINE_UNEXPECTED_ERROR` (500): an unexpected route failure, with a server-generated `diagnosticId`. Reconcile mutation status before retrying; no rollback is implied. `PROJECT_OPERATION_FAILED` and successful `PROJECT_PREPARATION_FAILED` warnings also carry diagnostic correlation.
- Search the local stderr capture and engine-owned diagnostics JSONL for the displayed UUID. Windows quick-start captures inherited engine stderr in the session desktop error log; manual starts also persist structured engine diagnostics under the engine data directory. No telemetry or complete crash-proof persistence is claimed.
- The new JSON record includes time, code, registered route/method and up to three allowlisted error-class/I/O causes (e.g. ENOSPC). It intentionally omits raw exception text/stacks, paths, request/query/parameter/body/header data and caller request IDs. Unknown causes may have only an Error category or no causes; this is not a complete root-cause trace.
- The engine writes these structured records to `<ENGINE_DATA_DIR>\diagnostics` (default `%USERPROFILE%\.video-editor-prototype\diagnostics`) as JSONL, independently of launcher capture. Each engine run is limited to three 1 MiB files. At startup, inactive runs older than 14 days are removed and inactive runs are pruned toward a 10 MiB soft budget; potentially active runs are preserved, so storage can exceed the target. Sink failures emit a warning to stderr and do not change the underlying operation.
- Failed proxy background jobs carry a safe `BACKGROUND_JOB_FAILED` diagnostic ID in their status; the preview-failure badge exposes the job message and ID. Verify engine stderr contains the matching structured ID without the injected source path/message. This does not imply other expected or background failures have been correlated.
- Unexpected per-file import failures and generic background export failures also carry diagnostic IDs. Import responses show a safe recovery message and ID; export preserves its existing error text and adds the ID. Their structured stderr records contain allowlisted cause metadata, not raw error text or paths. Expected typed import/export failures are not relabeled as unexpected.
- Unavailable/unknown component details and recovery hints are inline in the status area, so recovery guidance does not depend on hover.
- Tests inject private strings in all excluded surfaces and verify absence from the new record/response, matching IDs, valid UUIDs, cyclic/deep causes, malformed JSON 4xx and retained UI correlation. Existing logs and expected-domain error messages are not universally redacted by this slice; inspect/redact them before sharing (R5).

| Code | Meaning | Workaround / next action |
|---|---|---|
| `PROJECT_CHANGED` (409) | The originating project was closed, switched or reopened before import/export validation or metadata commit | Select the intended project and retry; stale work does not transfer to the newly opened project |
| `IMPORT_FAILED` (500 for a batch commit; per-file failures also use this code) | Import preparation or project commit failed | Read the message; check source/project permissions and free space, then retry after reconciling the project |
| `IMPORT_CLEANUP_FAILED` (500) | Import failed and a newly copied media file could not be removed | Inspect the listed path after work settles; close readers/check permissions; remove only the reported uncommitted copy, never existing project assets |
| `EXPORT_BUSY` (409) | Another export is validating, rendering, verifying or settling cleanup | Wait for settlement before starting again; reset/cancel does not release a live writer early |
| `EXPORT_CANCELLED` (409 during start) | Cancel/reset invalidated asynchronous preflight before rendering began | Retry only in the intended open project |
| `EXPORT_FAILED` (job status) | Rendering, duration verification or exclusive output publication failed | Read the message; check originals, permissions/free space and hard-link filesystem support; existing output files are not overwritten |
| `EXPORT_CLEANUP_FAILED` (job status) | A failed/cancelled export could not remove its owned output/partial path | Inspect the listed paths after the writer exits; close readers/check permissions and remove only that job's files |

Project switches and engine shutdown await proxy/export writer settlement. FFmpeg's abort error alone is not proof the child exited; cleanup waits for its close event. A completed `done` export remains on disk after a later cancel. Cleanup errors from jobs invalidated by reset go to engine stderr (captured in the launcher's desktop error log), not into the next project's status. Manual-launch stderr is outside launcher retention.

#### Project persistence and recent-list recovery

| Code | Meaning | Workaround / next action |
|---|---|---|
| `CORRUPT` (422) | Neither main nor backup passes shape/relational validation, or a save attempts invalid project data | Preserve both files. Read the named invariant; restore a known-good copy. Do not fix dangling references by guessing or delete the backup |
| `STORE_IO_FAILED` (500) | Project files cannot be inspected/read for a reason other than absence | Check the reported path, permissions and storage availability. I/O failure is not automatically treated as corrupted data |
| `SAVE_FAILED` (500) | Preparing/replacing main or backup failed | Check permissions/free space and retry. The engine does not adopt the failed edit; a recovery save never promotes corrupt main data into the usable backup |
| `SAVE_CLEANUP_FAILED` (500) | Save failed and owned temporary-file cleanup failed too | Preserve main/backup. After work settles, inspect the reported UUID temporary path and remove only that failed operation's temporary file |
| `RECENT_UPDATE_FAILED` (warning on successful create/open) | The project is saved/open, but recent-list bookkeeping failed | Continue editing or open by folder next time. Read the editor warning; check index permissions/storage. Do not recreate the successfully created project |
| `RECENT_INDEX_INVALID` (500 for list) | The index is damaged or has invalid fields | Open projects by folder. Preserve/rename the reported index before rebuilding it; it is not silently discarded or overwritten |
| `RECENT_UNAVAILABLE` (500 for list) | The index or a referenced project cannot be inspected | Check the reported path/permissions and reopen the Projects screen after correcting it; a failed list is not displayed as "No recent projects" |

Backup-only valid projects remain selectable in recents. Invalid main data falls back to a validated backup and warns on open; saving that recovered state preserves the existing backup. These guarantees cover awaited filesystem failures, not power loss, fsync durability or concurrent independent engine instances.

Regression tests isolate client/Ollama/project configuration, block ordinary user start/stop operations during the suite, and clean up only recorded test identities. They test malformed state, command-name FFmpeg overrides, and retry after a simulated child termination failure.

### Log retention and storage warnings (launcher only)

The first retention slice is implemented for Windows quick-start logs. It is **not** an in-app alert system or unified engine/vision logging service. Manual launches below are outside this retention policy. There is no background timer: cleanup and threshold checks run during script startup/shutdown or a manual cleanup command.

The launcher creates `log-settings.json` in the project-key log directory with these defaults:

```json
{
  "enabled": true,
  "retentionDays": 14,
  "maxTotalMB": 250,
  "keepRecentSessions": 3,
  "minFreeDiskMB": 1024
}
```

- Edit this local JSON while no launcher operation is running. All fields are required: `enabled` is boolean, the other fields are integers. Retention days (1-36500) and total MB must be positive; recent-session count and minimum free MB can be zero. `enabled: false` disables deletion, not usage warnings.
- The age starts when cleanup first verifies that all recorded session writers have exited, not at session creation. This deliberately delays deletion after an unobserved exit. Active sessions and their recorded children, `preserved: true` sessions, the latest configured number of closed sessions, unknown/corrupt sessions and links are protected.
- Eligible closed sessions are removed oldest-first if expired **or** if usage exceeds the soft target. Budget pressure may delete an eligible session before the age limit. The target is not a hard cap: active logs are never truncated or rotated to force compliance. A file-open check also skips a session whose files are in use.
- `session.json` is internal lifecycle metadata. To retain a closed session for investigation, set its `preserved` field to `true` while no launcher operation is running. Do not edit writer identities or process state.
- Old root-level `.log`, `.err` and `.jsonl` files count toward usage but are never automatically deleted. Operational state/configuration, project data, media and exports are not cleanup targets. Review legacy logs manually only after their writers have stopped.

Preview and then apply from the app folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cleanup-logs.ps1 -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\cleanup-logs.ps1
```

The JSON result includes `status` (`completed`, `partial` or `failed`), `exitCode`, projected/actual `remainingBytes`, `protectedBytes`, `legacyBytes`, `usageComplete`, successfully selected/deleted and `failedSessions` directories, plus coded warnings. Exit code `0` means cleanup completed, `2` means it was partial or could not fully account for storage, and `1` means every attempted deletion failed or configuration/cleanup failed before a result was produced. JSON is written to stdout; warnings go to stderr and the local diagnostic log. A dry run deletes no logs and does not update closed-session metadata, but creates its own diagnostic session and may write warnings. Usage is remeasured after deletion and warning logging; it remains a snapshot and can grow while the app is running. If links or unreadable paths prevent full accounting, `usageComplete` is false and reported bytes are a lower bound.

Warnings appear in the terminal and local diagnostic log, not yet in the app. Pending: nonblocking in-app storage alerts, periodic checks, usage/configuration controls and Open logs / Preview cleanup / Retry actions.

Safety regression checks use small isolated synthetic logs, not user projects or a full disk:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-log-retention.ps1
```

## Launch options

### A. Desktop app (Electron), the main way

Electron starts the engine for you and stops it when the window closes.

```powershell
# terminal 1: client dev server (must run first)
pnpm dev:client

# terminal 2: desktop shell
pnpm dev:desktop
```

The shell loads `http://127.0.0.1:5173`. Set `VE_CLIENT_URL` to use another address.

### B. Browser only

Useful for quick UI checks and the browser tests. There is no native file dialog, so the Assets pane shows a text box for a full file path.

```powershell
# terminal 1: engine
pnpm dev:engine

# terminal 2: client
pnpm dev:client
```

Open `http://127.0.0.1:5173`. The engine uses the dev token `dev-token` on port 7878 unless you set `ENGINE_TOKEN` and `ENGINE_PORT`.

### Vision service (optional until M4)

```powershell
cd apps\vision
python -m uv run python -m app.main   # serves on 127.0.0.1:7879
```

The engine reports it in the diagnostics. The editor works without it.

## Before you start: clean-state checklist

Stale processes cause confusing failures (K5).

```powershell
Get-NetTCPConnection -LocalPort 7878,5173 -State Listen -ErrorAction SilentlyContinue
```

If something is listening that you did not just start, find its owner with `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` and stop it with `Stop-Process -Id <pid>`.

## Automated checks

```powershell
pnpm test        # unit and real-FFmpeg tests; prints a warning if FFmpeg is missing
pnpm typecheck
pnpm lint
cd apps\vision; python -m uv run pytest
```

Use the test runner's reported totals; the expected count changes as focused regression tests are added. Check any FFmpeg skip warning before interpreting the result.

## Test media

Keep a small kit of clips in a folder outside the repo:

- A short clip (5-10 s), 1280x720, 29.97 fps (the Slice B demo clip).
- A 1080p clip at 25 or 30 fps, 20-30 s.
- A clip with no audio, and an audio-only file.
- A still image (PNG or JPEG) to test supported image import, and a text file renamed `.mp4` (should fail cleanly).

Generate a synthetic clip with FFmpeg if needed:

```powershell
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30000/1001 -f lavfi -i sine=frequency=440 -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac demo.mp4
```

## Manual test checklist

Mark each as Pass, Fail or N/A with the date and build (`git rev-parse --short HEAD`). Log failures as Known issues in [doc 10](./10-future-features.md).

### M1: shell
- [ ] The app opens with Assets, Preview, Properties, optional Assistant and Timeline. Resize pane dividers by dragging or keyboard arrows; hide/show Assistant and verify Properties stays immediately beside Preview. Saved widths survive reopening and Reset layout restores defaults.
- [ ] Diagnostics show the engine, FFmpeg and vision as `ok` (vision may be down).
- [ ] Closing the window stops the engine (check port 7878 is free afterward).

### M2 Slice A: projects
- [ ] Create a project: name, parent folder (native picker), frame rate, resolution. A subfolder named after the project appears with `project.json`.
- [ ] The project appears in recent projects. Close and reopen it from there.
- [ ] Open a project by choosing its folder.
- [ ] Damage `project.json` (keep the backup): the app recovers from the backup with a message.
- [ ] Force-kill Electron from Task Manager: the engine process also exits.

### M2 Slice B step 1: import
- [ ] Import the demo clip by reference. It appears with resolution, fps and duration.
- [ ] A new video can be placed and previewed from its original without starting conversion. Right-click Prepare optimized preview only when desired: the badge goes Optimization queued/Optimizing preview n% then Preview ready.
- [ ] "Match the first imported video" sets the project fps to the clip's fps.
- [ ] Importing the same file again is rejected as already imported.
- [ ] Import a PNG or JPEG alongside the fake `.mp4`: the image imports as an image asset, and the invalid file shows a per-file error without blocking the image.
- [ ] With "Copy files into the project" on, the file appears under `media/`.
- [ ] Delete a proxy in `proxies/` while the test project is closed, then reopen: its missing reference clears, the original is used, and no conversion starts. Explicit preparation can regenerate it.

### Caption foundation compatibility (schema v2)

- [ ] After relaunching the new build, open a **copy** of an existing v1 project.
  A migration notice explains that it is converted in memory and later saves
  use v2. Opening alone must not rewrite the main or backup files.
- [ ] Make a normal undoable media edit on that copy, close and reopen: media
  edits remain intact, saved schema is v2 and the caption lane is empty.
  Keep the original copy separate; do not open upgraded work in older builds.
- Caption cue add/edit/remove, malformed/overlapping timing, exact Undo/Redo,
  autosave/reopen, legacy backup recovery and unsupported-version no-overwrite
  behavior are covered by isolated automated fixtures. Do not hand-edit a real
  project for fault tests.

### Manual caption workspace and Preview

Use a project copy, keeping the pre-upgrade original out of older app builds.

- [ ] Captions start collapsed below the timeline with a cue count/density strip.
  Expand captions; room is made in the resizable timeline area. Collapse again;
  saved cues remain visible in Preview.
- [ ] At an empty playhead position choose New caption at playhead. Enter Unicode
  and multiline plain text and whole-frame start/end values, then Add caption.
  Before Add/Apply no project change is saved; Cancel draft discards it.
- [ ] Select a cue in the lane/list: playback pauses and seeks to its start while
  the media selection remains unchanged. Apply wording/timing changes, Undo/Redo,
  close and reopen; the saved text/timing and cue count agree.
- [ ] Try blank text, fractional/empty frames, end before start and overlapping
  cues on this copy: show validation and save nothing. Adjacent cues are allowed.
- [ ] With no text draft, drag a block to move it, then each edge to retime it:
  motion stops at neighbors/zero and retains at least one frame. Release makes
  one Undo step; Escape/cancellation discards the drag.
- [ ] Put the playhead inside a cue and Split caption: both halves keep the text.
  Edit their words separately. Merge with next joins chronological neighbors and
  any gap, with a newline between texts. Each operation and Delete caption undo
  atomically. Caption-focused S/Delete must not split/delete a media clip.
- [ ] Zoom, Fit timeline, horizontal-scroll and Follow playhead: captions remain
  aligned with the media ruler and both playheads. Resize the timeline and
  collapse/expand; controls remain reachable by scrolling the panel.
- [ ] Preview uses bottom-centered white text with a dark shadow and wraps long
  lines. Change canvas aspect and scrub across start, adjacent end/start, gaps
  and exclusive end; text follows without moving with clip transforms/crop.
  Literal markup stays text, not styled HTML. Test captions on media, gaps and
  after media ends; editor playback reaches the last cue.
- [ ] The expanded panel and Export dialog warn that captions are Preview-only.
  Export still renders media only, with no subtitle burn-in or cue-based duration
  extension. SRT, styling controls and speech generation are not available yet.

### M2 Slice B step 2: timeline and preview
- [ ] "Add to timeline" places the clip at the start; adding again appends it after the last clip.
- [ ] Click or drag in the ruler or lane to scrub; the preview and timecode follow.
- [ ] Play and pause (button and Space); Speed 0.5x, 1x, 1.5x and 2x change the pace.
- [ ] Preview's Canvas aspect ratio offers 16:9, 9:16, 1:1 and 4:3. With clips present, change each ratio: playback pauses, the displayed canvas/dimensions and export summary agree, and clip timing/appearance values stay unchanged. Check Undo/Redo and reopen preserve the expected dimensions. Make a short export and check its shape. Existing custom ratios show Custom until changed; unresolved edits and closing disable the control.
- [ ] Select a visual clip and toggle Crop beside Preview. Four edge and four corner handles replace resize handles. Drag each type in Free-form mode; Preview and Properties > Crop update live. Release saves one Undo step. Escape or cancellation discards the gesture; a plain click makes no history entry.
- [ ] Right-click the picture: the Crop section shares the toggle and Free-form/Project aspect locked choices with Properties. In locked mode, drag horizontal, vertical and diagonal handles; the retained picture uses the current project ratio (within source-pixel rounding), including a landscape source on a portrait canvas. Selecting the constraint alone does not crop until the next edit.
- [ ] Change the four Properties crop percentages. Only Preview changes until Apply crop; Cancel crop draft restores the saved crop. Invalid/empty percentages explain the problem and cannot apply. Reset crop removes crop without changing position, scale, opacity, effects, timing or sound. Check Undo/Redo for Apply and Reset.
- [ ] Crop a moved/resized clip with zoom and entrance/exit effects at an interior playhead frame. Switch canvas ratio and resize the Preview pane: the outline remains on the displayed cropped picture. Export a short sample and compare removed content, fit, placement and motion. Check save/close/reopen on a test copy.
- [ ] Locked tracks, pending edits, closing and offline sources cannot crop. An extreme source/project ratio outside inset limits explains why aspect lock is unavailable; Free-form remains available. Do not modify real project files to simulate faults.
- [ ] In Free-form Crop, drag just the left edge: only that edge moves; the right edge, top/bottom and retained source landmarks stay in place without enlargement/recentering. Repeat on an already cropped clip and in portrait/landscape with zoom. Appearance/Fit and resize handles must be unavailable during Crop, and toggling Crop during a resize must cancel its transform draft. Exit Crop to move/resize again.
- [ ] Right-click near all canvas edges with a small Preview pane. The entire menu is above the editor, can extend beyond the canvas and stays inside the window (scrolls if needed). Verify all entries remain clickable and Escape/outside click/scroll dismiss it. Compare the in-place crop against a short export: a retained source landmark must occupy the same pixels before and after cropping.
- [ ] With Crop off, both right-click constraint choices and the Properties constraint selector are greyed out. Enter Crop: they enable, and the menu radio dot/Properties status identify the same selected constraint. Switch constraints, exit and re-enter Crop: the choice stays indicated without changing saved crop data.
- [ ] Select a resized/moved picture at the playhead, then use Fit to canvas below Preview and from its right-click menu. Position resets to center and base scale to 100%; proportions, opacity, crop and effects stay unchanged. Playback pauses. Check Undo/Redo and a short export; a retained zoom may still enlarge the picture. Locked tracks, pending edits and unavailable selections disable Fit.
- [ ] With zoom/slide effects present, pause partway through the effect, switch to 9:16, resize and move the clip, then switch to 16:9. The selection border and corner handles must follow the actual picture, not its unanimated bounds. Resize/move again, scrub and use Undo/Redo: the animation must remain intact without doubling the saved scale. Fully offscreen slide endpoints show guidance and no resize handles; move inside the slide to edit.
- [ ] Help > About shows the credit, thank-you note, support link(s) and open-source credits; the link opens in the default browser, not inside the editor window, and the tab still works offline.
- [ ] Previous frame / Next frame beside Play and Left / Right arrows pause playback and move one project frame. Check timecode across a second and a clip cut, including gaps and a fractional-rate project. Playback speed and clip speed must not change the step size. At the start/end, repeated steps stay within the included frames; both buttons are disabled on an empty timeline. Holding an arrow repeats steps.
- [ ] Frame-step arrows must not move the playhead while typing, adjusting a slider/dropdown, resizing a pane by keyboard, or using Help/Export dialogs. Modified arrows must not step. Selection, saved project state and Undo history remain unchanged. On short owned footage with visibly distinct frames, wait for decoding and verify the actual picture on both sides of a cut; an exact timecode/source seek alone does not certify decoded-frame accuracy.
- [ ] Play across a cut to another video, then pause; confirm the newly active preview video stops immediately and does not resume from a late playback request.
- [ ] Split (button or S) at the playhead; the two halves play back-to-back with no visible gap.
- [ ] Select a clip and Delete it; playing across the gap shows "No clip here", then resumes with the next clip.
- [ ] At the end of the timeline playback stops and holds the last frame (K6).
- [ ] Zoom in and out keeps the playhead and clips aligned.
- [ ] During playback, scroll horizontally using a trackpad/Shift+wheel or scrollbar: Follow playhead turns off, the view stays where you scroll, and playback continues. Pause/resume must not force follow back on. Enable Follow playhead to return to the playhead; vertical scrolling alone must not disable it. Keyboard-scroll the focused timeline area as well.
- [ ] With a nearly three-hour timeline, choose Fit timeline to see the full duration, and zoom out beyond the former 10 px/s limit. Hour labels must distinguish 01:00:00 from 02:00:00. Zoom in again around the visible playhead (or the viewport center when off-screen); playback, clip positions and trims must be unchanged. Fine frame edits require zooming back in.
- [ ] Close and reopen the project: the clips are still there.

### Demo-media: still images
- [ ] Import a PNG or JPEG: the asset shows image dimensions and a five-second duration at the project's frame rate, with no video proxy badge.
- [ ] Add the image to the timeline: it appears as a five-second clip and the preview displays it while the playhead is over the clip.
- [ ] Scrub within the image clip and across its end; the image remains visible for the clip and the preview shows the appropriate gap or next clip afterward.

### Fast time-to-edit acceptance

- [ ] Use owned short and long supported footage by reference, including silent video. Measure import acknowledgement, editable registration, first frame and seeks separately against the proposed targets in [Preview and Export](./05-preview-and-export.md). Record hardware, codec/resolution/FPS, storage, cache state and background work. Copy mode also waits for copying; do not report synthetic metadata tests as three-hour performance measurements.
- [ ] Place a video with no proxy: Editing original appears, decoding works, and trim/split/seek/gaps retain existing boundaries. Initial loading ends only on decoded-frame readiness, not metadata alone. Unsupported/slow initial playback shows actionable error within five seconds and pauses the clock; Retry preview does not automatically resume or launch encoding.
- [ ] Prepare while playing: a finished proxy must not interrupt the original. Pause: Optimized preview is adopted at the same playhead; no unexpected resume. Compare trimmed frames/audio before and after the switch.
- [ ] Cancel both queued and running preparation. Wait for cancelled/settled status, then explicitly retry. Originals, assets, clips and timeline history remain intact; partial output is cleaned. Cancellation after publication begins may finish as Preview ready and must not remove that completed proxy.
- [ ] Reopen/relink with complete, absent and deleted caches: no implicit conversion starts. Close during preparation only after saving, and confirm reopening does not restart it. Use isolated fixtures for stale-response, decode, cleanup and API timeout injection; reconcile status rather than assuming a timed-out control succeeded.
- [ ] Export a trimmed timeline with and without a proxy and verify original-source output at project settings. Preview optimization must not lower export resolution. VFR/HDR/rotation, broad codec coverage and latency certification remain separate acceptance work.

### Selected-clip properties

- [ ] Appearance, Animations and Zoom start collapsed. Expand any heading with pointer or keyboard when needed; collapse/reopen without applying must preserve its draft and send no edit. An expanded section stays expanded after a save confirms; selecting another clip collapses the sections and shows current values. Clicking empty timeline space or a track row moves the playhead/selects the row but keeps the selected clip and its Properties. Properties has no Trim section; trim by dragging clip edges on the timeline.
- [ ] Select a timeline video/image clip. Properties shows its asset, track, start, duration and saved clip speed. No selection/deleted selection gives guidance instead of editing the wrong clip. Audio-row clips have trim/speed controls but no visual appearance controls; still images have no speed control.
- [ ] Drag a clip's left/right edge on the timeline to trim it. Out is exclusive; head trim moves the start, and extension follows existing ripple rules. Undo/Redo restores the clip and affected neighbors.
- [ ] Expand Appearance. Drag the Zoom slider: the preview follows while dragging and saves once on release (one Undo step). Click − / + several times quickly: each click moves 1% and the burst saves as one Undo step. Type 150 in the Zoom box and press Enter or Tab away to save. Then change center and opacity, and compare paused/playback preview with a short export. Center uses normalized project-frame coordinates; scale is relative to the fitted media, not source pixels. Content outside the frame is clipped; opacity does not change audio volume.
- [ ] Reset appearance, Undo and Redo, split/move the clip between visual tracks, and close/reopen. Saved appearance and inherited split appearance must remain consistent in preview/export. Test both a still and video, including a non-16:9 project.
- [ ] Change selection while values are unsubmitted: drafts must not leak to the next clip. Locked tracks, pending edits and project close disable property edits with an explanation. No per-keystroke save, duplicate Apply during a pending edit, or automatic playback resume.
- [ ] On a short video with audio, set speed with the slider (saves on release), − / + (0.05x) or by typing, at 0.25x, 0.5x, 1.33x, 2x and 4x. Start/source bounds stay fixed; timeline duration rounds to whole frames and every later same-track clip shifts by the duration change while preserving gaps. Other video/audio rows stay fixed. Preview and a short export should agree on source content, duration and preserved pitch.
- [ ] Change speed on an independent audio row, including a loop-extended clip. Confirm looping occurs in source time and compare preview/export. Undo/Redo restores all affected timing; close/reopen preserves the saved speed. Invalid speed, locked tracks and pending edits must not save changes.
- [ ] Drag both trim edges, split and move a sped-up/slowed clip. Trim deltas are speed-aware and split halves preserve source continuity and total duration. At very slow speed, an unrepresentable whole-source-frame split explains how to retry nearby instead of silently shifting timing. If a move/extension cannot trim a neighbor's head exactly, that neighbor moves intact.
- [ ] Entrance/exit animations and between-clip transitions remain labeled planned. The timeline transport's playback speed remains a preview-only control and does not change saved clip speed/export.
- [ ] Two-point zoom: select a video clip, expand Zoom and choose Add zoom (one Undo step). Scrub through the clip: it holds 100% until 25%, eases to 150% by 75%, then holds. Drag both bar handles and the scale sliders: Preview follows while dragging and each release saves one Undo step. Push the handles together; drag left from the meeting point to move the start and right to move the end. Move the playhead and use Set start/end at playhead; a point outside the clip or past the other point explains the problem without saving.
- [ ] Combine zoom with an Appearance zoom/center and an entrance/exit animation; the zoom centers on the saved center. Trim, change speed and split the clip: points stay relative, and a split shows no jump at the cut. Undo/Redo, close/reopen and Remove zoom clears it. The timeline clip shows yellow diamond markers at visible start/end points, joined by a line, updating live during drags. Export a short clip and compare its zoom timing and framing with Preview. Audio rows and locked tracks offer no zoom edits.

### Canvas editing in Preview

- [ ] Stack two visual clips (one smaller via Appearance). Click the front picture in Preview: it gets a blue outline with white corner handles and Properties shows it; clicking where only the back picture is selects that one instead. Clicking empty canvas keeps the current selection.
- [ ] Drag the picture: Preview and the Appearance Center sliders follow; releasing saves one Undo step. A plain click (no drag) saves nothing. Drag a corner handle: the picture resizes around its center keeping proportions and the Zoom slider follows.
- [ ] Snapping: dragging near the canvas center, an edge or another picture's edge/center shows a pink guide and snaps. Hold Alt to move freely; Snap off below the Preview disables it. Resizing also snaps an edge to the guides.
- [ ] Start playback, then click or drag on the canvas: playback pauses first and the outline is hidden while playing. On an animated or zoomed clip, the outline shows the resting position.
- [ ] Right-click a picture: Bring forward/to front are disabled when nothing overlaps it in front, Send backward/to back when nothing is behind. Each choice moves the clip to another visual track at the same time (adding a track when needed), Undo restores it in one step, and the timeline shows the change.
- [ ] Lock the clip's track: the picture can still be selected but has no handles, cannot be dragged and has no enabled layer actions. Export a short clip after moving/resizing and compare its placement with Preview, including a non-16:9 project and a square image.

### Autosave and backup recovery

- [ ] Rejected edits show a readable cause, impact and next step. Technical codes
  are under Error details. After an update, an invalid-command rejection suggests
  restarting; a confirmed rejection must not require loading/reviewing the project.
- [ ] On an isolated fixture, lose an edit response and its status receipt. The
  message must not claim the edit failed or succeeded. Use Check whether edit saved;
  if unavailable, Load saved project for review. Check the last edit on the timeline,
  read the Undo/Redo reset explanation, then explicitly continue editing. No duplicate
  mutation, automatic unlock, or different-project adoption is allowed.
- [ ] An uncatalogued edit failure creates one temporary local development task.
  Repeats increase its count. Open Development: unknown-error follow-ups and load
  the sanitized report; restart and verify it persists. Known errors add no tasks.
  Recording/read failures are visible and do not unlock an unconfirmed edit.
  Follow [the catalog-resolution workflow](./18-error-catalog-and-recovery.md)
  before removing matching records; never clear unrelated pending reports.

- [ ] On an isolated copy of a project, make an edit and observe Saving followed by Autosaved. A rejected edit must show its error without relabeling the previously saved project as Save failed.
- [ ] Inject a command `SAVE_FAILED` or `SAVE_CLEANUP_FAILED` before main-file replacement. Confirm the last saved timeline remains unchanged, Save failed explains the failure, and Retry edit is offered only after authoritative rejection/failed status. Restore writable storage and retry once: the same edit commits once with a new attempt ID and one Undo entry. Never use a real user's only project to test storage failures.
- [ ] Lose a command response or fail its status read: Save unconfirmed must remain distinct from Save failed, with no Retry edit. Use Check whether edit saved and, if needed, Load saved project for review; do not resubmit an ambiguous mutation.
- [ ] With the editor closed, corrupt or remove the main file in an isolated project copy with a valid backup. Open it: Backup loaded and a persistent Recovered from backup notice must explain possible missing recent edits. Opening and closing without edits leaves the files unchanged. Reopen, review, then make an edit: Autosaved and the notice confirm repair. Reopen again to verify the edited main loads normally and the usable backup was preserved.
- [ ] Import new media while recovered: Saving tracks the sent import, Save unconfirmed tracks a lost result, and confirmed completion marks the recovered project saved. Failed/duplicate-only imports must not claim to have repaired it.

### Demo-media: visual editing

- [ ] Assets show image thumbnails and muted video frames from an existing proxy or the original immediately, without inline action buttons. Thumbnail loading does not require full-file conversion and becomes unavailable after five seconds without readiness. Audio uses an icon (not a generated waveform). Offline media and thumbnail load/decode failures show explicit placeholders.
- [ ] For an online image/video whose thumbnail fails to load, right-click and choose Retry thumbnail. The preview should reload without changing the project or timeline; this does not regenerate a failed proxy.
- [ ] During a normal sent import, show Importing media without the uncertain-outcome recovery warning. After a timeout, show Check import result recovery controls instead; duplicate imports remain disabled. During an ordinary edit, show neutral Saving edit guidance and explain why asset changes/Undo/Redo are disabled; normal saving is not an error.
- [ ] While editing an original, explicitly prepare an optimized preview. Original playback remains available with separate queued/running progress; cancellation and optimization failure must not block supported original playback. Failed optimization shows its diagnostic ID and Retry optimized preview. Refresh reconciles status without starting encoding. At an offline visual/audio clip, show Relink guidance and avoid requesting that missing media.
- [ ] Select a visual or audio track, enter a Track name and choose Rename track. Confirm its label updates, spaces at either end are removed, blank/over-80-character names are rejected, and switching tracks resets the field. Undo/Redo the rename, including restoring an unnamed track's default label. Close/reopen to verify persistence.
- [ ] Select a track and choose Lock track. Confirm the label shows `[L]`, clip drag/trim is unavailable, insertion/drop/split/delete cannot alter it, and removal is disabled even for an empty locked track. Moving another clip into it must also fail. Unlock to resume editing; Undo/Redo both transitions and reopen to verify persistence. Playback/export, naming, muting, and ordering remain available while locked.
- [ ] Right-click an asset for Add to timeline, Remove asset, and (when offline) Relink. Confirm the actions target that asset, preserve offline/in-use/edit-lock restrictions, and close after selection. Test Shift+F10/the context-menu key on a focused card, arrow navigation, Escape with focus restoration, outside click, and menu placement near window edges. Dragging cards onto the timeline must still work.
- [ ] Move or rename a source file, then Refresh status. The asset becomes Offline; right-click it and choose Relink. Select the relocated original (or enter its absolute path in browser mode); confirm Offline clears, preview works, and positions/trims remain unchanged after reopening the project.
- [ ] Try relinking to a different file, missing path, or directory. Confirm a clear error, no asset/timeline changes, and no unresolved lock after a confirmed validation failure. Cancel the file picker or close the editor while picking; no late selection should modify another project.
- [ ] Relink a missing copied asset to an external original. Confirm it becomes reference media without copying/deleting files. Relink is not an Undo step; existing timeline Undo remains available. Existing video proxies are reused; missing references clear without queuing regeneration.

Relink validation uses the importer's sampled file fingerprint (size plus head/tail samples), not a full-file equality guarantee. Choose the relocated original, not a replacement encode. This initial flow does not support replacing media with different content or copying replacement files into the project.
- [ ] Select a video clip with sound and choose Split audio: the video goes silent, an audio clip with the same position and range appears on a free (or new) audio track, and one Undo restores both. Move/trim/mute the audio clip independently; Export uses the audio-track copy. The button is disabled for images, silent videos, audio clips, locked tracks and already-split clips.
- [ ] Stack two video clips with sound on separate visual tracks: Preview and Export both play both sounds. Mute the upper visual track: its picture stays, its sound stops in Preview and Export; Undo restores it.
- [ ] Click empty timeline space: the selection and Properties stay. Press Escape (outside text fields): the clip is deselected.
- [ ] Make a timeline edit, then use Undo and Redo toolbar buttons and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or Ctrl+Y; confirm each restores/reapplies the same project state. Buttons should be disabled when their stack is empty, and typing in a text field must not trigger shortcuts.
- [ ] Undo a clip drag/trim that changed a following clip, a cross-track move, a split, and a delete; confirm each compound edit is one history step and restores all affected clips. Make a new edit after Undo and confirm Redo is cleared.
- [ ] Drag a visual clip horizontally and confirm its trim/source range remains unchanged. A click without dragging should still scrub to the clicked time.
- [ ] Drag a visual clip vertically to another visual row; confirm it follows the pointer, keeps the same timeline position under the pointer and source range, and does not change track order. Drop over another visual clip and confirm overlap/compositing. Repeat for audio between audio rows; confirm cross-kind drops and audio overlaps are rejected.
- [ ] Start playback, then drag or trim a clip; confirm preview playback pauses immediately. Move a clip backward so it overlaps the following clip; confirm the following clip's head is trimmed while its end stays fixed, and the edit completes without leaving command recovery locked.
- [ ] Drag a clip toward the timeline's right edge and hold it there; confirm the timeline auto-scrolls and grows so the clip can be moved beyond the previous end. Repeat with an extendable clip's right trim handle.
- [ ] Drag either edge of a visual clip near time zero, the playhead, or another visual clip edge; confirm it snaps within the small screen-space threshold and shows a guide. Move farther away and confirm snapping releases.
- [ ] Drag a video or image clip's trim handle; confirm the draft edge follows the pointer and releasing commits the new duration. Extending over part of the next clip on the same track trims its head while preserving its end; extending far enough to consume it moves it intact and ripples following clips. Scrub/play the result. The source media files are not modified.
- [ ] Click or drag in the timeline and confirm the red playhead lines up with that time; it should not be offset by the track-label column.
- [ ] Add a visual track and use its raise/lower controls; confirm track order changes which overlapping clip appears in front.
- [ ] Seek to a point in the timeline, select a compatible track using its track-name button or by clicking its row, then add an asset. Confirm it starts at the playhead on that track. An overlapping clip moves intact after the new asset, and subsequent clips shift only as needed, preserving source ranges. Repeat with the insertion point inside an existing clip, and Undo/Redo the complete insertion. Incompatible or locked tracks report why placement cannot proceed; without a selected track, placement chooses a compatible free row or creates one.
- [ ] Drag a video, image, or audio asset from Assets onto a compatible timeline row. The insertion guide should follow the pointer and the new clip should start at the drop time on that row, regardless of the playhead or previously selected track. Repeat after zooming/scrolling, including overlapping drops that ripple whole clips forward, then Undo/Redo. Incompatible or locked drops must show an error without changing clips; offline assets cannot be dragged. Dropping on an empty timeline creates a compatible row.
- [ ] Remove an empty visual/audio track and confirm Undo restores it; confirm the remove button is disabled for tracks containing clips.
- [ ] Right-click and remove an unused asset and confirm Undo restores it; confirm Remove asset is disabled while any timeline clip uses that asset.
- [ ] Delete a timeline clip without removing its asset, then add that asset back to the timeline. Remove an empty track and add a track or asset that needs a new track; confirm track-order conflicts reconcile and the edit succeeds.
- [ ] Place a still image above a video clip; confirm preview compositing while scrubbing and verify the exported MP4 shows the image over the video.

### Demo-media: audio tracks
- [ ] Import an audio-only file. Add it to the timeline and confirm it appears on a dedicated audio row at the playhead with its natural source duration.
- [ ] Add another audio asset at an overlapping playhead position; confirm it uses a separate row rather than overlapping the first row.
- [ ] Drag an audio clip to another timeline position. When it extends into the next clip on the same row, confirm the next clip's head is trimmed while preserving its end; if consumed, it moves intact and following clips ripple.
- [ ] Drag an audio clip's right trim handle past the source duration; confirm the source loops to fill the extended clip. Trim either edge and confirm preview timing follows the new range.
- [ ] Mute/unmute an audio row and reorder audio rows; confirm preview output reflects the mute state and remains synchronized with the shared playhead.
- [ ] Export with audio continuing beyond the last visual clip; confirm the output duration includes the audio and the audio starts at its timeline position. Mute the row and confirm it no longer contributes sound.
- [ ] Test an audio-only timeline: preview plays the audio and export contains a black video bed with the audio track.

### M2 Slice C: export
- [ ] Save, close, reopen: the timeline is identical.
- [ ] Export an MP4 with progress; cancel works; the duration matches the timeline.
- [ ] A missing source file blocks export with a clear list (K7): rename the source, refocus the window; the asset shows Offline, clips turn red, Export is disabled.
- [ ] Split a clip and delete the middle piece: the exported file has a black gap with silence and the right total length.
- [ ] The top bar shows Saving…, then Autosaved after each edit.
- [ ] Files appear in the project's exports/ folder; no .part file remains after cancel or failure.

## Recording a bug

Include: build hash, launch option (A or B), steps, expected and actual result, and the engine log. Engine logs print to the terminal in browser mode; in Electron start it from a terminal to see them.