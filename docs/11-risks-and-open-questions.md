# 11. Risks and Decisions

[Back to index](./README.md)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| CLIP is weak at fine-grained action timing | Jump-cut results miss or mislocate actions | Treat results as candidates, show confidence, allow editing, tune with labelled clips, plan stronger models later |
| Multi-video-element preview drifts out of sync | Choppy or misaligned playback | Single clock, preloading, proxies with frequent keyframes; accept limits in prototype |
| Variable frame rate or odd codecs | Wrong cuts, seek errors | Proxies normalised to constant frame rate; export uses originals with exact timestamps |
| Local LLM produces malformed output | Broken action proposals | Strict schema validation, retry once, plain-text fallback, evaluation set |
| Heavy dependencies (PyTorch, CLIP, FFmpeg) | Hard setup | Component diagnostics, setup guide, on-demand vision service |
| Scope growth | Prototype stalls | Backlog list, milestone gates |
| Floating-point time | Cumulative drift | Integer frames and rational fps everywhere |

## Decisions made

- **Client delivery:** thin Electron desktop wrapper (see [Architecture](./02-architecture.md)).
- **Media references:** reference by path by default, optional copy into the project (see [Commands and Persistence](./04-commands-and-persistence.md)).
- **Ollama model:** `qwen3:8b` with `llama3.1:8b` fallback (see [AI Assistant](./06-ai-assistant.md)).
- **Vision service:** separate local Python service (see [Jump-Cut Pipeline](./07-jump-cut-pipeline.md)).
- **Frame rate:** set at project creation, with an option to use the first imported video's frame rate (see [Data Model](./03-data-model.md)).
- **Overlay track:** layer order plus static position, scale and opacity per clip; full transforms are a future upgrade (see [Data Model](./03-data-model.md), [Future Features](./10-future-features.md)).
- **Clip audio:** stays linked to its video clip, with an option to split it onto a separate audio track (see [Data Model](./03-data-model.md)).
- **Candidate preview latency:** starting targets, adjustable after measuring in M6 (see [Preview and Export](./05-preview-and-export.md)).
- **Vision runtime:** CPU baseline; GPU support is a future upgrade (see [Jump-Cut Pipeline](./07-jump-cut-pipeline.md)).
- **Tooling:** pnpm workspaces for JavaScript, uv with a venv for Python (see [Architecture](./02-architecture.md)).

## Open questions

None at this time. Revisit after M2 (real import and export behaviour) and M6 (vision and preview measurements).
