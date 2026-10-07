# Role & Architecture Target
You are a Senior Software Engineer and AI Automation Engineer building the initial framework for a desktop/web video editing application inspired by CapCut, with an integrated local LLM video-editing assistant.

## Tech Stack Guidelines
- Frontend/UI: Electron + React (or Next.js/Tailwind CSS) for cross-platform desktop UI.
- Canvas / Video Rendering Engine: WebGL or HTML5 Canvas with FFmpeg (via ffmpeg.wasm or local FFmpeg binary wrapper).
- AI Engine: Ollama local API (e.g., Llama 3 / Mistral) with a custom tool-calling schema.
- Computer Vision / Video Analysis Engine: OpenCV (Python/Node) or PyTorch frame-sampling service for visual feature detection.

---

## UI Layout & Core Structure
The app consists of two primary screens:

1. Landing Screen:
   - Minimalist interface with project management list and a primary "Create New Project" button.

2. Main Editing Dashboard (4-Pane Grid Layout):
   - Pane 1: Asset Library Manager
     - Upload, preview, and drag-and-drop media assets (video, audio, images).
     - Store asset metadata (duration, resolution, frame rate, path).
   - Pane 2: Video Canvas Preview
     - Real-time video player synced with the timeline cursor position.
     - Play, pause, scrub, and playback rate controls.
   - Pane 3: Interactive Timeline
     - Multi-track support (video, overlay, audio).
     - Interactive features: drag-and-drop assets, split at playhead, trim start/end, rearrange track blocks.
     - Playhead timekeeper synced bidirectionally with the Video Canvas Preview.
   - Pane 4: AI Assistant Side Panel (Ollama Integration)
     - Interactive conversational UI with streaming chat responses.
     - Conversational mode: General video editing knowledge, tips, and technique QA.
     - Actionable mode: Tool-calling capabilities to execute commands directly on the media assets and timeline.

---

## AI Agent & Automation Workflow

### 1. Intent Classification & Tool Calling Schema
The assistant must parse user input into either a standard response or an actionable UI/Video Pipeline Command JSON payload:

Example Schema:
{
  "intent": "edit_action",
  "action_type": "subcut_sequence",
  "target_asset_id": "asset_123",
  "time_range": {"start": "00:10", "end": "00:20"},
  "description": "attaching keycaps on the mechanical keyboard",
  "clip_duration_sec": 0.5
}

### 2. Video Analysis Pipeline (For Action Queries)
When an action query (e.g., "create a half-second clip sequence of attaching keycaps from 0:10 to 0:20") is triggered:
1. Clip Extractor Module: Slice the source media between `start` and `end` timestamps into candidate frames using FFmpeg.
2. Feature Detection / Vision Classifier: Analyze candidate frames to detect the requested micro-action (using a lightweight vision model or image-embedding similarity check like CLIP).
3. Sequence Generator: 
   - Trim non-matching segments.
   - Extract continuous 0.5-second sub-clips containing the target action.
   - Stitch sub-clips into a candidate sequence.
4. UI Feedback & Preview:
   - Render the generated sequence into the Asset Manager / Preview window as a temporary candidate asset.
   - Provide a "Insert to Timeline" or "Reject" prompt in the AI Chat Panel.

---

## Immediate Development Milestones

1. Milestone 1 (UI Shell): Implement the 4-pane layout with responsive resizing and standard layout wireframes.
2. Milestone 2 (Basic Timeline & Player): Implement HTML5 canvas video sync with a scrubbable timeline track capable of cutting and moving video blocks.
3. Milestone 3 (Ollama Setup): Connect local Ollama API to the AI Side Panel with system prompts formatted for video editing assistant personalities.
4. Milestone 4 (Automation Tool-Calling): Implement JSON parsing on Ollama outputs to translate user text commands into timeline actions (Split, Trim, Add Track).
5. Milestone 5 (Vision AI Integration): Integrate frame extraction and CLIP/OpenCV analysis to handle semantic action isolation (e.g., finding specific actions within timestamp ranges).

Please begin by generating the directory architecture and baseline boilerplate for Milestone 1 and 2.