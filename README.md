# Video Editor Prototype

A CapCut-inspired desktop video editor prototype with a local Ollama AI assistant and CLIP-based jump-cut sequences.

**Stack:** Electron shell, React + Vite client, Node/TypeScript engine (Fastify, FFmpeg), Python vision service (CLIP), shared Zod schema and a pure timeline reducer.

## Status

Milestone 1 (foundation) is in progress.

- Done: design docs, `@ve/schema`, `@ve/timeline-core` (command reducer with undo, 37 tests).
- Next: engine skeleton, client shell, Electron wrapper, vision stub.

See [docs/README.md](./docs/README.md) for the full documentation index, architecture and milestones.

## Development

Requires Node 22+ and pnpm.

```
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```
