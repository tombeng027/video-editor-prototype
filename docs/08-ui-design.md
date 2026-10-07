# 8. UI Design

[Back to index](./README.md)

## Screens

1. **Landing:** recent projects list, Create New Project, Open Project. Shows a missing-project state for moved folders. The create dialog sets name, location, resolution and frame rate (a preset, or "use the first imported video's frame rate").
2. **Editor:** four panes plus a top bar (project name, save status, export).

A **Settings** dialog (reachable from both screens) holds the app-level settings listed in [Testing and Settings](./12-testing-and-settings.md).

## Editor layout (desktop)

```
+---------------------------------------------------------------+
| Top bar: project name | save status | undo/redo | Export       |
+-----------+--------------------------------+------------------+
| Assets    |  Preview                       |  AI Assistant    |
| (left)    |  transport controls            |  (right)         |
|           |                                |                  |
+-----------+--------------------------------+                  |
| Timeline (full width under Assets + Preview)                  |
| ruler | tracks | playhead                                     |
+---------------------------------------------------------------+
```

- The timeline gets the most horizontal space and the largest share of vertical space after the preview's minimum.
- Panes are resizable with splitters. Sizes persist per user.
- The assistant panel is collapsible.
- Minimum window size is defined. Below it, the Assets pane collapses into a tab.

## Panes

### Asset library
- Import via the native file dialog or drag and drop (Electron provides real file paths). Import progress and per-file errors (unsupported or corrupt).
- Import choice: reference the original (default) or copy into the project.
- Search and filter by kind. Candidates from AI actions appear in a separate "Candidates" group with a distinct badge, and are never confused with source files.
- Drag an asset to the timeline.

### Preview
- Play/pause, frame step, scrub, rate control, timecode display.
- Proxy-quality indicator. Decode and loading error states.
- Fit-to-pane scaling.

### Timeline
- Time ruler with zoom, tracks with mute and lock, playhead.
- Operations: drag to add, move, trim from either edge, split at playhead.
- Snapping to playhead and clip edges, toggle-able.
- Selection states, and keyboard shortcuts: Space (play), S (split), Delete, arrow keys (frame step), Ctrl+Z / Ctrl+Y.
- Missing-media states shown on clips.
- Overlay clips get position, scale and opacity controls in the preview; "Split audio" is available on video clips.

### AI assistant
- Streaming chat. Message types: text, action card, candidate result card, error.
- Action card shows parameters, validation result, Confirm and Discard.
- Candidate card shows the preview, segment list with confidence, sensitivity control, Insert and Discard. When no matches are found it shows an empty state with suggestions (widen the range, lower sensitivity, rephrase).
- A toggle for conversational-only mode.
- AI-applied edits are labelled in history and can be undone.

## Status and diagnostics

A small status area shows engine, FFmpeg, Ollama and vision service readiness with a short fix hint when a component is unavailable.

## Responsive and mobile readiness

- Layout is built from a layout configuration, not hard-coded desktop assumptions, so a stacked layout (preview on top, tabs for Timeline, Assets, Assistant) can be added later.
- Interactions use pointer events, so touch support is possible later.
- Prototype acceptance testing is desktop only.

## Accessibility baseline

Keyboard operability for timeline actions, visible focus, and sufficient contrast.
