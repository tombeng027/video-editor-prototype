# 10. Future Features

[Back to index](./README.md)

Not part of the prototype. Listed so the architecture does not block them.

## Known limitations backlog

Found while building M1. None blocks the prototype.

| # | Limitation | Plan |
|---|---|---|
| L1 | ~~Engine cleanup on a force-killed shell~~ | **Resolved in M2 Slice A:** stdin-close watchdog (`ENGINE_EXIT_WHEN_PARENT_GONE`), verified by force-killing the shell on Windows |
| L2 | The desktop shell needs the Vite dev server running; no packaged build | Packaging milestone after M2 |
| L3 | No native file dialogs or drag-and-drop paths | Folder picker (Slice A) and media picker (Slice B) done; drag-and-drop paths still to do |
| L4 | Engine falls back to the token `dev-token` if `ENGINE_TOKEN` is unset | Refuse the default outside dev mode |
| L5 | `/health` spawns FFmpeg on every call | Cache the probe result for a short TTL |
| L6 | No React component tests and no tests for the Electron `main.ts` | Add Testing Library tests as UI logic grows |
| L7 | No Host-header validation (DNS-rebinding hardening) | Optional; the token already blocks this |

## Known issues

Small problems seen while running the app. We keep watching for these and fix them when the fix is cheap and does not affect the main flow. Add new ones as they appear.

| # | Issue | Impact | Plan | Status |
|---|---|---|---|---|
| K1 | An engine started from a shell whose PATH predates the FFmpeg install reports FFmpeg as unavailable. | Dev only; a fresh shell or the Electron app is fine. | Show a "restart your terminal or set `FFMPEG_PATH`" hint in diagnostics when FFmpeg is missing. | Open |
| K2 | The "Frame rate" select and the "use first video's frame rate" checkbox shared a label. | Accessibility and testing. | Reworded the checkbox label. | Fixed |
| K3 | The native folder and media pickers were only checked through the bridge, not by clicking them. | Low. | Check manually once; add an IPC test seam if it breaks. | Open |
| K4 | Real-FFmpeg tests are skipped when FFmpeg is not on PATH, so a stale shell reports green with fewer tests run. | Hidden loss of coverage. | CI installs FFmpeg (confirmed: CI run 4 passed with the install step). Tests now print a skip warning locally and fail in CI if FFmpeg is missing. | Fixed |
| K5 | A stale engine from an earlier session can keep port 7878, so a new engine fails with `EADDRINUSE` while the old one answers requests. | Confusing dev failures; wasted time during the Slice B live test. | Print the port owner hint on `EADDRINUSE`; consider a random free port when launched by Electron (already the case) and a clear message in dev. | Open |
| K6 | The proxy can be one frame shorter than the asset's computed duration (179 vs 180 frames). | The preview could show a frozen or black last frame. | Clamp preview time to the proxy's real duration (build into Slice B step 2). | Open, scheduled |
| K7 | Media is not verified when a project opens, so a moved or deleted source file is only discovered when it is used. | A missing file would break preview and export with an unclear error. | On open, check each asset path and flag missing ones as "offline" in the assets pane; export refuses with a clear list. | Open, scheduled before export |
| K8 | In copy mode the file is copied before the command batch is committed; if the batch fails, an orphan copy stays in `media/`. | Wasted disk only. | Delete the copy if the batch fails. | Open |
| K9 | A proxy that finishes after its asset was removed fails `SetAssetProxy` with `NOT_FOUND` and shows as failed. | Harmless noise. | Treat `NOT_FOUND` as "cancelled". | Open |
| K10 | No project schema migration path yet. | None until the schema changes after projects exist. | Add a version check and migration hook before the first schema change to saved data. | Open, watch |

## Triage

Tiers follow common QA terms. Tier 1 blocks forward work, Tier 2 must be done before the milestone that depends on it, Tier 3 is scheduled cleanup, Tier 4 is fix-if-cheap or accept.

| Tier | Meaning | Items |
|---|---|---|
| Tier 1: Blocker | Stop and fix now | None |
| Tier 2: Major | Fix inside the slice that depends on it | K6 (Slice B step 2, preview), K7 (before Slice C export) |
| Tier 3: Moderate | Schedule soon; no user-visible risk today | K1, K5 (dev experience), K8, L4 (default token), L5 (`/health` cost), K10 (before first schema change) |
| Tier 4: Minor | Fix if cheap, or accept for the prototype | K3, K9, L3 (drag-and-drop), L6 (component tests; revisit once the timeline UI lands), L7 |
| Planned | Already on the roadmap | L2 (packaging, after M2) |
| Resolved | Done | K2, K4, L1 |

Decision: nothing needs to be fixed before Slice B step 2. K6 is built into it, and K7 is done before export.
## Platform
- **Mobile as remote editor:** the client connects to a PC engine over LAN with token auth, using a stacked responsive layout and touch interactions.
- **Standalone on-device editing:** run `timeline-core` on-device with a native media backend; consider a Capacitor or Tauri wrapper. The pure command layer and shared schema are designed for this.
- Cloud sync and project sharing.
- Collaboration.

## Editing
- Text and titles, captions and speech-to-text
- Transitions, effects and filters
- Keyframes, speed changes, reverse
- Audio waveforms, volume, fades, beat sync
- Multiple export presets and hardware encoding
- Proxy management and storage cleanup
- Project templates

## AI
- Additional quick actions: silence removal, auto-captions, highlight reels, filler cut, rhythmic or beat-aligned assembly
- Multi-step edit plans with review
- Natural language timeline commands (split, trim, append)
- Model selection and benchmarking per task
- Stronger action detection (video models, optical flow, pose, or object tracking) beyond frame-level CLIP

## Rendering
- GPU (CUDA) acceleration for the vision service, with VRAM coordination against Ollama
- Full overlay transforms (rotation, crop, blend modes, keyframed position/scale/opacity), building on the prototype's static transform
- Option to switch an asset between reference and copy-into-project modes
- WebGL or GPU preview and compositing
- Real-time effects

## Extensibility
- Plugin system for quick actions
- Packaging and installers (including FFmpeg licensing review before distribution)
