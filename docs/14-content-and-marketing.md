# 14. Content and Marketing

[Back to index](./README.md)

A working plan for showing the prototype to the public and to potential sponsors. Keep claims tied to what actually runs. Update the "What we can show" table as milestones land.

## Positioning

**One line:** a CapCut-style video editor that runs on your PC, with a local AI assistant that finds the moments you describe and cuts them together, with no cloud upload.

**Pitch hook:** "Tell it 'find every time I press a keycap on, between 0:30 and 2:00' and get a jump-cut sequence you can accept, tweak or undo."

### Differentiators (all by design, see the linked docs)

- **Local and private:** Ollama and CLIP run on the user's machine; footage is not uploaded ([doc 6](./06-ai-assistant.md), [doc 7](./07-jump-cut-pipeline.md)).
- **AI proposes, you confirm:** every AI edit is a typed command preview that can be undone ([doc 4](./04-commands-and-persistence.md)).
- **Non-destructive and reference-based:** the original files are never modified; projects are small folders.
- **Honest preview:** fast 540p proxies for editing, full-quality export from the originals ([doc 5](./05-preview-and-export.md)).
- **Open architecture:** shared timeline core that can later power mobile and standalone modes ([doc 10](./10-future-features.md)).

### Audiences

| Audience | Why they care | Message |
|---|---|---|
| Hobbyist and maker creators (build, repair, unboxing videos) | Hours spent cutting repetitive actions | "Describe the action; get the montage" |
| Privacy-minded and offline creators | Do not want cloud AI on footage | "Your footage stays on your machine" |
| Developers and AI-tooling people | Interested in local-LLM and CLIP workflows | Architecture write-ups and the open repo |
| Sponsors and grant programs | Want a credible, scoped, demoable project | Roadmap, milestones, working demos |

## What we can show

Only claim what is in the "Ready" column.

| Capability | Status | Demo-ready |
|---|---|---|
| Create, save, reopen projects | Built | Yes |
| Import media, frame rate matching, proxies with progress | Built | Yes |
| Timeline, preview, split | Next (M2 Slice B step 2) | Not yet |
| Export MP4 | Planned (M2 Slice C) | Not yet |
| Multi-track editing, undo, relink | Planned (M3) | Not yet |
| AI jump-cut sequence | Planned (M4-M5) | Not yet |

The headline AI feature is not built. Until M4/M5 present it as the roadmap and the vision, not as a shipped feature.

## Content plan

### Phase 1: build in public (now)

Short posts and one longer write-up per milestone.

| Piece | Format | Source |
|---|---|---|
| "Why I'm building a local AI video editor" | Short post or video (60-90 s) | doc 1 |
| "Frames, not seconds: how the editor keeps time exact" | Technical article | doc 3 |
| "Undo for free: every edit is a command" | Technical article | doc 4 |
| Import and proxy demo | 30-second screen capture | M2 Slice B step 1 |
| "Designing an AI that suggests but never surprises you" | Article | doc 6 |

### Phase 2: first demo (after M2)

- 60-90 s demo: import, cut, split, export, with a before and after.
- Short clip of the same footage opened again from a saved project (proves persistence).

### Phase 3: AI demo (after M5)

- The keycap example end to end: prompt, candidates, preview, accept, export.
- A side-by-side: manual cutting time vs assisted time, **measured honestly** on real footage with the method written down.
- A "how it runs locally" explainer with hardware requirements.

## Asset checklist

Capture these at each milestone and store them in `marketing/` (outside the app source; do not commit large video files, keep them in cloud storage or Git LFS).

- [ ] Screenshots at 1920x1080: landing, editor with media, editor with timeline, export dialog.
- [ ] Screen recordings at 1080p60 with a clean desktop and no personal paths or project names visible.
- [ ] A short logo or wordmark and a color palette (still to design).
- [ ] An architecture diagram from [doc 2](./02-architecture.md), redrawn for a general audience.
- [ ] Demo footage you own the rights to, including any music. Use royalty-free or your own.
- [ ] A 3-slide summary: problem, solution, roadmap.

## Sponsor and funding package

Prepare once the M2 demo exists.

1. **One-page brief:** problem, solution, what is built, what is next, what the funding unlocks.
2. **Roadmap:** the milestone table from [doc 9](./09-milestones.md) with dates you can keep, plus the backlog from [doc 10](./10-future-features.md) grouped as "next", "later" and "platform" (mobile, GPU, packaging).
3. **Demo video** (under 2 minutes) and a link to the repo.
4. **Proof of quality:** CI badge, test count, and the triage table of known issues (shows disciplined engineering).
5. **Costs and asks:** development time, hardware for GPU testing, code-signing certificate for Windows, domain and hosting for a landing page. Fill in real figures before sending.
6. **Sponsorship tiers** (example, adjust): supporter (name in README), backer (logo on site and early builds), partner (roadmap input on a feature).

Possible channels: GitHub Sponsors, Open Collective, grants for open-source or AI tooling programs, creator-tool and hardware vendors (GPU, capture gear), and local tech communities. Check each program's eligibility before applying.

## Channels and cadence

| Channel | Use | Cadence |
|---|---|---|
| GitHub (README, releases, Discussions) | Source of truth, changelog | Each milestone |
| YouTube and short-form video | Demos, devlogs | One devlog per slice, one demo per milestone |
| X, LinkedIn, Reddit (r/VideoEditing, r/LocalLLaMA) | Reach and feedback | Weekly during active builds |
| Dev.to or personal blog | Technical write-ups | One per milestone |

Follow each community's self-promotion rules, and lead with something useful rather than a plain announcement.

## Claims and compliance checklist

- [ ] Say "prototype" until packaging and export are stable.
- [ ] Do not claim AI features before they run end to end on real footage.
- [ ] Do not publish benchmark numbers without the machine specs and method.
- [ ] Credit FFmpeg, Electron, Ollama, CLIP and other dependencies, and check each license (FFmpeg builds differ in LGPL or GPL terms) before distributing binaries.
- [ ] Decide the project license before inviting contributors or sponsors.
- [ ] Check licenses on any model weights you reference (`qwen3:8b`, CLIP) and any music or footage in demos.
- [ ] Remove tokens, local paths and personal data from every screenshot and recording.