# 8. UI Design

[Back to index](./README.md)

**Status:** target UX, not a current feature inventory. Current UI has landing/create/open, resizable panes, one-track add/split/delete/scrub/zoom, video preview and export. Native modal input isolation and creation/start pending guards are implemented and verified locally; complete editor accessibility is not certified. Settings, drag/drop, search, frame-step, move/trim gestures, Undo/Redo, mute/lock controls, overlays and AI/caption workflows are planned. Responsive collapse remains planned; see [Review status](./16-review-plan-and-system-status.md).

## Screens

1. **Landing:** recent projects list, Create New Project, Open Project. Shows a missing-project state for moved folders. The create dialog sets name, location, resolution and frame rate (a preset, or "use the first imported video's frame rate").
2. **Editor:** four panes plus a top bar (project name, save status, export).

A planned **Settings** dialog (reachable from both screens) will hold the app-level settings listed in [Testing and Settings](./12-testing-and-settings.md). There is no Settings dialog today.

### Implemented modal policy

- Create and export use a shared native modal dialog: background controls are inert, Tab/Shift+Tab stay inside, and dismissal restores focus to a still-connected opener. Editor shortcuts do not run behind export.
- Idle creation can be cancelled with Cancel or Escape. After submission, fields and Cancel are disabled, duplicate submissions/navigation are refused and a Creating status explains that the request cannot be cancelled. Success enters the committed project with any warnings; a reported failure unlocks retry/Cancel.
- Native folder selection locks conflicting creation/open navigation until it returns. Picker failures show `FOLDER_PICK_FAILED` and allow retry.
- Export cannot close during start preflight or while running. Running export retains its Cancel export action; engine cancellation semantics are unchanged.
- Backdrop clicks do not dismiss these dialogs. General request deadlines, uncertain mutation reconciliation, export polling/cancel recovery and full accessibility/screen-reader acceptance remain separate work.

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

### Future: caption panel
Captions are not part of the main timeline. A separate collapsible panel under it is planned, so the main timeline stays focused on video edits. See [Captions Concept](./15-captions-concept.md).

## Status and diagnostics

A small status area shows engine, FFmpeg, Ollama and vision service readiness with a short fix hint when a component is unavailable.

## Responsive and mobile readiness

- Layout is built from a layout configuration, not hard-coded desktop assumptions, so a stacked layout (preview on top, tabs for Timeline, Assets, Assistant) can be added later.
- Interactions use pointer events, so touch support is possible later.
- Prototype acceptance testing is desktop only.

## Accessibility baseline

Keyboard operability for timeline actions, visible focus, and sufficient contrast.
