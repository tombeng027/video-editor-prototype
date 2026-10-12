# Video Editor Prototype

A Windows-first desktop video editor prototype. Local Ollama guidance and CLIP-based jump-cut candidates are planned for M4-M6, not implemented yet.

**Stack:** Electron shell, React + Vite client, Node/TypeScript engine (Fastify, FFmpeg), Python vision service (CLIP), shared Zod schema and a pure timeline reducer.

## Status

Milestone 1 (foundation) is complete. M2 (manual vertical slice) is complete: project create/save/open, import with proxies, timeline and preview with split and delete, and MP4 export with progress and cancel. M3 (timeline usability) is next.

- `@ve/schema` and `@ve/timeline-core`: validated commands and inverse commands; undo/redo UI is planned for M3.
- `apps/engine`: Fastify with token and Origin auth, `/health` probes.
- `apps/client`: React shell with resizable panes.
- `apps/desktop`: Electron shell that launches the engine.
- `apps/vision`: FastAPI stub with `/health` (Python 3.11-3.12, managed by `uv`).

How to run and test: [docs/13-run-and-manual-testing.md](./docs/13-run-and-manual-testing.md). Public participation and demo guidance: [docs/14-content-and-marketing.md](./docs/14-content-and-marketing.md). Future idea: [auto-captions concept](./docs/15-captions-concept.md).

Known limitations are tracked in [docs/10-future-features.md](./docs/10-future-features.md).

Review workflow, subsystem status and acceptance gates: [Review Plan and System Status](./docs/16-review-plan-and-system-status.md). Project/job ownership and persistence integrity are verified locally; M3 expansion remains gated on UI/error recovery and diagnostics stabilization.

Before an approved fix, compare QA evidence and acceptance criteria with the engineering assessment using [QA and Fix Readiness](./docs/17-qa-and-fix-readiness.md).

See [docs/README.md](./docs/README.md) for the full documentation index, architecture and milestones.

## License and participation

Copyright 2026 tombeng027 and contributors.

Original code and documentation in this project are licensed under the [Apache License, Version 2.0](./LICENSE). You may not use the licensed work except in compliance with that license. It is provided on an "AS IS" basis, without warranties or conditions of any kind, subject to the license's terms.

Third-party software, model weights, media and other separately licensed material retain their own terms; this license does not grant rights to them or to unrelated repositories, games or assets. It does not grant general trademark rights. Binary/model distribution still requires the [publication gates](./docs/16-review-plan-and-system-status.md#legal-and-publication-gate-status).

See [contribution guidance](./CONTRIBUTING.md). This is a bounded community project emphasizing reliable engineering and QA, not a commitment to a commercial editor launch. Sponsorship supports the work without automatically purchasing ownership or feature delivery. The [project priorities and scope gate](./docs/01-overview-and-scope.md#maintainer-purpose-and-scope-gate) guide future decisions.

## Development

Requires Node 22+ and pnpm.

```
pnpm install
pnpm --filter @ve/desktop setup:electron
pnpm test
pnpm typecheck
pnpm lint
```

The desktop setup command explicitly installs the Electron binary. Run it on first setup and after Electron upgrades; dependency installation alone does not provision it.

### Vision service

```powershell
cd apps/vision
uv run pytest          # tests
uv run python -m app.main # serves on 127.0.0.1:7879
```
