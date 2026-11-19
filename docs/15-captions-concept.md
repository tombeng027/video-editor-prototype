# 15. Captions

[Back to index](./README.md)

Status: **foundation, manual workspace and Preview implemented locally; desktop
acceptance pending.** One plain-text, timeline-fixed cue lane, saved-project
migration and undoable commands are available. SRT/burned-in output, styling
controls and speech generation remain planned.

## Idea

Planned speech transcription would create timed caption cues. Captions would have a separate workspace rather than living in the main timeline.

**Principle: separation of concerns.** The main timeline is for video editing (trim, split, move, layer). Captions are a different task (wording, timing, style), so they get their own focused workspace instead of adding more things to the main screen.

## UI

- A **caption panel** docked directly under the main timeline, **collapsed by default**.
  - Collapsed: a thin strip showing the cue count, a density marker for where captions exist, and an Expand button. Nothing else competes with the main timeline.
  - Expanded: the timeline area grows to at least 440px to make room, then the
    panel and media rows share that space; the layout splitter still works.
- **Shared time axis.** The caption lane uses the same playhead, zoom and horizontal scroll as the main timeline, so a cue always lines up with the video above it. Without this the separation would be disorienting.
- Two views inside the panel:
  - **Timeline view:** cues as blocks on one lane; drag to move, drag the edges to retime, split and merge.
  - **Text view:** a chronological list alongside the selected cue's text/timing
    editor. Selecting a cue pauses and seeks to it. Add/Apply commits the draft;
    Cancel draft discards it. Times are exact whole project frames, with
    timecodes in the list. An unsaved form draft must be applied/cancelled before dragging.
- Preview shows the saved current cue as bottom-centered white multiline text
  with a dark shadow, scaled with the project canvas. Markup is literal text.
  Cues may continue beyond media; editor playback includes their duration.
- Styling controls for the whole track (font, size, colour, outline, position)
  are planned, not implemented. Per-cue overrides come later.
- The caption panel is not part of the main-timeline selection. Editing a cue never changes video clips and the reverse.

## How it would work

### Generation (AI quick action)

- Fits the existing quick-action pattern: the assistant proposes "Generate captions", the user confirms, the result is a **reviewable candidate**, and only inserting it changes the project (one undo step).
- Speech-to-text runs as a new module of the local Python service (the same modular idea as the vision service), using an offline model such as `faster-whisper` on CPU, with word-level timestamps and a language setting. Model choice and licence need a check before we commit.
- Input is the audio of the clips on the main timeline (or a selected range). The engine extracts audio with FFmpeg, sends it to the service, and groups words into cues (line length, reading speed, break on pauses).
- Transcripts are cached per asset, like CLIP scores, so re-running after a small edit does not retranscribe everything.

### Current data foundation

Kept out of `project.tracks` so the main timeline code never sees captions.

```ts
type CaptionCue = {
  id: string;
  start: number; // timeline frames
  end: number;   // timeline frames, exclusive
  text: string;
};

// Version-2 projects have captionCues: CaptionCue[] (one lane).
// Version-1 loading migrates to version 2 with an empty lane.
```

Cue text is nonblank, at most 2000 characters, and stored verbatim (no markup
interpretation). Timing uses safe integer project frames. The lane cannot overlap
itself, but adjacent cues are allowed. Manual cues remain fixed in timeline time
through media edits; source-following generated cues and stale warnings come later.
Frame-rate changes/first-import FPS adoption are blocked once cues exist.
Schema v2, explicit v1 migration, unsupported-version guards and exact save/open
round-trips are implemented; see [Versioning](./03-data-model.md#versioning).
The cue array extends editor playback duration and draws subtitles in Preview.
Engine exports still use media-only duration and do not render cues; the expanded
workspace and Export dialog explicitly warn about this limitation.

### Commands (all undoable, same command layer)

Implemented: `AddCaptionCue`, `SetCaptionCue` (atomic text and/or timing changes),
and `RemoveCaptionCue`, with exact inverses and normal engine autosave. One
atomic batch can add several cues; a failed batch saves nothing. These commands
are exposed through the caption workspace. Split batches shorten the
first cue and add the second, retaining the text on both halves. Merge batches
remove the next chronological cue before extending the first across any gap,
joining text with a newline. Each batch is one Undo step. Dragging constrains
whole-frame bounds to adjacent cues; Escape, lost capture, pointer cancellation,
project changes or disabled editing discard the gesture. Track styling, source
anchoring and generated-candidate insertion remain future slices.

### Export

- Burned in with FFmpeg (the `subtitles` filter with an ASS file the engine writes from the cues), as an export option.
- Optional sidecar `.srt` export, which is cheap and useful for platforms that take their own caption files.

## Open design questions

1. **Do generated captions follow video edits?** Manual cues are timeline-fixed
   for the approved foundation. If the user splits, deletes or moves clips after
   generating captions, cues can drift off the speech.
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
- Maintain the schema version check and explicit migration hook (v1 to v2 now implemented).
- Keep the Python service modular so a speech module can sit next to vision.
- Plan the layout so a collapsible panel under the timeline fits (the layout is already configuration driven).

## Owner direction (2026-11-10)

Auto-captions are on the plan, after crop. Recommended phasing, awaiting final owner answers:

- **Phase 1, no AI:** the caption track and manual cues (schema, commands, caption panel, preview overlay, burned-in export and `.srt` import/export, basic styling).
- **Phase 2, auto-generate:** speech to text added as a candidate producer for the same cues. Recommendation: local Whisper (private, offline, no cost) with a model-size choice and progress display; a cloud option could come later as a clearly labelled setting.
- **Questions still open:** local-only for the first version; model download on first use versus bundled; English only versus multilingual first; plain subtitles first versus word-highlight styling.

## Suggested build order (when we get there)

1. Schema, migration and cue commands with tests (no UI): implemented locally.
2. Caption panel: text view and timeline view on the shared axis, manual cues only, with preview overlay: implemented locally; desktop acceptance pending.
3. Export: burned-in and `.srt`, plus `.srt` import.
4. Speech module and the generate-captions quick action as a candidate.
5. Follow-the-edits behaviour and the stale-caption warning.
