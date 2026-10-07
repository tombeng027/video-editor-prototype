# 10. Future Features

[Back to index](./README.md)

Not part of the prototype. Listed so the architecture does not block them.

## Known limitations backlog

Found while building M1. None blocks the prototype.

| # | Limitation | Plan |
|---|---|---|
| L1 | ~~Engine cleanup on a force-killed shell~~ | **Resolved in M2 Slice A:** stdin-close watchdog (`ENGINE_EXIT_WHEN_PARENT_GONE`), verified by force-killing the shell on Windows |
| L2 | The desktop shell needs the Vite dev server running; no packaged build | Packaging milestone after M2 |
| L3 | No native file dialogs or drag-and-drop paths | Folder picker done in Slice A; video picker and drag-and-drop come with import in Slice B |
| L4 | Engine falls back to the token `dev-token` if `ENGINE_TOKEN` is unset | Refuse the default outside dev mode |
| L5 | `/health` spawns FFmpeg on every call | Cache the probe result for a short TTL |
| L6 | No React component tests and no tests for the Electron `main.ts` | Add Testing Library tests as UI logic grows |
| L7 | No Host-header validation (DNS-rebinding hardening) | Optional; the token already blocks this |

## Known issues

Small problems seen while running the app. We keep watching for these and fix them when the fix is cheap and does not affect the main flow. Add new ones as they appear.

| # | Issue | Impact | Plan | Status |
|---|---|---|---|---|
| K1 | An engine started from a shell whose PATH predates the FFmpeg install reports FFmpeg as unavailable (found in a stale `pnpm start`). | Dev only; a fresh shell or the Electron app is fine. | Add an FFmpeg path setting (`FFMPEG_PATH` exists) and show a clear "restart your terminal" hint in diagnostics when FFmpeg is missing. | Open |
| K2 | The "Frame rate" select and the "use first video's frame rate" checkbox share a label, so the name is ambiguous for screen readers and test selectors. | Accessibility and testing; no functional effect. | Reword the checkbox label ("Match the first imported video"). | Fixed |
| K3 | The native folder picker was only checked through the bridge, not by clicking it. | Low. | Check manually once; add an IPC test seam if it breaks. | Open |
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
