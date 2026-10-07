# 7. Jump-Cut Pipeline

[Back to index](./README.md)

## Goal

The user gives a start and end timestamp and a description of an action (for example "attaching a keycap"). The system finds the moments in that range where the action appears and builds a sequence of short clips (for example 0.5 s each).

## Important caveat

CLIP-style similarity ranks frames by how well they match a text description. It does not understand action timing. Results are **candidates with confidence scores**, not guaranteed detections, and the UI must let the user review and adjust them.

## What the vision service is

A small, local background program written in Python that does the image-understanding step. The Node/TypeScript engine cannot run CLIP practically, but Python can. It is a separate service so heavy dependencies (PyTorch, OpenCV, CLIP) stay out of the main app, which keeps development modular.

For the keycap example:

1. The engine asks: "score the frames between 0:10 and 0:20 against 'attaching a keycap'".
2. The service reads frames from the video and runs CLIP on them.
3. CLIP converts each frame and the text into embeddings and compares them. A higher score means the frame more likely shows the action.
4. It returns a score per timestamp. The engine picks the peaks and builds the half-second clips.

It runs only on the user's machine, starts on demand, and nothing leaves the computer.

## Pipeline

```
Request -> Validate -> Sample frames -> Embed -> Score -> Smooth -> Find peaks
        -> Build windows -> Edit list (candidate) -> Review -> Insert
```

1. **Validate:** engine checks asset, range and clip duration (see [AI Assistant](./06-ai-assistant.md)).
2. **Sample frames:** extract frames in the range at about 8 to 12 fps using FFmpeg or OpenCV, downscaled for the model.
3. **Embed:** the vision service computes CLIP image embeddings in batches.
4. **Score:** cosine similarity against the target text embedding, minus the similarity to a contrast baseline. The baseline is the optional `negativePrompt` from the action (for example "an idle keyboard with no hands"), or a generic baseline when none is given. Nothing about the baseline is hardcoded to a particular action.
5. **Smooth:** moving average over the score series to reduce single-frame noise.
6. **Find peaks:** local maxima above a threshold, with a minimum separation of at least `clipDuration` so windows cannot overlap.
7. **Build windows:** for each peak, create a window of `clipDuration` centered on it, clamped to the range. Resolve any remaining overlaps by keeping the higher-scoring window. Sort chronologically.
8. **Edit list:** output ordered source segments in project frames with confidence per segment. If no peak passes the threshold, the result is an empty state ("no matches found") with a suggestion to widen the range, lower sensitivity or rephrase the action.

## Output

A **candidate** (see [Data Model](./03-data-model.md)) containing an `EditList`. No file is rendered up front, and candidates are not part of `project.assets`.

## Review experience

- The candidate appears in the Asset Library under a "Candidates" group (temporary, clearly badged) and as a card in the chat.
- The user can preview it. By default the preview plays the segments back-to-back from proxies; a rendered preview is optional (see [Preview and Export](./05-preview-and-export.md)).
- Per-segment controls: remove a segment, nudge its position, or play it alone.
- A sensitivity control re-runs peak selection using cached scores, so no re-embedding is needed.
- Actions: **Insert to Timeline**, **Discard**.

## Insertion

Insert creates clips via the `InsertSequence` command as a single undo step, pointing at the real source asset. Placement and audio rules are in [Commands and Persistence](./04-commands-and-persistence.md). The source asset is never modified.

## Vision service API (sketch)

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Readiness and model loaded status |
| `POST /analyze` | Input: video path, frame range, target text, sampling fps. Output: per-frame timestamps and scores |
| `POST /jobs/{id}/cancel` | Cancel a running analysis |

Peak finding and window building live in the engine (TypeScript) or the vision service. The recommended split is **scores in Python, window logic in the engine**, so sensitivity tweaks do not require Python round trips.

## Performance and operations

- **Runtime:** CPU is the supported baseline so the prototype runs on any PC. At about 10 fps, a 10-second range is roughly 100 frames; on CPU this is expected to take on the order of 5 to 30 seconds (an unbenchmarked estimate, to be measured in M6). Progress and cancellation are therefore required.
- GPU (CUDA) support is a future upgrade. The device selection is kept in one place in the service so it can be added later without changing the API.
- CLIP model downloads and loads on first use, and the UI shows a one-time setup state.
- Analysis is a cancellable job with progress.
- Scores are cached per (asset hash, range, prompt, negative prompt, model version, sampling fps) so adjustments are instant.

## Evaluation

Build a small labelled set of clips (keycap sample plus a few other actions) and track whether the produced segments contain the action. This tunes sampling rate, smoothing and thresholds.
