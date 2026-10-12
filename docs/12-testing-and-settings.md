# 12. Testing and Settings

[Back to index](./README.md)

## Testing strategy

The table below is the target strategy. Current coverage is Vitest schema/core/engine/client-helper tests, real-FFmpeg tests, pytest for the vision health stub, and Windows launcher integration checks. Testing Library component tests, automated Electron editing flows, AI evaluations and vision scoring tests are still planned.

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
- **Not yet implemented:** rotating engine/vision logs, in-app storage banners, periodic monitoring, settings controls and status-area links to logs. The status area currently shows health indicators and detail/hint tooltips.
- **Next diagnostics slice:** nonblocking in-app warnings and recovery controls. Broader engine/vision logging remains a separate integration step; the launcher policy does not cover manually launched services.

## Prototype distribution

The prototype runs in development mode only. Packaging and installers are out of scope and listed in the future features.
