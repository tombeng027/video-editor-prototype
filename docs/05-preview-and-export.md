# 5. Preview and Export

[Back to index](./README.md)

**Status:** the opening Preview/Export sections describe targets; the explicitly implemented sections below describe current behavior. Candidate rendering is planned for M6. Project/job lifecycle and output identity fixes (K16/K22/K25) are verified locally; hosted CI and remaining UI/error recovery work are not implied.

Preview and final rendering are separate systems with different goals: preview is fast and approximate, export is slow and exact.

## Preview

- **Source:** proxy files (for example 540p H.264, constant frame rate, frequent keyframes) generated on import by the engine.
- **Player:** HTML `<video>` elements, one per active clip, served via HTTP range requests.
- **Single playback clock:** the timeline playhead (in frames) is the source of truth. The preview follows it, and scrubbing the timeline or the preview updates the same value. The clock lives outside React state (a ref or a subscribable store updated with `requestAnimationFrame`), and only the playhead, the timecode and the preview subscribe to it. Updating it through normal component state would re-render the whole timeline every frame.
- **Clip transitions during playback:** the next clip's video element is preloaded and seeked ahead of the cut point.
- **Rate control:** 0.5x, 1x, 1.5x, 2x using `playbackRate`.
- **Audio:** audio tracks play through their own elements, synchronised to the clock.
- **Indicators:** UI shows "proxy" quality and a loading state while a proxy is generating.
- **Codec fallback:** the original file is only used as a fallback while the proxy generates if Chromium can decode it (for example H.264). Otherwise the clip shows "preparing preview" until the proxy is ready.

### Proxy format (implemented)

- H.264 (`libx264 -preset veryfast -crf 28`), yuv420p, never upscaled above 540p, constant frame rate equal to the source rate, keyframe every 15 frames, AAC stereo 96 kbps, `+faststart`.
- Generated one at a time in the engine, written to a `.part` file and renamed when finished, with progress parsed from FFmpeg's `-progress` output and pushed to the client as server-sent events.
- The proxy can end up one frame shorter than the asset's computed frame count (rounding at the tail). The preview must clamp to the proxy's real duration.
- Completion metadata is bound to the originating project opening, including same-folder reopen. Reset suppresses stale callbacks/status and waits for the writer to exit before cleanup or resumed rendering.

### Implemented in Slice B step 2

- `PlayheadClock` (`apps/client/src/clock.ts`) holds the playhead as fractional frames, advances with `requestAnimationFrame` and elapsed time, and stops at the end. Only the playhead line, the timecode and the preview subscribe to ticks (direct DOM updates), and React re-renders only on play, pause or rate changes.
- One `<video>` element shows the visible clip (highest-order non-audio track). Normal drift correction uses 0.25 s while playing (half a frame while paused). Source/proxy or timeline-to-source mapping changes force a seek even below that tolerance; returning from a gap/preparing state resets continuity. Contiguous splits retain the same mapping and do not force a seek.
- The source target is clamped to the clip's inclusive range (`sourceIn` through `sourceOut - 1` in project frames), then to the proxy's real duration (K6). Before a discontinuity, gap or visible end, the last visible project frame is held with native playback paused until the next clock segment; this prevents autonomous video playback from decoding a removed range ahead of the cut in the tested fixture. A gap shows "No clip here", and a clip whose proxy is not ready shows "Preparing preview".
- K32 is verified locally with component regressions and decoded-frame browser acceptance using synthetic colour media. This is not frame-exact certification for all media, hardware, playback rates or background/throttled tabs; seek latency and audiovisual transitions remain approximate.
- Timeline: pointer scrubbing, zoom 10-400 px/s, ruler ticks that widen when zoomed out, click to select, auto-scroll while playing.

### Known preview limits (accepted for prototype)

- A cut between different sources (or a gap) stalls briefly while the player seeks; the next clip is not yet preloaded in a second element.
- Audio comes from the video element only. Separate audio tracks do not play yet.

- Frame-exact sync across multiple simultaneous video elements is not guaranteed.
- No real-time compositing beyond simple track layering order.
- WebGL/canvas rendering is deferred until preview needs justify it.

## Export

- **Engine-side FFmpeg** builds the output from the project timeline using original media, not proxies.
- **Pipeline:** timeline to a render plan (segments per track, in frames converted to exact timestamps), then to an FFmpeg command or filter graph.
- **Preset (prototype):** H.264 + AAC MP4 at the project resolution and frame rate.
- **Job behaviour:** progress reporting from FFmpeg output, cancellation, and a typed failure reason.
- **Output:** written to the project's `exports/` folder.

### Implemented in M2 Slice C

- **Render plan:** `buildRenderPlan` (timeline-core) flattens the timeline into clip and gap segments using the same rule as the preview: at each frame the highest-order non-audio track wins. Audio-track clips are not rendered, matching the preview.
- **FFmpeg command:** one `-ss/-t/-i` input per clip segment from the original file, each scaled and padded to the project size (rounded to even numbers), run through `fps` and an exact frame trim, and joined with `concat`. Gaps are black video and silence; assets without audio get silence. Output is libx264 (`-crf 20`, `medium`), AAC 192k stereo, `+faststart`.
- **Safe output:** written to `exports/<name>-<timestamp>-<job-uuid>.mp4.part`, then ffprobe checks the duration (within 2 frames or 0.1 s). A same-volume hard link publishes the final name without replacing an existing file, then the partial name is removed. Filesystems without hard-link support fail explicitly rather than using an overwrite-prone fallback.
- **Cancellation/commit boundary:** reservation begins before asynchronous validation and remains until the writer and cleanup settle. Cancel/reset/project changes are checked after rendering, verification and publication; cancellation during publication rolls back this job's own output. After the final synchronous `done` transition, the export is committed; a later cancel does not delete it. Reset during settlement can temporarily return `EXPORT_BUSY` for a new start.
- **Cleanup:** failed/cancelled/mismatching exports remove their owned output/partial files when possible. Deletion failure reports `EXPORT_CLEANUP_FAILED` with affected paths, not false success; stale-job failures are written to engine stderr rather than replacing another project's status. There is no general orphan-storage sweeper.
- **Engine API:** `POST /project/export` (202) accepts optional `{attemptId}` (UUID), `GET /project/export` (polled by the client), `POST /project/export/cancel`, `GET /project/media-status`. One export at a time. Bodyless/empty-body starts remain compatible; correlated attempts retain the ID through reservation, progress and terminal states until project reset.
- **Client recovery (K18/K19):** one status request at a time per polling lifecycle, scheduled 500 ms after the previous response; obsolete pre-cancel/unmounted responses are ignored. Status/cancel failures show `[CODE]`; failed polling pauses until Retry status check. Status/cancel requests have a 15-second deadline. Cancel acknowledgement may still be `running`: the dialog stays locked and checks status until cleanup settles. A cancellation failure does not claim cancellation completed. The client uses the shared render plan's asset IDs to block only render-used offline media; engine preflight remains authoritative.
- **Export-start recovery (K24 slice):** start has a 15-second deadline covering fetch and body parsing. The client supplies a fresh attempt UUID. Explicit start rejections allow retry/close; transport, malformed response or unexpected server failure keeps the native modal locked with Check export status. Only a non-idle result identifying that attempt resolves uncertainty; prior results, absent IDs and idle do not prove a delayed request cannot still arrive. Matching running adopts normal polling/cancel; matching terminal permits retry/close. Checks never repeat the start mutation. This is correlation, not idempotent POST retry, durable job history or multi-client ownership.
- **Remaining uncertainty:** an unreachable/reset engine or a request that never arrived can leave this conservative modal locked; check again, or reload only after confirming the old engine has stopped. Older engines without attempt IDs cannot reconcile ambiguous starts. Deploy client/schema/engine together. Checks do not guarantee recoverability; show-in-folder and broader create/open/import recovery remain outside this slice.
- **Refusals (422):** `EMPTY_TIMELINE`, `OFFLINE_MEDIA` (names the files), `TOO_MANY_CUTS`, `MISSING_ASSET`.
- **Limits:** no compositing of overlapping tracks yet, and many cuts hit the Windows command-line limit (see L8 in the backlog).

## Candidate preview rendering

Candidates (see [Jump-Cut Pipeline](./07-jump-cut-pipeline.md)) store only an edit list.

- **Default:** play the segments back-to-back in the preview player directly from the edit list, using proxy media. No rendered file is needed, which suits short jump-cut sequences.
- **On demand:** the engine can render a low-resolution (about 360p, fast encoder settings, from proxies) preview file from the edit list and cache it in `candidates/`.
- **Starting targets (adjust after measuring in M6):** playback starts in under 3 seconds for a typical 5-second candidate; show progress if it takes longer than about 1 second.

## Hardware acceleration

Not required for the prototype. Encoder choice is a setting to revisit later.
