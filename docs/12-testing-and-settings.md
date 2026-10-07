# 12. Testing and Settings

[Back to index](./README.md)

## Testing strategy

| Layer | Tool | What is tested |
|-------|------|----------------|
| `packages/schema` | Vitest | Schema parsing, valid and invalid payloads, action validation |
| `packages/timeline-core` | Vitest | Every command, every invariant, undo/redo inverses, time conversion and rounding. Starts in M1 and grows with each command. |
| `apps/engine` | Vitest + fixtures | Project save/open (atomic write, backup recovery), ffprobe parsing, validation of AI actions, job lifecycle |
| `apps/client` | Vitest + Testing Library | Timeline interactions, layout, playback clock behavior |
| `apps/vision` | pytest | Scoring on small fixture clips, API contract |
| End to end | Playwright (Electron) | Import, split, save, reopen, export (from M2) |
| AI behavior | Evaluation set | Prompts for valid, ambiguous and invalid jump-cut requests (from M5), labelled clips for the vision pipeline (from M6) |

**Fixtures:** a few short sample videos (constant frame rate, variable frame rate, with and without audio, an image, an audio file). Keep them small and committed to a `fixtures/` folder.

**Quality gates:** lint, typecheck and tests run on every milestone before it is considered done.

## App settings

App-level settings live outside any project (in the user's app data folder) and are edited in the Settings dialog.

| Setting | Default |
|---------|---------|
| Ollama base URL | `http://127.0.0.1:11434` |
| Ollama model | `qwen3:8b` (fallback `llama3.1:8b`) |
| Default import mode | Reference (option: copy into project) |
| FFmpeg / ffprobe path | Bundled binaries (option: system install) |
| Proxy resolution | 540p |
| Autosave | On, debounced |
| Vision device | CPU (GPU is a future option) |
| Jump-cut clip duration limits | 0.2 to 2.0 seconds |

## Logging and diagnostics

- The engine and vision service write rotating log files to the app data folder.
- The status area (see [UI Design](./08-ui-design.md)) links to the relevant log when a component fails.

## Prototype distribution

The prototype runs in development mode only. Packaging and installers are out of scope and listed in the future features.
