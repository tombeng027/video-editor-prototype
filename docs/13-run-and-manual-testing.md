# 13. Running and Manual Testing

[Back to index](./README.md)

How to launch the prototype on a Windows PC and walk through the manual test checklist. Update the checklist as each slice lands.

### Modal interaction acceptance

With an isolated test project, verify Create and Export keep Tab/Shift+Tab inside the dialog and block background pointer/keyboard edits. Cancel/Escape should close an idle dialog and restore its opener focus. During creation, all fields and Cancel stay disabled and Creating explains the non-cancellable request; a failure permits retry and a successful response opens exactly the committed project. During export start preflight and running export, Escape/Close must not dismiss it; Cancel export remains available while running. Picker failure should show `FOLDER_PICK_FAILED` and unlock retry. Do not use user projects to inject failures. General network deadlines, export polling/cancel errors and real picker acceptance remain separate backlog checks.

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

The New project dialog displays API error codes with submission errors. Default-location warnings are separate and disappear when you supply a location, so late lookup failures cannot replace creation errors. Export poll/cancel and project-close recovery now show codes, with 15-second deadlines for export status/cancel and project read/close. General editor API code display, other deadlines and retained unexpected-error logging remain pending (K24/K26).

### Export and close recovery acceptance

Use synthetic projects/media, not user work; network fault injection is a test technique rather than a normal workflow.

- Disconnect/intercept export status after start: expect a coded error and Retry status check, with no overlapping polling or dismissible running dialog. Restore the endpoint and retry: expect authoritative progress/terminal state.
- Delay cancel: repeated clicks must send only one request. A running acknowledgement must show cleanup pending, not success; stale pre-cancel polls must not regress state. Reject cancel: expect its code and continued status checking.
- Missing unused, fully hidden or audio-track-only assets must not block an otherwise valid export. Missing visible/render-used originals must still block; engine preflight checks actual files.
- Delay close: Projects navigation stays blocked. Reject/timeout close: expect its code, no landing transition and Check project status before Retry close. Failed status checking must not unlock a blind retry.
- If the engine reports no project after a failed close, retry must confirm cleanup before navigation. If it reports a different project, Use active project must adopt that project without closing it. A stale expected ID/folder must return `PROJECT_CHANGED` and preserve the current project.
- Check actual native focus/Tab/Escape/input isolation. Component tests alone do not certify native pickers or screen readers.

`REQUEST_TIMEOUT` means the client deadline expired, not that an engine mutation was cancelled or rolled back. Broader mutation recovery is still K24 work.

#### Import/export lifecycle errors

These engine/API codes complement the launcher catalog. The editor currently displays import failure messages and export failure messages/codes, but does not expose every API code consistently.

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

The JSON result includes projected/actual `remainingBytes`, `protectedBytes`, `legacyBytes`, `usageComplete`, selected session directories and coded warnings. A dry run deletes no logs and does not update closed-session metadata, but creates its own diagnostic session and may write warnings. Usage is a snapshot and can grow while the app is running. If links or unreadable paths prevent full accounting, `usageComplete` is false and reported bytes are a lower bound.

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

Expect 96 passing JS tests at the time of writing. If the count is lower, check the skip warning.

## Test media

Keep a small kit of clips in a folder outside the repo:

- A short clip (5-10 s), 1280x720, 29.97 fps (the Slice B demo clip).
- A 1080p clip at 25 or 30 fps, 20-30 s.
- A clip with no audio, and an audio-only file.
- A still image (should be rejected) and a text file renamed `.mp4` (should fail cleanly).

Generate a synthetic clip with FFmpeg if needed:

```powershell
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30000/1001 -f lavfi -i sine=frequency=440 -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac demo.mp4
```

## Manual test checklist

Mark each as Pass, Fail or N/A with the date and build (`git rev-parse --short HEAD`). Log failures as Known issues in [doc 10](./10-future-features.md).

### M1: shell
- [ ] The app opens and the four-pane layout resizes by dragging.
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
- [ ] The badge goes "Preparing preview n%" then "Preview ready".
- [ ] "Match the first imported video" sets the project fps to the clip's fps.
- [ ] Importing the same file again is rejected as already imported.
- [ ] The image and the fake `.mp4` show a per-file error without blocking other files in the batch.
- [ ] With "Copy files into the project" on, the file appears under `media/`.
- [ ] Delete a proxy in `proxies/`, close, reopen: it regenerates.

### M2 Slice B step 2: timeline and preview
- [ ] "Add to timeline" places the clip at the start; adding again appends it after the last clip.
- [ ] Click or drag in the ruler or lane to scrub; the preview and timecode follow.
- [ ] Play and pause (button and Space); Speed 0.5x, 1x, 1.5x and 2x change the pace.
- [ ] Split (button or S) at the playhead; the two halves play back-to-back with no visible gap.
- [ ] Select a clip and Delete it; playing across the gap shows "No clip here", then resumes with the next clip.
- [ ] At the end of the timeline playback stops and holds the last frame (K6).
- [ ] Zoom in and out keeps the playhead and clips aligned.
- [ ] Close and reopen the project: the clips are still there.

### M2 Slice C: export
- [ ] Save, close, reopen: the timeline is identical.
- [ ] Export an MP4 with progress; cancel works; the duration matches the timeline.
- [ ] A missing source file blocks export with a clear list (K7): rename the source, refocus the window; the asset shows Offline, clips turn red, Export is disabled.
- [ ] Split a clip and delete the middle piece: the exported file has a black gap with silence and the right total length.
- [ ] The top bar shows Saving…, then Autosaved after each edit.
- [ ] Files appear in the project's exports/ folder; no .part file remains after cancel or failure.

## Recording a bug

Include: build hash, launch option (A or B), steps, expected and actual result, and the engine log. Engine logs print to the terminal in browser mode; in Electron start it from a terminal to see them.