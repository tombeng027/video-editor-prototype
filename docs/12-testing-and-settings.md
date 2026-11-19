# 12. Testing and Settings

[Back to index](./README.md)

## Testing strategy

The table below is the target strategy. Current coverage is Vitest schema/core/engine/client-helper tests, Testing Library modal/creation/export component regressions in jsdom, real-FFmpeg tests, pytest for the vision health stub, and Windows launcher integration checks. The 2026-11-03 local full gate passed 25 Vitest files/327 tests, one vision pytest, both Windows PowerShell integration scripts, lint, typecheck and the client production build. The launcher test uses an ephemeral mock Ollama endpoint and does not run the optional real owned-Ollama scenario. Broader component coverage, automated Electron editing flows, AI evaluations and vision scoring tests remain planned.

Modal tests explicitly shim jsdom's missing native dialog methods; they verify React interaction and guards, not browser top-layer inertness. Native inertness, focus and keyboard behavior have a separate browser smoke check using synthetic API responses. Neither substitutes for native picker, real-media playback or complete accessibility acceptance.

| Layer | Tool | What is tested |
|-------|------|----------------|
| `packages/schema` | Vitest | Schema parsing, valid and invalid payloads, action validation |
| `packages/timeline-core` | Vitest | Every command, every invariant, undo/redo inverses, time conversion and rounding. Starts in M1 and grows with each command. |
| `apps/engine` | Vitest + fixtures | Project save/open (atomic write, backup recovery), ffprobe parsing, validation of AI actions, job lifecycle |
| `apps/client` | Vitest + Testing Library | Timeline interactions, layout, playback clock behavior |
| `apps/vision` | pytest | Scoring on small fixture clips, API contract |
| End to end | Playwright (Electron) | Import, split, save, reopen, export (from M2) |
| AI behavior | Evaluation set | Prompts for valid, ambiguous and invalid jump-cut requests (from M5), labelled clips for the vision pipeline (from M6) |

**Fixtures:** FFmpeg tests generate synthetic media. Local demo footage is gitignored. A curated small fixture/evaluation set is planned; no complete committed media kit is claimed.

**Quality gates:** lint, typecheck and tests run on every milestone before it is considered done.

## App settings

The following table describes target settings. There is **no Settings dialog** yet. Current configuration uses engine environment variables, project creation/import controls, and localStorage for layout. Autosave currently runs after every successful command batch, not on a debounce.

| Setting | Default |
|---------|---------|
| Ollama base URL | `http://127.0.0.1:11434` |
| Ollama model | `qwen3:8b` (fallback `llama3.1:8b`) |
| Default import mode | Reference (option: copy into project) |
| FFmpeg / ffprobe path | Current: system PATH or environment overrides; bundling is deferred |
| Proxy resolution | 540p |
| Autosave | Current: every committed batch; gesture coalescing/save strategy planned for M3 |
| Vision device | CPU (GPU is a future option) |
| Jump-cut clip duration limits | 0.2 to 2.0 seconds |

## Logging and diagnostics

- **Implemented locally:** Windows launcher captures per-session component stdout/stderr and coded errors. Local JSON config controls conservative age/soft-budget retention and terminal storage/low-disk warnings. Startup/shutdown and manual dry-run/cleanup checks are covered by isolated PowerShell tests. See [Run guide](./13-run-and-manual-testing.md) for configuration, safety boundaries and recovery codes.
- **Engine K26 slice (local):** unexpected route errors now return `ENGINE_UNEXPECTED_ERROR` with a server-generated diagnostic UUID matching one JSON stderr record and an engine-owned JSONL record. Project preparation/operation failures, unexpected per-file import failures, generic export failures and export cleanup failures use the same reporting helper; import/export UI status carries the ID while structured records omit raw error text and sensitive paths. Records contain time, code, registered route/method and at most three allowlisted error-class/I/O-code causes; they omit arbitrary messages/stacks, paths, bodies, headers, query/parameter values and caller request IDs. Project, import, command and export status consumers retain validated IDs in visible error text. This is limited diagnostic metadata, not a full trace or proof all existing logs are redacted.
- **Engine log policy:** under `<ENGINE_DATA_DIR>\diagnostics` (default `%USERPROFILE%\.video-editor-prototype\diagnostics`), files are limited to 1 MiB each and three files per engine run. Startup cleanup removes inactive runs older than 14 days and prunes the oldest inactive runs toward a 10 MiB soft aggregate budget. The current run and runs whose process may still be alive are preserved; uncertain process state is treated as active. If protected logs keep usage above budget, the engine warns on stderr and continues. This engine sink is separate from the launcher's per-session stdout/stderr capture and does not replace it.
- **Health presentation:** unavailable and unknown component detail/recovery hints display inline; healthy component details remain available as tooltips.
- **Not yet implemented:** vision-service logs, in-app storage banners, periodic monitoring, settings controls and status-area links to logs.
- **Capture boundary:** Electron's engine inherits stderr, captured by Windows quick-start in the session's desktop error log. Manual starts also persist structured engine diagnostics under the engine data directory; other stdout/stderr output still writes to the terminal unless redirected. No telemetry or complete crash-proof persistence is claimed. Expected-domain failure coverage and redaction/capture checks for legacy logs remain open; see the K26 acceptance gate in the [run guide](./13-run-and-manual-testing.md#remaining-k24k26-acceptance-gate).
- **Next diagnostics gate:** K29's partial-result semantics, post-cleanup accounting, atomic metadata and retry behavior now have focused local failure-injection/CLI coverage. K21's nonblocking in-app warnings and recovery controls remain a separate future integration. Broader engine/vision logging remains a separate integration step; the launcher policy does not cover manually launched services.

## Prototype distribution

The prototype runs in development mode only. Packaging and installers are out of scope and listed in the future features.
