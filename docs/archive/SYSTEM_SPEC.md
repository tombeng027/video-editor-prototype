```markdown
# Role & Architecture Target
You are a Senior Software Engineer and AI Automation Engineer building the initial framework for a desktop/web video editing application inspired by CapCut, featuring an integrated local LLM video editing assistant capable of automated rhythmic and semantic video editing workflows.

## Tech Stack Guidelines
- Frontend/UI: Electron + React (or Next.js/Tailwind CSS) for cross-platform desktop UI.
- Canvas / Video Rendering Engine: WebGL or HTML5 Canvas with FFmpeg (via ffmpeg.wasm or local FFmpeg binary wrapper).
- AI Engine: Ollama local API (e.g., Llama 3 / Mistral) with custom structured tool-calling capabilities.
- Computer Vision / Video Analysis Engine: OpenCV & PyTorch (OpenAI CLIP / ViT embeddings) standalone microservice for zero-shot action and object detection.

---

## UI Layout & Core Structure
The app consists of two primary screens:

1. Landing Screen:
   - Minimalist interface featuring a project management list and a primary "Create New Project" button.

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
     - Conversational Mode: General video editing knowledge, tips, technique explanations, and creative feedback.
     - Automation Mode: Tool-calling capabilities that execute direct timeline modifications and automated video processing pipelines.

---

## AI Agent Capabilities & Specialized Editing Workflows

### 1. Intent Classification & Tool Calling Schema
The assistant parses user prompts into either a conversational response or a structured execution JSON payload:

```json
{
  "intent": "edit_action",
  "technique": "jump_cut_assembly",
  "target_asset_id": "asset_123",
  "time_range": {"start": "00:10", "end": "00:20"},
  "target_action": "attaching keycaps on mechanical keyboard",
  "clip_duration_sec": 0.5,
  "options": {
    "sync_to_audio_beat": false,
    "lock_off_detection": true
  }
}

```

### 2. Specialized Workflow: Rhythmic Jump-Cut Assembly / Speed-Build Engine

When requested to perform a jump-cut assembly (e.g., *"Create a half-second clip sequence of attaching keycaps from 0:10 to 0:20"*):

1. Clip Slicing & Frame Extraction:
* Slice source media between `start` and `end` timestamps using FFmpeg.
* Sample candidate frames at $N$ FPS using OpenCV.


2. Semantic Action & Impact-Frame Detection:
* Pass candidate frames to the vision model (CLIP/ViT).
* Compute cosine similarity between image embeddings and the target action prompt (e.g., *"attaching keycaps on mechanical keyboard"*).
* Apply a moving-average filter to smooth frame probabilities and identify key impact moments (e.g., the precise point where the keycap seats onto the switch).


3. Sub-Clip Assembly & Trimming:
* Eliminate repetitive setups, idle footage, and unnecessary movements.
* Extract continuous fixed-duration sub-clips (e.g., 0.25s–0.5s) centered around the detected action/impact frame.
* Concatenate sub-clips in chronological order to form a high-tempo speed-build sequence.


4. UI Delivery & User Preview:
* Output the generated jump-cut assembly as a dynamic candidate asset in the Asset Library Manager.
* Display a preview option in the AI Assistant Side Panel with interactive "Insert to Timeline" and "Discard" actions.



---

## Immediate Development Milestones

1. Milestone 1 (UI Shell): Implement the 4-pane responsive desktop grid layout with wireframes.
2. Milestone 2 (Timeline & Canvas Sync): Build HTML5 Canvas / WebGL player synced bidirectionally with a multi-track interactive timeline.
3. Milestone 3 (Ollama Conversational Agent): Connect local Ollama API to the AI Side Panel with system prompts tailored for video editing domain knowledge.
4. Milestone 4 (Tool-Calling Engine): Implement strict JSON parsing on Ollama outputs to execute UI/Timeline operations (Split, Trim, Append, Insert Sequence).
5. Milestone 5 (Vision AI & Jump-Cut Assembly Pipeline): Integrate the Python Vision AI service (OpenCV + CLIP) to power automated action isolation and rhythmic jump-cut generation.

Please begin by generating the project directory architecture and baseline boilerplate for Milestone 1 and 2.

```

---

<ElicitationsGroup message="Where would you like to take this next?">
  <Elicitation label="Design the JSON schema for Ollama tool calling" query="Provide a complete JSON schema and system prompt for Ollama to convert user text commands into video editing actions."/>
  <Elicitation label="Set up the Electron/React project boilerplate" query="Provide the project setup and boilerplate code for the 4-pane Electron + React video editing dashboard."/>
</ElicitationsGroup>

```