# 10. Future Features

[Back to index](./README.md)

Not part of the prototype. Listed so the architecture does not block them.

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
