# 15. Captions Concept (future feature)

[Back to index](./README.md)

Status: **idea captured, not scheduled.** We build this once the prototype (M2 to M6) is stable and we are satisfied with it. Nothing in the current code depends on it, but the points under "What to keep in mind now" avoid painting ourselves into a corner.

## Idea

Like CapCut's auto-captions: the AI transcribes the speech and creates timed caption cues. Unlike CapCut, captions do **not** live in the main timeline.

**Principle: separation of concerns.** The main timeline is for video editing (trim, split, move, layer). Captions are a different task (wording, timing, style), so they get their own focused workspace instead of adding more things to the main screen.

## UI

- A **caption panel** docked directly under the main timeline, **collapsed by default**.
  - Collapsed: a thin strip showing the cue count, a density marker for where captions exist, and an Expand button. Nothing else competes with the main timeline.
  - Expanded: the panel grows (the main timeline shrinks, and the layout splitter still works).
- **Shared time axis.** The caption lane uses the same playhead, zoom and horizontal scroll as the main timeline, so a cue always lines up with the video above it. Without this the separation would be disorienting.
- Two views inside the panel:
  - **Timeline view:** cues as blocks on one lane; drag to move, drag the edges to retime, split and merge.
  - **Text view:** a list of cues with the text editable inline, for fixing wording quickly. Selecting a cue moves the playhead to it. Wording errors are the most common fix, and a list is faster than blocks for that.
- Preview shows the current cue on top of the video, styled as it will be exported.
- A style section for the whole track first (font, size, colour, outline, position). Per-cue overrides come later.
- The caption panel is not part of the main-timeline selection. Editing a cue never changes video clips and the reverse.

## How it would work

### Generation (AI quick action)

- Fits the existing quick-action pattern: the assistant proposes "Generate captions", the user confirms, the result is a **reviewable candidate**, and only inserting it changes the project (one undo step).
- Speech-to-text runs as a new module of the local Python service (the same modular idea as the vision service), using an offline model such as `faster-whisper` on CPU, with word-level timestamps and a language setting. Model choice and licence need a check before we commit.
- Input is the audio of the clips on the main timeline (or a selected range). The engine extracts audio with FFmpeg, sends it to the service, and groups words into cues (line length, reading speed, break on pauses).
- Transcripts are cached per asset, like CLIP scores, so re-running after a small edit does not retranscribe everything.

### Data model sketch

Kept out of `project.tracks` so the main timeline code never sees captions.

```ts
type CaptionTrack = {
  id: string;
  language: string;
  style: CaptionStyle;
  cues: Cue[];
};

type Cue = {
  id: string;
  start: number; // timeline frames
  end: number;   // timeline frames, exclusive
  text: string;
};

// Project gets: captionTracks: CaptionTrack[] (default [])
```

This is a schema change, so it needs the version check and migration hook from backlog item K10 first.

### Commands (all undoable, same command layer)

`AddCaptionTrack`, `RemoveCaptionTrack`, `SetCaptionStyle`, `AddCue`, `EditCueText`, `MoveCue`, `TrimCue`, `SplitCue`, `MergeCues`, `RemoveCue`, and one batch command to insert a generated set. Invariants: cues in a track do not overlap, `start < end`, `start >= 0`.

### Export

- Burned in with FFmpeg (the `subtitles` filter with an ASS file the engine writes from the cues), as an export option.
- Optional sidecar `.srt` export, which is cheap and useful for platforms that take their own caption files.

## Open design questions

1. **Do captions follow video edits?** If the user splits, deletes or moves clips after generating captions, cues can drift off the speech.
   - Option A: cues are in timeline time, so they stay where they are and the user fixes them. Simple, but easy to break silently.
   - Option B: cues are anchored to source time (the transcript lives on the asset) and are mapped to the timeline through the clips, so they follow cuts automatically. More work, but matches what users expect.
   - Leaning towards B for generated cues, with the transcript kept per asset. Decide when we design it.
2. **Stale-caption warning** (needed for either option): flag cues whose underlying clip changed.
3. **Styling depth** for the first version: one track style versus per-cue styling, and whether to offer animated or word-highlight captions (popular on short-form video, and word timestamps make it possible later).
4. **Languages and accuracy:** target languages, a model-size versus speed setting, and how to show low-confidence words for review.
5. **Multiple caption tracks** (for example translations): the data model allows it; the UI can start with one.

## What to keep in mind now

- Keep time in integer frames, which the cue model already assumes.
- Keep the shared playhead clock and zoom independent of one specific timeline component, so a second lane can reuse them (the current `PlayheadClock` and `timelineMath` already are).
- Add the schema version check and migration hook (K10) before the first schema change.
- Keep the Python service modular so a speech module can sit next to vision.
- Plan the layout so a collapsible panel under the timeline fits (the layout is already configuration driven).

## Suggested build order (when we get there)

1. Schema, migration and cue commands with tests (no UI).
2. Caption panel: text view and timeline view on the shared axis, manual cues only, with preview overlay.
3. Speech module and the generate-captions quick action as a candidate.
4. Export: burned-in and `.srt`.
5. Follow-the-edits behaviour and the stale-caption warning.
