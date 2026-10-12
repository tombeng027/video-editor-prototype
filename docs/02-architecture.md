# 2. Architecture

[Back to index](./README.md)

## Overview

```
+------------------+   HTTP/WebSocket   +----------------------+   HTTP   +-------------------+
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
| Engine | Node, TypeScript, Fastify | Project storage, import and probing (ffprobe), proxy generation, export, AI proxy and action validation, job queue |
| Vision service | Python, FastAPI health stub | OpenCV/PyTorch/CLIP scoring is planned for M6; peak finding/window building will stay in the engine |
| Schema package | TypeScript, Zod | Shared types for project, commands, AI actions, API payloads |
| Ollama | Local daemon | LLM inference for chat and action proposals |

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
  - Every request needs the per-session token. `<video>` and `<audio>` elements cannot send headers, so media URLs carry the token as a query parameter (or the engine sets a session cookie).
  - The engine checks the `Origin` header and rejects requests from unknown origins, so other local web pages cannot read project files.
  - The vision stub binds to localhost. Engine-only authenticated analysis access must be implemented before M6; it is not a current guarantee.

## State ownership

- **Implemented:** the client holds the last engine-returned project and plans command batches; the engine applies the reducer and saves before returning the updated project. Client undo/redo and reconnect recovery are not implemented.
- **Planned:** serialize edits, build history from returned inverses, and handle reconnection explicitly in M3. Optimistic local reduction is optional future work, not current behavior.
- **Current implementation (M2 Slice A):** the engine owns the single open project and applies every command batch (`POST /project/commands`), autosaving after each one and returning the new project plus the inverse commands. The client also does not apply commands locally: since Slice B step 2 it sends each batch to the engine and adopts the returned project, so there is one source of truth and no divergence to reconcile. The engine is local, so the round trip is a few milliseconds. Optimistic local application (using the same reducer) stays an option if drag editing in M3 needs it.
- **Planned M5-M6:** AI confirmations dispatch commands through this same path; `InsertSequence` is not implemented.

## Media tools

- **Implemented:** FFmpeg/ffprobe must be installed separately and discoverable on PATH or configured with `FFMPEG_PATH`/`FFPROBE_PATH`. They are not bundled and there is no Settings dialog.
- **Distribution prerequisite:** check the exact FFmpeg build, codecs and license obligations before bundling binaries; do not assume every build has the same license.

## Desktop shell rules

- Electron runs with `contextIsolation` on and `nodeIntegration` off. No save dialog or dropped-path bridge is currently exposed.
- The shell starts the engine on a free local port with a per-session token and stops it on quit. The engine's stdin is a pipe held open by the shell (`ENGINE_EXIT_WHEN_PARENT_GONE=1`); when the shell dies, even from a force-kill, the pipe closes and the engine exits instead of being orphaned. The client talks to the engine over HTTP/WebSocket exactly as it would in a browser, so the client never depends on Electron APIs for editing.
- Native dialogs use dedicated IPC channels with origin checks. Current preload API: `engine`, `pickFolder(title)`, `pickMedia(title)`, and `revealInFolder(file)`.
- Electron is chosen because the engine is Node/TypeScript and can be bundled directly. The thin-shell rule keeps a later move to Tauri or Capacitor open.

## Process management

- The desktop shell starts the engine first. The engine supervises FFmpeg jobs, not the vision service yet.
- The vision health stub is started manually in development. Engine-managed on-demand startup is planned for M6.
- Engine reports component status (FFmpeg found, Ollama reachable, vision ready) to the client for a clear diagnostics display.

## Tooling

- **JavaScript:** pnpm with workspaces manages the monorepo (`apps/*`, `packages/*`), so `packages/schema` and `packages/timeline-core` are shared without publishing. Setup: `pnpm install`.
- **Python:** `uv` creates the venv and installs locked dependencies from `pyproject.toml` for the vision service. Setup: `uv sync` in `apps/vision`.

## Cross-cutting rules

- All inputs are validated with the shared Zod schemas at every boundary.
- Jobs currently have separate proxy/export schemas. A unified job model is a future design option, not an implemented abstraction.
- Errors are typed and carry a user-readable message.
