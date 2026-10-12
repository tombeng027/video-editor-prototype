# Video Editor Prototype

A CapCut-inspired desktop video editor prototype. Local Ollama guidance and CLIP-based jump-cut candidates are planned for M4-M6, not implemented yet.

**Stack:** Electron shell, React + Vite client, Node/TypeScript engine (Fastify, FFmpeg), Python vision service (CLIP), shared Zod schema and a pure timeline reducer.

## Status

Milestone 1 (foundation) is complete. M2 (manual vertical slice) is complete: project create/save/open, import with proxies, timeline and preview with split and delete, and MP4 export with progress and cancel. M3 (timeline usability) is next.

- `@ve/schema` and `@ve/timeline-core`: validated commands and inverse commands; undo/redo UI is planned for M3.
- `apps/engine`: Fastify with token and Origin auth, `/health` probes.
- `apps/client`: React shell with resizable panes.
- `apps/desktop`: Electron shell that launches the engine.
- `apps/vision`: FastAPI stub with `/health` (Python 3.11-3.12, managed by `uv`).

How to run and test: [docs/13-run-and-manual-testing.md](./docs/13-run-and-manual-testing.md). Marketing and sponsor plan: [docs/14-content-and-marketing.md](./docs/14-content-and-marketing.md). Future idea: [auto-captions concept](./docs/15-captions-concept.md).

Known limitations are tracked in [docs/10-future-features.md](./docs/10-future-features.md).

Review workflow, subsystem status and acceptance gates: [Review Plan and System Status](./docs/16-review-plan-and-system-status.md). Project/job ownership and persistence integrity are verified locally; M3 expansion remains gated on UI/error recovery and diagnostics stabilization.

See [docs/README.md](./docs/README.md) for the full documentation index, architecture and milestones.

## Development

Requires Node 22+ and pnpm.

```
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

### Vision service

```powershell
cd apps/vision
uv run pytest          # tests
uv run python -m app.main # serves on 127.0.0.1:7879
```
