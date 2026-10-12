# 1. Overview and Scope

[Back to index](./README.md)

## Goals

- Provide a usable manual editing workflow: import, arrange, trim, split, preview, save, reopen, export.
- Integrate a local LLM assistant for editing guidance.
- Let the assistant propose a confirmed quick action: the jump-cut sequence.
- Establish a data model and command layer that manual edits and AI actions share.

## Non-goals (prototype)

- Mobile or standalone on-device editing (planned, see [Future Features](./10-future-features.md)).
- Effects, transitions, text, captions, keyframes, speed changes.
- Real-time GPU compositing, collaboration, cloud sync.
- Frame-accurate semantic detection guarantees (the vision output is a ranked suggestion).

## Maintainer purpose and scope gate

Owner decision, 2026-10-12: this is an independently maintained community prototype focused on open-source collaboration, explainable engineering, reproducible testing and honest limitations. Keep the roadmap bounded by maintainer capacity; personal and business planning is separate from public technical documentation.

- **License:** Apache-2.0 for this project's original code/documentation; [license and scope](../README.md#license-and-participation). Other repositories, games, artwork, music, models and third-party software have independent licensing decisions.
- **Participation:** welcome bounded contributions under [contribution guidance](../CONTRIBUTING.md). Sponsorship supports development/maintenance, not automatic ownership, exclusivity or delivery commitments.
- **Decision rule:** new work must explain its value to the approved editing workflow, community or QA/engineering evidence, its maintenance/time cost and its place in the existing milestone gates.
- **Scope hold:** do not add enterprise infrastructure, monetization, paid tiers, extra platforms or a commercial-release program merely because they might be marketable. Significant expansion requires explicit owner approval and a capacity/trade-off discussion.
- **Compatibility:** new dependencies and models must preserve the intended open-source distribution path through the R backlog review; do not assume every component must itself be Apache-2.0 or that this project license overrides other terms.
- **Commercial use versus roadmap:** Apache-2.0 permits compliant commercial use and proprietary forks. The maintainer's bounded roadmap is a planning policy, not an additional license restriction on recipients.

Packaging remains conditional on demonstrated user need and legal/platform acceptance, not an automatic next milestone.

## Prototype scope

This table describes the target through M6, not today's shipped capabilities. M1-M2 are implemented; M3-M6 remain planned. See [Milestones](./09-milestones.md) for current delivery status.

| Area | In scope |
|------|----------|
| Projects | Create, save, open, autosave, missing-media relink |
| Assets | Video/audio import, metadata and proxies are implemented; image import is deferred; temporary AI candidates are planned for M6 |
| Timeline | Multiple tracks, drag/drop, move, trim, split, undo/redo, snapping |
| Preview | Playback synced to the playhead, scrub, rate control |
| Export | Single preset export via FFmpeg with progress and cancel |
| AI | Streaming chat, suggestive answers, confirmed `jump_cut_sequence` action |

## Target platform

- **Now:** PC, Windows first. Windows is locally tested; Linux CI tests core/engine behavior. macOS and Linux desktop compatibility is not certified. The launch scripts are Windows-specific.
- **Later:** mobile as remote editor, then standalone. The client/engine separation and the shared schema keep this possible.

## Glossary

- **Asset:** a media file registered in a project.
- **Clip:** a placement of an asset segment on a track.
- **Command:** a typed, undoable edit to the project.
- **Proxy:** a low-resolution copy of an asset used for preview.
- **Candidate:** a generated, not-yet-accepted result (for example a jump-cut edit list).
- **Edit list:** an ordered list of source ranges that describes a sequence without rendering it.
