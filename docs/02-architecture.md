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

The client never talks to Ollama, FFmpeg or the vision service directly. All of that goes through the engine.

## Components

| Component | Tech | Responsibilities |
|-----------|------|------------------|
| Desktop shell | Electron | Thin wrapper: window, native file dialogs, real file-path drag-and-drop, starting/stopping the bundled engine. Contains no editing logic. |
| Client | React, TypeScript, Vite, Zustand (state) | UI, timeline interaction, playback clock, optimistic command dispatch |
| Engine | Node, TypeScript, Fastify | Project storage, import and probing (ffprobe), proxy generation, export, AI proxy and action validation, job queue |
| Vision service | Python, FastAPI, OpenCV, PyTorch (CLIP) | Frame sampling, embeddings, similarity scoring only (peak finding and window building stay in the engine) |
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

- **REST:** projects, assets, export jobs, AI action validation.
- **WebSocket (or SSE):** chat token streaming, job progress events.
- **Media delivery:** engine serves proxy media with HTTP range requests so `<video>` can seek.
- **Security:** engine binds to `127.0.0.1` by default. LAN access is a future, opt-in setting.
  - Every request needs the per-session token. `<video>` and `<audio>` elements cannot send headers, so media URLs carry the token as a query parameter (or the engine sets a session cookie).
  - The engine checks the `Origin` header and rejects requests from unknown origins, so other local web pages cannot read project files.
  - The vision service listens on localhost only and accepts requests from the engine only.

## State ownership

- The **client** holds the live project state and runs the shared `timeline-core` reducer, so edits feel instant and undo/redo is local.
- Each committed command is sent to the **engine**, which applies the same reducer to its own copy, autosaves it, and uses it to validate AI proposals. The engine copy is the source for what is written to `project.json`.
- On reconnect or open, the client loads the full project from the engine. If the copies diverge (the engine rejects a command), the client reloads the engine's state and tells the user.
- Commands triggered by AI confirmations (such as `InsertSequence`) are dispatched by the client like any manual command.

## Media tools

- FFmpeg and ffprobe are bundled as static binaries (for example via `ffmpeg-static` and `ffprobe-static`), with a setting to point at a system install.
- Static builds that include libx264 are GPL-licensed. This is acceptable for a personal prototype; revisit it before distributing the app.

## Desktop shell rules

- Electron runs with `contextIsolation` on and `nodeIntegration` off. The preload script exposes a minimal API: open/save dialogs, resolve dropped file paths, and engine status.
- The shell starts the engine on a local port with a per-session token and stops it on quit. The client talks to the engine over HTTP/WebSocket exactly as it would in a browser, so the client never depends on Electron APIs for editing.
- Electron is chosen because the engine is Node/TypeScript and can be bundled directly. The thin-shell rule keeps a later move to Tauri or Capacitor open.

## Process management

- The desktop shell starts the engine first. The engine supervises FFmpeg jobs and the vision service.
- Vision service is started on demand by the engine (or run separately in development) and exposes a `/health` endpoint.
- Engine reports component status (FFmpeg found, Ollama reachable, vision ready) to the client for a clear diagnostics display.

## Tooling

- **JavaScript:** pnpm with workspaces manages the monorepo (`apps/*`, `packages/*`), so `packages/schema` and `packages/timeline-core` are shared without publishing. Setup: `pnpm install`.
- **Python:** `uv` creates the venv and installs locked dependencies from `pyproject.toml` for the vision service. Setup: `uv sync` in `apps/vision`.

## Cross-cutting rules

- All inputs are validated with the shared Zod schemas at every boundary.
- Long jobs use a common job model: `queued`, `running`, `succeeded`, `failed`, `cancelled`, with progress.
- Errors are typed and carry a user-readable message.
