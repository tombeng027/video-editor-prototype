# Video Editor Prototype

A CapCut-inspired desktop video editor prototype with a local Ollama AI assistant and CLIP-based jump-cut sequences.

**Stack:** Electron shell, React + Vite client, Node/TypeScript engine (Fastify, FFmpeg), Python vision service (CLIP), shared Zod schema and a pure timeline reducer.

## Status

Milestone 1 (foundation) is complete. M2 is in progress: project create/save/open is done; import with proxies is done; preview, timeline and export are next.

- `@ve/schema` and `@ve/timeline-core`: command reducer with undo.
- `apps/engine`: Fastify with token and Origin auth, `/health` probes.
- `apps/client`: React shell with resizable panes.
- `apps/desktop`: Electron shell that launches the engine.
- `apps/vision`: FastAPI stub with `/health` (Python 3.11-3.12, managed by `uv`).

Known limitations are tracked in [docs/10-future-features.md](./docs/10-future-features.md).

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
