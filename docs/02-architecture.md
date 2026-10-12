# 2. Architecture

[Back to index](./README.md)

## Overview

```
+------------------+   HTTP + SSE      +----------------------+   HTTP   +-------------------+
|  Client (React)  | <----------------> |  Engine (Node/TS)    | -------> | Vision (Python)   |
|  UI, timeline,   |                    |  files, FFmpeg,      |          | OpenCV + CLIP     |
|  preview, chat   |                    |  export, validation  |          +-------------------+
+------------------+                    |  Ollama proxy        |   HTTP   +-------------------+
                                        |                      | -------> | Ollama (local)    |
                                        +----------------------+          +-------------------+
```

This diagram includes planned M4-M6 services. Currently the engine manages projects and FFmpeg jobs and probes external service health; Ollama chat and vision analysis are not implemented. The client never invokes media tools or AI services directly.

## Components

| Component | Tech | Responsibilities |
|-----------|------|------------------|
| Desktop shell | Electron | Window, native folder/media dialogs, reveal-in-folder, source-based engine startup/shutdown. Packaging and path drag-and-drop are planned. |
| Client | React, TypeScript, Vite, React hooks | UI, timeline interaction, playback clock, engine round-trip command dispatch. Zustand and optimistic dispatch are not currently used. |
| Engine | Node, TypeScript, Fastify | Project storage, import/probing, proxy generation, export and job queues; AI proxy/action validation planned |
| Vision service | Python, FastAPI health stub | OpenCV/PyTorch/CLIP scoring is planned for M6; peak finding/window building will stay in the engine |
| Schema package | TypeScript, Zod | Shared types for project, commands, AI actions, API payloads |
| Ollama | External local daemon | Health probing currently; LLM chat/action proposals planned |

## Why a client/engine split

- Keeps the client free of filesystem and native-binary dependencies, which allows a browser, a desktop wrapper, and later a mobile client against the same engine.
- Centralises validation: manual edits and AI actions pass through the same checks.
- Makes long-running work (proxies, export, vision) jobs with progress and cancellation.

## Repository layout

```
video-editor/
  docs/
  apps/
    desktop/           Electron shell (main + preload)
    client/            React + Vite app
    engine/            Fastify service
    vision/            Python FastAPI service
  packages/
    schema/            Zod schemas and shared types
    timeline-core/     Pure command reducer, undo/redo, time math (no I/O)
  package.json         pnpm workspace root
```

`timeline-core` is pure and I/O-free so it can later run on-device in a mobile or standalone build.

## Communication

- **REST implemented:** projects, import, media status, export state/cancel. AI action validation is planned for M5.
- **SSE implemented:** proxy job progress. Export uses polling. Chat streaming transport is planned for M4; WebSocket is not implemented.
- **Media delivery:** engine serves proxy media with HTTP range requests so `<video>` can seek.
- **Security:** engine binds to `127.0.0.1` by default. LAN access is a future, opt-in setting.
  - Engine API/media access uses the per-session token. `<video>` and `<audio>` elements cannot send headers, so media URLs carry the token as a query parameter.
  - The engine checks the `Origin` header and rejects requests from unknown origins, so other local web pages cannot read project files.
  - The vision stub binds to localhost. Engine-only authenticated analysis access must be implemented before M6; it is not a current guarantee.

## State ownership

- **Implemented:** the client holds the last engine-returned project and plans command batches; the engine applies the reducer and saves before returning the updated project. Client undo/redo and reconnect recovery are not implemented.
- **Planned:** serialize edits, build history from returned inverses, and handle reconnection explicitly in M3. Optimistic local reduction is optional future work, not current behavior.
- **Current implementation (M2 Slice A):** the engine owns the single open project and applies each command batch (`POST /project/commands`), autosaving and returning the project plus inverse commands. Since Slice B step 2 the client adopts that response without local reduction. The engine is authoritative, but async ordering, stale client state and mutation uncertainty still require K12/K24 recovery work. Default-local command/save latency has not been benchmarked. Optimistic reduction stays a future option if M3 drag editing needs it.
- **Planned M5-M6:** AI confirmations dispatch commands through this same path; `InsertSequence` is not implemented.

## Media tools

- **Implemented:** FFmpeg/ffprobe must be installed separately and discoverable on PATH or configured with `FFMPEG_PATH`/`FFPROBE_PATH`. They are not bundled and there is no Settings dialog.
- **Distribution prerequisite:** check the exact FFmpeg build, codecs and license obligations before bundling binaries; do not assume every build has the same license.

## Desktop shell rules

- Electron runs with `contextIsolation` on and `nodeIntegration` off. No save dialog or dropped-path bridge is currently exposed.
- The shell starts the engine on a free local port with a per-session token and stops it on quit. The engine's stdin is a pipe held open by the shell (`ENGINE_EXIT_WHEN_PARENT_GONE=1`); when the shell dies, even from a force-kill, the pipe closes and the engine exits instead of being orphaned. Editing APIs use HTTP and progress uses SSE; Electron IPC provides native dialogs and shell actions rather than timeline editing.
- Native dialogs use dedicated IPC channels with origin checks. Current preload API: `engine`, `pickFolder(title)`, `pickMedia(title)`, and `revealInFolder(file)`.
- Electron is chosen because the engine is Node/TypeScript and can be bundled directly. The thin-shell rule keeps a later move to Tauri or Capacitor open.

## Process management

- The desktop shell starts the engine first. The engine supervises FFmpeg jobs, not the vision service yet.
- The vision health stub is started manually in development. Engine-managed on-demand startup is planned for M6.
- Engine reports component status (FFmpeg found, Ollama reachable, vision ready) to the client for a clear diagnostics display.

## Tooling

- **JavaScript:** pnpm with workspaces manages the monorepo (`apps/*`, `packages/*`), so `packages/schema` and `packages/timeline-core` are shared without publishing. Setup: `pnpm install`, then `pnpm --filter @ve/desktop setup:electron` to provision the desktop binary explicitly.
- **Python:** `uv` creates the venv and installs locked dependencies from `pyproject.toml` for the vision service. Setup: `uv sync` in `apps/vision`.

## Cross-cutting rules

- Project/API payloads use shared schemas and persistence adds relational checks. Complete boundary error handling is not guaranteed: malformed SSE JSON and client recovery remain K24 work.
- Jobs currently have separate proxy/export schemas. A unified job model is a future design option, not an implemented abstraction.
- Errors are typed and carry a user-readable message.
