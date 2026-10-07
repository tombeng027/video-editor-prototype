# 13. Running and Manual Testing

[Back to index](./README.md)

How to launch the prototype on a Windows PC and walk through the manual test checklist. Update the checklist as each slice lands.

## Prerequisites

| Tool | Needed for | Check |
|---|---|---|
| Node 22+ (24 tested) and pnpm | Everything | `node -v`, `pnpm -v` |
| FFmpeg and ffprobe on PATH | Import, proxies, export | `ffmpeg -version`, `ffprobe -version` |
| Python 3.11-3.12 and `uv` | Vision service (stub for now) | `python -m uv --version` |
| Ollama with `qwen3:8b` | AI assistant (from M5; not used yet) | `ollama list` |

Install FFmpeg with `winget install Gyan.FFmpeg`, then **open a new terminal**. A terminal opened before the install will not see it (known issue K1).

First time only:

```powershell
pnpm install
```

## Launch options

### A. Desktop app (Electron), the main way

Electron starts the engine for you and stops it when the window closes.

```powershell
# terminal 1: client dev server (must run first)
pnpm dev:client

# terminal 2: desktop shell
pnpm dev:desktop
```

The shell loads `http://127.0.0.1:5173`. Set `VE_CLIENT_URL` to use another address.

### B. Browser only

Useful for quick UI checks and the browser tests. There is no native file dialog, so the Assets pane shows a text box for a full file path.

```powershell
# terminal 1: engine
pnpm dev:engine

# terminal 2: client
pnpm dev:client
```

Open `http://127.0.0.1:5173`. The engine uses the dev token `dev-token` on port 7878 unless you set `ENGINE_TOKEN` and `ENGINE_PORT`.

### Vision service (optional until M4)

```powershell
cd apps\vision
python -m uv run python -m app.main   # serves on 127.0.0.1:7879
```

The engine reports it in the diagnostics. The editor works without it.

## Before you start: clean-state checklist

Stale processes cause confusing failures (K5).

```powershell
Get-NetTCPConnection -LocalPort 7878,5173 -State Listen -ErrorAction SilentlyContinue
```

If something is listening that you did not just start, find its owner with `Get-CimInstance Win32_Process -Filter "ProcessId=<pid>"` and stop it with `Stop-Process -Id <pid>`.

## Automated checks

```powershell
pnpm test        # unit and real-FFmpeg tests; prints a warning if FFmpeg is missing
pnpm typecheck
pnpm lint
cd apps\vision; python -m uv run pytest
```

Expect 96 passing JS tests at the time of writing. If the count is lower, check the skip warning.

## Test media

Keep a small kit of clips in a folder outside the repo:

- A short clip (5-10 s), 1280x720, 29.97 fps (the Slice B demo clip).
- A 1080p clip at 25 or 30 fps, 20-30 s.
- A clip with no audio, and an audio-only file.
- A still image (should be rejected) and a text file renamed `.mp4` (should fail cleanly).

Generate a synthetic clip with FFmpeg if needed:

```powershell
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30000/1001 -f lavfi -i sine=frequency=440 -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac demo.mp4
```

## Manual test checklist

Mark each as Pass, Fail or N/A with the date and build (`git rev-parse --short HEAD`). Log failures as Known issues in [doc 10](./10-future-features.md).

### M1: shell
- [ ] The app opens and the four-pane layout resizes by dragging.
- [ ] Diagnostics show the engine, FFmpeg and vision as `ok` (vision may be down).
- [ ] Closing the window stops the engine (check port 7878 is free afterward).

### M2 Slice A: projects
- [ ] Create a project: name, parent folder (native picker), frame rate, resolution. A subfolder named after the project appears with `project.json`.
- [ ] The project appears in recent projects. Close and reopen it from there.
- [ ] Open a project by choosing its folder.
- [ ] Damage `project.json` (keep the backup): the app recovers from the backup with a message.
- [ ] Force-kill Electron from Task Manager: the engine process also exits.

### M2 Slice B step 1: import
- [ ] Import the demo clip by reference. It appears with resolution, fps and duration.
- [ ] The badge goes "Preparing preview n%" then "Preview ready".
- [ ] "Match the first imported video" sets the project fps to the clip's fps.
- [ ] Importing the same file again is rejected as already imported.
- [ ] The image and the fake `.mp4` show a per-file error without blocking other files in the batch.
- [ ] With "Copy files into the project" on, the file appears under `media/`.
- [ ] Delete a proxy in `proxies/`, close, reopen: it regenerates.

### M2 Slice B step 2: timeline and preview
- [ ] "Add to timeline" places the clip at the start; adding again appends it after the last clip.
- [ ] Click or drag in the ruler or lane to scrub; the preview and timecode follow.
- [ ] Play and pause (button and Space); Speed 0.5x, 1x, 1.5x and 2x change the pace.
- [ ] Split (button or S) at the playhead; the two halves play back-to-back with no visible gap.
- [ ] Select a clip and Delete it; playing across the gap shows "No clip here", then resumes with the next clip.
- [ ] At the end of the timeline playback stops and holds the last frame (K6).
- [ ] Zoom in and out keeps the playhead and clips aligned.
- [ ] Close and reopen the project: the clips are still there.

### M2 Slice C: export (when built)
- [ ] Save, close, reopen: the timeline is identical.
- [ ] Export an MP4 with progress; cancel works; the duration matches the timeline.
- [ ] A missing source file blocks export with a clear list (K7).

## Recording a bug

Include: build hash, launch option (A or B), steps, expected and actual result, and the engine log. Engine logs print to the terminal in browser mode; in Electron start it from a terminal to see them.