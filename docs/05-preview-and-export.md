# 5. Preview and Export

[Back to index](./README.md)

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

### Known preview limits (accepted for prototype)

- Frame-exact sync across multiple simultaneous video elements is not guaranteed.
- No real-time compositing beyond simple track layering order.
- WebGL/canvas rendering is deferred until preview needs justify it.

## Export

- **Engine-side FFmpeg** builds the output from the project timeline using original media, not proxies.
- **Pipeline:** timeline to a render plan (segments per track, in frames converted to exact timestamps), then to an FFmpeg command or filter graph.
- **Preset (prototype):** H.264 + AAC MP4 at the project resolution and frame rate.
- **Job behaviour:** progress reporting from FFmpeg output, cancellation, and a typed failure reason.
- **Output:** written to the project's `exports/` folder.

## Candidate preview rendering

Candidates (see [Jump-Cut Pipeline](./07-jump-cut-pipeline.md)) store only an edit list.

- **Default:** play the segments back-to-back in the preview player directly from the edit list, using proxy media. No rendered file is needed, which suits short jump-cut sequences.
- **On demand:** the engine can render a low-resolution (about 360p, fast encoder settings, from proxies) preview file from the edit list and cache it in `candidates/`.
- **Starting targets (adjust after measuring in M6):** playback starts in under 3 seconds for a typical 5-second candidate; show progress if it takes longer than about 1 second.

## Hardware acceleration

Not required for the prototype. Encoder choice is a setting to revisit later.
