# Video Editor Prototype - Documentation Index

Status: **Draft v0.1** (prototype scope). This file is the entry point that links all documentation.

Current implementation: M1-M2 capabilities and Windows launcher stabilization; M3-M6 remain planned. The product summary and key decisions below include target behavior, not a claim that AI, settings or every UI feature exists. For current evidence and review gates, start with [Review Plan and System Status](./16-review-plan-and-system-status.md).

## Product summary

A Windows-first video editor with a planned local LLM assistant (Ollama). The assistant is conversational and suggestive by default, and can run a small set of confirmed "quick actions". The first quick action is the **jump-cut sequence**: given a time range and an action description, find the matching half-second moments and assemble them into a candidate sequence.

The prototype targets **PC first**. Mobile and standalone on-device editing are future upgrades, and the architecture avoids decisions that would block them.

## Documents

| # | Document | Purpose |
|---|----------|---------|
| 1 | [Overview and Scope](./01-overview-and-scope.md) | Goals, non-goals, prototype scope, glossary |
| 2 | [Architecture](./02-architecture.md) | Components, stack, repo layout, communication |
| 3 | [Data Model](./03-data-model.md) | Project/timeline schema and time rules |
| 4 | [Commands, Undo and Persistence](./04-commands-and-persistence.md) | Command layer, undo/redo, save/open, relinking |
| 5 | [Preview and Export](./05-preview-and-export.md) | Playback clock, proxies, FFmpeg export |
| 6 | [AI Assistant](./06-ai-assistant.md) | Modes, action schema, validation, Ollama integration |
| 7 | [Jump-Cut Pipeline](./07-jump-cut-pipeline.md) | Vision-based candidate generation |
| 8 | [UI Design](./08-ui-design.md) | Layout, panes, states, interactions |
| 9 | [Milestones](./09-milestones.md) | Delivery plan and acceptance criteria |
| 10 | [Future Features](./10-future-features.md) | Backlog, including mobile and standalone editing |
| 11 | [Risks and Decisions](./11-risks-and-open-questions.md) | Known risks and the decisions made so far |
| 12 | [Testing and Settings](./12-testing-and-settings.md) | Test strategy, app settings, logging |
| 13 | [Running and Manual Testing](./13-run-and-manual-testing.md) | Launch steps, test media, manual test checklist |
| 14 | [Public Participation and Demo Guidance](./14-content-and-marketing.md) | Public purpose, participation, verified demo limits and disclosure checklist |
| 15 | [Captions Concept](./15-captions-concept.md) | Future feature: auto-captions with a separate caption timeline (design note, not scheduled) |
| 16 | [Review Plan and System Status](./16-review-plan-and-system-status.md) | Subsystem matrix, specialist review perspectives, evidence, findings and acceptance gates |
| 17 | [QA and Fix Readiness](./17-qa-and-fix-readiness.md) | QA issue assessment, engineering pre-fix review, reconciliation and post-fix acceptance |

## Key decisions at a glance

- **Desktop shell:** Electron (thin wrapper) hosting the React client and launching the engine in development. Native dialogs and engine lifecycle exist; packaging/bundling and path drag-and-drop are planned.
- **Client:** React + TypeScript + Vite, responsive-ready, so Tauri/Capacitor wrappers remain possible later.
- **Media handling:** imported media is referenced by path by default, with an optional per-import "copy into project" setting.
- **AI model:** `qwen3:8b` via Ollama (thinking mode off), fallback `llama3.1:8b`; configurable.
- **Engine:** Node/TypeScript (Fastify) service owning files, FFmpeg, export and the Ollama proxy.
- **Vision:** Python (FastAPI) service with OpenCV and CLIP, called only by the engine.
- **Time:** integer frames with a rational frame rate, never floating-point seconds.
- **Edits:** every change is a typed command; AI proposes, the user confirms. The client sends each command batch to the engine, which applies it with the shared reducer and returns the new project.
- **Preview vs export:** proxy-based HTML video preview; FFmpeg for final export.

## Source material

- [archive/INITIAL_PROMPT.md](./archive/INITIAL_PROMPT.md) - historical original prompt, not current requirements
- [archive/SYSTEM_SPEC.md](./archive/SYSTEM_SPEC.md) - historical original system spec; maintained docs supersede its milestone/feature claims
