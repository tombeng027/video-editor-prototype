# 5. Preview and Export

[Back to index](./README.md)

## Manual captions (Preview-only)

Saved cues are drawn above the picture as bottom-centered white multiline text
with a dark shadow, scaled with the project canvas independently of clip
transform/crop/effects. Text is plain (no markup interpretation); a cue is active
at `start <= frame < end`. Editor playback duration includes caption ends,
including caption-only projects and cues after media. The shared clock drives
caption text/playhead updates without rerendering the editor each frame.

This slice deliberately leaves engine exports unchanged: output still ends at
the last media clip and contains no subtitles. The expanded caption workspace
and Export dialog warn about this difference. Styling controls, SRT import/export
and burned-in output are future work; do not promise Preview/export subtitle
parity yet. See [Captions](./15-captions-concept.md).

## Project canvas aspect controls

**Fit to canvas:** the button below Preview and the picture's right-click action
center the selected visible clip's original source and reset its base scale to 1. The
existing `SetClipTransform` command preserves opacity; crop, zoom, animations,
timing and audio remain unchanged. Pictures retain proportions and may letterbox;
this is not a fill/stretch action. Active effects may still move or enlarge the
picture beyond its fitted base bounds. Playback pauses; normal autosave/history
apply. No selection at the playhead, unavailable media, locked tracks and
pending/closing edits and active Crop mode disable the action. An asymmetric crop
remains offset inside the centered original footprint. This does not reset other clips.

The selector above Preview offers 16:9, 9:16, 1:1 and 4:3. It changes saved project
canvas dimensions and export shape, not just the preview display. Presets retain
the current long edge where possible, rounding down to even exact-ratio dimensions;
the resulting width and height are shown beside the selector. Existing clip
timing, transforms and effects remain unchanged; pictures refit to the new frame.
Changing aspect pauses playback and uses normal autosave and Undo/Redo.
Custom sizes display Custom, and Undo restores the original dimensions exactly.
Pending/unconfirmed edits, closing and active canvas drags disable the selector.
Export's resolution settings continue to scale the project shape proportionally.
Crop's Aspect-locked mode uses this project ratio on each crop edit. Saved crop
rendering and controls are described below.

## Saved crop rendering (2026-11-10, local)

Saved visual-clip crops trim edges in place in Preview and export. The original
source is fitted inside the canvas; crop does not change that scale or center.
Positioning, scaling, opacity, entrance/exit animations and zoom remain anchored
to the original source, not the retained crop center. Each inset is source-relative.
Known source dimensions produce whole-pixel offsets with `floor(size * inset)`
and retained dimensions with `max(1, floor(size * (1 - leading - trailing)))`.
The shared `cropWindow` exposes that window as source fractions; optimized preview
media uses the same fractions of the original picture, not proxy-pixel rounding.
FFmpeg converts to RGBA, splits a transparent original-sized footprint and an
exact-pixel cropped region, then overlays that region at its source offsets
before the existing fit/pad chain. This preserves odd pixel offsets, original
placement and source scale without stretching the crop. Output dimensions remain the
project/export dimensions, not the cropped source size.

Preview clips the original-sized/offset media inside the trimmed window and applies
motion/opacity to its full-frame parent, keeping transform centers in project
coordinates. `clipCanvasRect` and resize snapping use the cropped aspect ratio, so
selection and hit-testing exclude the discarded source area. The paused selection
outline now follows the displayed zoom/animation at the paused playhead. Canvas
gestures convert that geometry back to saved appearance so animation is not baked
into the transform or applied twice. Fully offscreen slide endpoints disable
handles and explain that the playhead must move inside the slide before editing.
Crop does not alter source timing, speed or sound; no new media files/proxies are
created. Adding, changing or clearing crop keeps the same mounted media element
and source URL. Absent crop keeps existing fit/transform behavior and skips the
export crop filter.

Focused real-FFmpeg checks cover image/video sources, asymmetric odd-pixel crops,
landscape/portrait canvases, zoom, fade and exported edges against shared geometry.
Crop controls are implemented locally; desktop acceptance remains pending.

### Crop editing

The Crop toggle below Preview and the right-click Crop section share one editing
mode. Crop mode replaces move/resize gestures with four edge and four corner
handles. Constraint choices are greyed out until Crop is active; the right-click
menu shows a radio indicator for the current choice, and Properties displays the
shared constraint and Crop on/off status. Free-form edits source-relative insets independently. Project aspect
locked uses the source's pixel dimensions and current project ratio, adjusting
the other dimension around its source center on the next edit; selecting the
constraint alone does not modify the clip. Corner gestures use the dominant
axis in locked mode. Crop gestures do not snap, so snapping cannot break the ratio.
The original source mapping is captured at pointer-down; subsequent trimmed
bounds do not feed back into the gesture calculation. Insets remain within schema limits.
Entering Crop cancels any in-progress move/resize and clears its draft; crop
gestures cannot commit transform changes. Appearance and Fit are disabled until
Crop is exited. Right-click menus are body portals above the editor, positioned
and measured against the viewport rather than clipped by the canvas or pane.
Oversized menus scroll; Escape, outside click, viewport resize or outside scroll
dismiss them.

Properties > Crop offers four percentage fields, Apply crop, Reset crop and
Cancel crop draft. Numeric edits preview without changing saved history/export;
Apply commits one `SetClipCrop`. Canvas gestures preview the same draft, mirror
it in Properties, and commit once on release. Click/no-op gestures do not commit.
Escape, pointer cancellation/lost capture, changing selection or a newly blocked
edit discard the gesture. Reset removes crop only, preserving appearance/effects.
Edits pause playback. Commands use normal confirmation, autosave and Undo/Redo.
Locked tracks, offline sources and pending/closing states block crop controls.
Missing dimensions and source/project ratios impossible within inset limits
disable ratio-locked handles with guidance. Pixel rounding may introduce a
small difference from the continuous locked ratio.

The in-place behavior replaces the initial local crop implementation's automatic
refitting (owner-approved correction). Existing crop fractions are retained
without a schema migration; saved crops from that earlier local build now render
in place rather than enlarged/recentered.

**Status:** the opening Preview/Export sections describe targets; the explicitly implemented sections below describe current behavior. Candidate rendering is planned for M6. Project/job lifecycle and output identity fixes (K16/K22/K25) are verified locally; hosted CI and remaining UI/error recovery work are not implied.

Preview and final rendering are separate systems with different goals: preview is fast and approximate, export is slow and exact.

## Preview

- **Source (current):** original video immediately when no completed proxy exists; an existing completed 540p H.264 proxy is preferred. Import, reopen and relink do not automatically start full-video conversion.
- **Player:** HTML `<video>` elements for visual clips and clock-synchronized `<audio>` elements for active audio-track clips. Video proxies and audio/image sources are served by the engine.
- **Single playback clock:** the timeline playhead (in frames) is the source of truth. The preview follows it, and scrubbing the timeline or the preview updates the same value. The clock lives outside React state (a ref or a subscribable store updated with `requestAnimationFrame`), and only the playhead, the timecode and the preview subscribe to it. Updating it through normal component state would re-render the whole timeline every frame.
- **Clip transitions during playback:** the next clip's video element is preloaded and seeked ahead of the cut point.
- **Rate control:** the transport's 0.5x, 1x, 1.5x, 2x is preview-only. Saved per-clip speed 0.25x..4x is edited in Properties and affects timeline duration and export. Media `playbackRate` is transport rate multiplied by clip speed, with browser pitch preservation enabled.
- **Frame stepping (implemented 2026-11-09):** Previous frame / Next frame beside Play and unmodified Left / Right arrows pause playback and seek to the adjacent whole project frame (`floor(position) +/- 1`), clamped to 0..duration-1. From the exclusive timeline end, either direction lands on the last included frame. Empty timelines disable both buttons. Steps do not change saved edits, Undo history, transport rate or clip speed; rational project rates use the same integer frame grid. Text fields, sliders, dropdowns, editable content, handled splitter keys and open Help/Export dialogs retain their keyboard behavior. Browser decoding remains asynchronous; this is exact playhead positioning, not sample-accurate playback certification.
- **Audio:** audio-track clips play through their own elements and seek from the shared clock. Browser playback drift correction is approximate, not sample-accurate.
- **Approved demo behavior:** overlapping visual tracks are composited in track order, higher tracks in front. Audio clips retain source duration unless extended on the timeline; extended clips loop their source. Audio tracks are independently muteable.
- **Indicators:** UI identifies Editing original or Optimized preview separately from optional optimization progress.
- **Codec fallback:** browser load/decode failures offer Retry preview and explicit Prepare optimized preview. The full-file proxy must finish before unsupported originals become playable; demand-driven fallback is still planned.

### Saved per-clip speed

- Video and independent audio clips support forward 0.25x..4x speed. Static images remain at 1x. Source seek mapping, clip widths, duration, snapping, trim drags, split cuts and render-plan segment offsets account for speed.
- Preview preserves pitch through the browser media API. Export uses original-source timestamps divided by clip speed and chained FFmpeg `atempo` filters (each within 0.5..2) for pitch-preserved visual-bed and independent-track audio. Source reads stay within the chosen source range; subframe duration rounding pads the tail instead of leaking excluded source frames.
- Changing speed requires no new proxy or full-file preparation. Existing optimized previews use the same source-time mapping. Transport speed is never exported.
- Focused local checks include speed/ripple Undo/Redo, persistence/reopen, source mapping, UI confirmation/locks, and real synthetic FFmpeg frame count/color/audio-frequency checks at 0.25x, 0.5x, 1.33x, 2x and 4x. Browser audio quality and representative long-video manual acceptance remain separate; this is not sample-accurate or broad codec certification.

### Entrance/exit animation catalog

**Implemented locally, desktop acceptance pending (2026-11-05).** The shared
[animation catalog](../packages/schema/src/animations.ts) supplies Properties
choices and Help's Animation catalog tab, stable IDs, version 1 behavior and
descriptions. Five presets per phase plus separate None:
Fade in/out, Zoom in/out, Slide from/to left, Slide from/to right and Rise from
below/Drop downward. A custom editor and neighboring crossfades remain deferred.

Contract:

- Each end stores a preset ID, version 1 and a length. New edits save
  `durationPercent` (greater than 0, at most 100) of the clip's timeline length;
  entrance plus exit may total at most 100%. Projects saved earlier with
  `durationFrames` (at least two whole frames) remain valid and keep their fixed
  length; applying them again saves a percentage.
- Resolution to frames: entrance = round(L × p / 100); exit = round(L × p / 100),
  reduced if needed so the two windows never exceed L. An effect that resolves to
  fewer than two frames is not shown (Properties flags this). The default is the
  catalog's 0.5 seconds expressed as a percentage, clamped to 1%..50%.
- Smoothstep easing is `p*p*(3-2*p)`, clamped to 0..1. For a D-frame entrance,
  frames 0 through D-1 cover away-to-normal endpoints. Exit spans L-D through L-1
  in an L-frame clip. Non-overlap permits the windows to meet without blending
  them. Scrubbing uses the project frame, not wall-clock CSS animations.
- Fade multiplies saved opacity by 0..1. Zoom multiplies saved scale by 0.8..1
  about the saved center (not a fade or full-screen zoom). Slides move the padded,
  fitted visual fully beyond the chosen canvas edge, accounting for saved center
  and scale, then settle at that center; rise/drop use the bottom edge.
- Static appearance composes with the effect. Source trim, speed, timeline
  position and audio are unchanged. Fade reveals lower visual layers or black;
  it does not crossfade a neighboring clip or fade its audio.
- Percentage lengths rescale with trim/speed/ripple, so those edits are no longer
  rejected for animation length. Earlier fixed-frame animations keep the previous
  rule: too-short edits reject atomically. Splits retain entrance only on the
  left and exit only on the right; percentages are re-expressed so each effect
  keeps its on-screen frame length, capped at 100% of the half. Undo/Redo is exact.
- The render plan carries original clip duration and segment offset, so another
  visual layer's segment cut cannot restart the effect. FFmpeg expressions and
  preview evaluation consume the same normalized envelope/delta definitions.
  Alpha is evaluated before variable-size scaling to keep frame counters stable.
  Final output resolution/fps conversion still happens after composition.
  Scaling, chroma subsampling and compression permit small pixel differences.
- Properties uses collapsed Animations with explicit Apply/Remove. Both lengths share
  one bar: the entrance handle measures from the left, the exit handle from the
  right, and they cannot cross (total at most 100%). Where they meet, dragging left
  moves the entrance and dragging right moves the exit, so neither gets stuck; each
  handle also takes arrow keys. Each end also has − / + (1%)
  and a box. Seconds/frames at the current clip length are shown. Draft changes do not
  save until applied, and pending/locked controls remain disabled.
  Shared save/recovery guards and the error catalog cover rejected edits.

Earlier verification (fixed-frame form): 175 focused tests, real synthetic FFmpeg
renders of all ten presets, typechecks, lint, client build and a narrow browser
fixture. Percentage update (2026-11-05): schema, reducer/split, Properties
(including live appearance sliders), Preview, Help, persistence/Undo and the
selected FFmpeg export checks pass; see the session handoff for counts.

### Approved next priority: fast time-to-edit

**Status:** direct-source playback and the optional-job foundation of phases 1-2 are implemented; representative long-video performance acceptance remains pending before M4. A nearly three-hour high-resolution source exposed the former full-file preparation wait. Success means starting useful editing promptly, not merely finishing a full conversion faster. Reference import still requires probing, sampled fingerprinting and registration; copy mode additionally waits for copying. Do not promise constant latency for arbitrary codecs, storage or hardware.

Implemented behavior:

- Authenticated source serving supports byte ranges for all video assets, including silent video. Original video thumbnails load independently of proxy generation; this is browser decoding, not a dedicated extracted-thumbnail cache.
- A newly assigned video source has a five-second first-frame readiness deadline. Metadata alone is not success. Decode/load failures and the deadline pause playback and offer explicit retry/optimization while timeline editing remains available. This is not a timeout or latency measurement for every later seek/stall.
- The current Auto policy uses an already completed proxy, otherwise the original. It does not automatically benchmark originals or start conversion. Prepare, Cancel preparation and Retry optimized preview are available in the asset context menu and active video preview.
- Job controls are project-identity guarded, duplicates are coalesced, and cancellation waits for the writer/cleanup before that output path can be retried. After proxy publication begins, cancel waits for completion rather than deleting the committed result. Project close/reset still waits for workers and rejects stale completion.
- An optimization finishing during playback does not replace the playing source. Pause adopts it at the same playhead without automatically resuming. Original media and export settings are unchanged.
- Existing per-asset proxies are reused. Missing referenced files are cleared on reopen/relink without requeueing. The fixed format has no selectable profiles or new profile/format-version invalidation system; advanced compatibility/versioning below remains deferred.

Focused local verification covers original playback/readiness, job controls, cancellation/commit/cleanup races, stale project generations, range/auth serving and existing original-source export arguments. A tiny owned silent H.264 browser fixture decoded red/blue original frames, sought correctly, retained the original while playing with a controlled clock, and adopted a real generated proxy at the same paused frame. An owned malformed fixture produced actionable decode failure without starting optimization. These checks do not certify three-hour load/seek targets or broad codec/color/audio behavior.

#### Phase 1 - Direct-source preview

- Register supported originals without waiting for full proxy conversion. Allow placement, playback, trim and split using the original.
- Extend the authenticated, asset-ID-based, byte-range media service to cover video sources including silent video. Preserve path resolution, project ownership and offline safeguards; never expose arbitrary filesystem paths.
- Use codec/container metadata as a hint and actual browser metadata/decode results to establish compatibility; an extension or `canPlayType` result alone is insufficient. Bound readiness checks and show explicit unsupported, slow, offline and failed states.
- Reuse the shared playhead, source-time mapping, trim-boundary and error/retry behavior. Generate thumbnails independently of full-file proxy completion.

#### Phase 2 - Optional, non-blocking optimization

- Add an Auto preview policy: use the original when it works adequately; offer an optimized preview when needed. Do not automatically transcode every long video on import.
- Expose explicit Prepare, Cancel preparation and Retry actions with authoritative job status. Cancellation must not remove assets, clips, originals or completed usable proxies.
- Show the active playback source separately from job progress, for example "Editing original; optimized preview preparing: 24%".
- Retain existing completed proxies. Switch sources at a safe paused boundary, preserving playhead, selection, edits and playback intent; never resume unexpectedly.
- Define cache compatibility/invalidation for source fingerprint, preview profile and format version. Keep lifecycle generation guards and wait for writers to settle before cleanup.
- Deliver phases 1-2 first and measure the long-video workflow before committing to phase 3.

#### Phase 3 - Demand-driven fallback (separate follow-up)

- For unsupported or impractically slow originals, create short independently playable preview segments around the playhead, then adjacent ranges, then other requested ranges.
- Prioritize new seeks over background work. Define source-time offsets, segment boundaries, audio continuity, cancellation, bounded cache storage and eviction before implementation.
- Do not pretend the current growing `.part` MP4 is playable or that lowering proxy resolution removes full-duration processing.

#### Phase 4 - Measured background tuning

- Evaluate 360p Fast and 540p Balanced profiles, faster encoding presets and hardware acceleration with an explicit tested CPU fallback.
- Bound background CPU/GPU/I/O contention; increasing parallel jobs is not automatically an improvement.
- Reuse validated cache on reopening and report inspection, copying, playable readiness and optimization separately.
- Export always uses original media at project/export settings. Preview quality must never silently reduce output quality; output cannot restore detail absent from the source.

#### Proposed acceptance targets

These are initial targets for a documented representative local reference-import baseline, not universal guarantees. Record hardware, codec/container, resolution/frame rate, storage, copy/reference mode, cache state and background work. Report typical and slow-case (including p95 where sample counts support it) results separately.

| Measurement | Initial target |
|---|---|
| Visible import acknowledgement | Under 200 ms |
| Supported local reference import to editable asset | Within 5 seconds |
| Timeline placement to first original frame | Within 2 seconds |
| Ordinary seek on representative supported footage | Within 1 second |
| Unsupported/failed direct playback | Actionable state within 5 seconds; no indefinite spinner |

- Test short and nearly three-hour owned footage, cold/warm opens, supported/unsupported codecs, silent video, slow storage and copy mode separately. Time-to-edit for supported sources must not wait for full-duration encoding.
- Verify audio sync, inclusive trim ends, cuts/gaps, mixed/rational FPS, variable frame rate, rotation, HDR/color behavior, layered playback and original-source export. Do not claim frame-exact or universal codec support.
- Test job cancellation/retry, source switching, relink, reopen, stale callbacks, cache invalidation and cleanup. Automated fixtures plus focused real-media acceptance are required; ask before broad benchmarks/full suites.

#### Interrupting preparation

- Cancel preparation stops the selected queued/running job without closing the project. There is no resumable checkpoint. Closing the project through Projects requests cancellation and waits for proxy/export workers to settle. This also cancels an active export; do not close while another operation is unresolved.
- A partial proxy is written separately as `.part`; the final proxy is published only on completion. Graceful cancellation attempts to remove the partial file and suppresses stale completion callbacks. Cleanup can fail and must remain explicit.
- Cancelling preparation does not intentionally delete originals, registered assets or saved timeline edits. Wait for Autosaved and resolve ambiguous operations before closing. Closing also ends session-local Undo/Redo history.
- Partial encoding progress is lost. Reopening does not restart conversion; explicit preparation starts again from the beginning.
- Force-killing the app/FFmpeg can leave partial files and skips orderly settlement; prefer the in-app close flow. No power-loss/data-loss guarantee is implied.
- Do not restart the app or change runtime code underneath a user's active job without approval.

### Proxy format (implemented)

- H.264 (`libx264 -preset veryfast -crf 28`), yuv420p, never upscaled above 540p, constant frame rate equal to the source rate, keyframe every 15 frames, AAC stereo 96 kbps, `+faststart`.
- Generated one at a time in the engine, written to a `.part` file and renamed when finished, with progress parsed from FFmpeg's `-progress` output and pushed to the client as server-sent events.
- The proxy can end up one frame shorter than the asset's computed frame count (rounding at the tail). The preview must clamp to the proxy's real duration.
- Completion metadata is bound to the originating project opening, including same-folder reopen. Reset suppresses stale callbacks/status and waits for the writer to exit before cleanup or new rendering.

### Implemented in Slice B and the visual demo slice

- `PlayheadClock` (`apps/client/src/clock.ts`) holds the playhead as fractional frames, advances with `requestAnimationFrame` and elapsed time, and stops at the end. Only the playhead line, the timecode and the preview subscribe to ticks (direct DOM updates), and React re-renders only on play, pause or rate changes.
- The preview renders every active visual track in back-to-front order, using a `<video>` element for each active video clip and an engine-served `<img>` for each still image. Normal drift correction uses 0.25 s while playing (half a frame while paused). Source/proxy or timeline-to-source mapping changes force a seek even below that tolerance; returning from a gap/preparing state resets continuity. Contiguous splits retain the same mapping and do not force a seek.
- Static clip properties now apply to video/images on both visual track kinds. Preview uses the project's aspect ratio, fitted media, normalized center position, scale and opacity inside a clipped canvas. Export carries the same transform into each render segment, scales the fitted transparent layer, applies alpha and positions its center in project-frame coordinates. Final video encoding introduces pixel rounding/compression; this is not pixel-identical color-management certification. Reset restores the absent transform, not just visually equivalent metadata.
- **Canvas editing (2026-11-05, local; owner tried it on the desktop and reported it works):** Preview is the export canvas. `clipCanvasRect` (`packages/schema/src/canvas.ts`) is the single geometry contract (fit inside the frame, scale around the center, center at x/y); a real-FFmpeg pixel test checks that an exported non-square picture's edges land where it says. A transparent edit layer over the Preview hit-tests the top-most picture at the playhead, selects it (same selection as the timeline), moves it by drag and resizes it proportionally from corner handles around its center. Drags update an unsaved draft (Preview and the Properties Appearance sliders follow) and save one `SetClipTransform` on release. Snapping (6 screen px) aligns edges/centers with the canvas edges and center and other visible pictures, with pink guides; Alt bypasses it and a Snap on/off toggle sits below the Preview. Clicking or right-clicking pauses playback first, and the outline is hidden while playing; as of 2026-11-10, paused bounds follow the displayed zoom/animation and gestures convert back to saved appearance. Right-click offers Bring forward/to front and Send backward/to back, planned by `planLayerClip` as one batch of existing commands: move the clip at the same time to the free visual track just past the picture(s) it overlaps, or `AddTrack` plus `SwapTrackOrder` steps to insert a new track there. Locked tracks can be selected but not changed. Free resize remains backlog; crop controls and saved rendering are described above.
- Audio clips on dedicated rows use range-served original media and synchronize to the same playhead. Each row has independent mute and ordering controls; clips loop their source when their timeline duration exceeds the source range. Seeking and playback remain approximate under browser scheduling and throttling.
- The source target is clamped to the clip's inclusive range (`sourceIn` through `sourceOut - 1` in project frames), then to the active media's real duration (K6). Before a discontinuity, gap or visible end, the last visible project frame is held with native playback paused until the next clock segment; this prevents autonomous video playback from decoding a removed range ahead of the cut in the tested fixture. A gap shows "No clip here"; videos without proxies attempt original playback.
- Rejected `video.play()` calls and media load/decode errors stop repeated playback attempts, pause the clock and show an explicit error with a Retry preview control. Retry reloads the active source and resynchronizes to the shared playhead without unexpectedly resuming; it does not claim that a corrupt/missing source or browser policy issue has been fixed.
- K32 is verified locally with component regressions and decoded-frame browser acceptance using synthetic colour media. This is not frame-exact certification for all media, hardware, playback rates or background/throttled tabs; seek latency and audiovisual transitions remain approximate.
- Timeline: pointer scrubbing, zoom 0.01-400 px/s, Fit timeline for long-video overviews, ruler ticks that widen when zoomed out (including hour labels for hour-long timelines), click to select, optional playhead-follow and drag-edge auto-scroll, visual/audio clip dragging between compatible rows, edge-drag trim handles, and visual/audio track creation and adjacent reordering. Manual horizontal scrolling suspends Follow playhead without pausing playback; enable the toggle to return to following. Pause/resume does not override this choice; vertical scrolling does not suspend follow. Zoom preserves the visible playhead's screen position, or the viewport center when the playhead is off-screen; Fit returns to the start. Navigation settings are session-local and do not modify saved edits. Clip dragging preserves its source range and pointer-relative time position, previews in the target row, and does not reorder tracks. Visual clips may overlap across rows; overlapping audio drops are rejected. Playback pauses when clip movement or trimming starts. Visual clip dragging snaps either edge to time zero, the playhead, or another visual clip edge within 8 screen pixels, with an on-screen guide.

### Known preview limits (accepted for prototype)

- A cut between different sources (or a gap) stalls briefly while the player seeks; the next clip is not yet preloaded in a second element.
- Video-source audio remains attached to its video element; every visible layer's sound plays and independent audio rows are mixed by the browser. Track mute applies to audio rows and to visual rows (sound only; the picture stays). Clips whose audio was split are muted.
- Frame-exact sync across multiple simultaneous video elements is not guaranteed.
- WebGL/canvas rendering is deferred until preview needs justify it. (Canvas *editing* uses HTML layers over the existing elements, not a WebGL renderer.)

## Export

- **Engine-side FFmpeg** builds the output from the project timeline using original media, not proxies.
- **Pipeline:** timeline to a render plan (segments per track, in frames converted to exact timestamps), then to an FFmpeg command or filter graph.
- **Default:** H.264 + AAC MP4 at the project resolution and frame rate, with selectable output presets below.
- **Job behaviour:** progress reporting from FFmpeg output, cancellation, and a typed failure reason.
- **Output:** written to the project's `exports/` folder.

### Export settings (implemented)

**Status: implemented with focused local validation; desktop acceptance pending
after relaunch.** This adds output choices, not a change to
the project's editing frame rate, canvas, saved clips or preview policy.

First-version controls:

| Setting | Implemented choices and default |
|---|---|
| Format / video codec | MP4 / H.264, visibly identified; AAC audio remains 192 kbps stereo. Other codecs/containers are deferred. |
| Frame rate | Project rate (default), 24, 25, 30, 50 and 60 fps, plus 23.976, 29.97 and 59.94 represented exactly as 24000/1001, 30000/1001 and 60000/1001. |
| Resolution | Project size (default), 720p, 1080p and 4K. Presets fit the project aspect ratio within a 1280, 1920 or 3840-pixel longest edge, respectively; portrait stays portrait. Show the actual output width and height before starting. |
| Quality | Smaller file (CRF 23), Standard (default, CRF 20, matching current export), High (CRF 18). Retain the current software encoder's medium preset; do not promise an exact file size. |

Resolution presets use even dimensions required by H.264/yuv420p, with only
rounding-level aspect-ratio differences. Preserve the composed canvas without
stretching or cropping it. Project size retains the existing even-dimension
normalization and displays the actual dimensions. Explain when a preset upscales:
it increases output pixels, not source detail. Custom dimensions are deferred.

Changing output fps duplicates/drops frames as needed; it does not interpolate
motion, restore source frames already excluded by the project timebase, or change
clip speed. Explain this beside the setting, especially for 60 fps. Keep timeline
timing and source mapping in project frames, compose using the existing project
timebase, then convert the finished composition to the selected dimensions/rate.
Avoid reinterpreting project frame counts as output frame counts.

Implementation contract:

1. Define shared, bounded export-settings validation and normalization. Extend
   the start request with optional settings; omitted settings retain current
   output behavior. Reject unsupported values explicitly before starting a
   writer, with specific readable catalog guidance.
2. Resolve and freeze settings with the export attempt and project snapshot.
   Return the resolved settings with that attempt's status so recovery or
   **Check active export** cannot describe another job using current form values.
   Receipt checks and cancellation/status retries must never resubmit a render.
3. Add an accessible pre-export settings form and summary of format, dimensions,
   fps and quality. Freeze it while starting/running/unconfirmed. Keep selections
   within the open dialog for an explicit new export; reopening starts at defaults.
   No project-schema migration or global preference persistence in this slice.
4. Wire normalized settings through original-source rendering, final conversion,
   progress and output verification. Validate actual codec, pixel dimensions,
   rational frame rate and duration with ffprobe before publication; duration
   tolerance must use the output timebase. Preserve collision-safe publication,
   owned-file cleanup, diagnostics and attempt-correlated recovery.
5. In-app Help, feature availability, the shared error catalog and manual guide
   include the implemented controls and their limitations. Options collapse while
   the job is active/unconfirmed; the summary and progress remain visible. Expanding
   the options cannot edit the frozen controls.

Focused acceptance:

- Schema/API tests cover defaults, rational fps, supported presets and explicit
  invalid-settings rejection without rendering or modifying the project.
- UI tests cover defaults, summary, aspect-preserving portrait/landscape/square
  dimensions, upscale guidance, frozen controls, small-window scrolling and
  matching settings after uncertain-start/status/busy-export recovery.
- Synthetic FFmpeg checks probe actual H.264/AAC output, even dimensions, exact
  rational rates (including 60 and 60000/1001), expected frame count/duration and
  audio/video timing. Cover project-to-output rate conversion across cuts, gaps,
  layers, clip speed and independent audio without changing saved edits.
- Verify smaller/standard/high quality mappings and that omitted settings retain
  current encoding behavior. Keep existing cancellation, cleanup, duration failure
  and matching-attempt regressions. Use a bounded fixture matrix, not every
  combination or the full suite without approval.
- Desktop acceptance uses copied media: export defaults and one alternate
  resolution/60 fps result, inspect properties and playback, then cancel a render.
  Automation and owner acceptance remain separate.

Deferred: HEVC/H.265, AV1, WebM, hardware encoding, custom dimensions/bitrates,
estimated file size, frame interpolation and persistent export profiles.

Local verification (2026-11-03): 129 distinct focused tests passed: 56 shared
settings/client/catalog/Help checks, 33 export argument/API/real-output checks,
15 export lifecycle regressions, 20 export dialog recovery regressions and five
probe interpretation checks. The real-output fixture exports 60, 60000/1001 and
24 fps with selected size/quality across cuts, gaps, layers, speed and independent
audio; it checks actual frame counts, codecs, dimensions, duration, source colors,
audio presence and unchanged saved project content. Affected schema/engine/client
typechecks, lint and the client production build pass.

A 458x560 isolated browser fixture verified scrollable presets with no horizontal
overflow, an accurate portrait 4K/60/High summary, collapsed/disabled active options
and reachable Cancel. Only one synthetic start was sent; the fixture/fetch wrapper
was removed and viewport restored without exporting a real project. An initial
lifecycle selector also matched the parent import/export group and exposed two
unrelated existing failures (duplicate-import expected code and an obsolete
automatic-proxy callback expectation); neither was changed. The narrowed export
lifecycle selection passes. No full suite or CI monitoring was run. Existing
unknown-error inbox tasks were not loaded or cleared in this bounded slice.

### Implemented in M2 Slice C and the visual demo slice

- **Render plan:** `buildRenderPlan` (timeline-core) creates clip and gap segments, retains every active visual layer in ascending track order (back to front), and records unmuted audio-row clips independently. Audio clips can extend the overall timeline even after visual footage ends.
- **FFmpeg command:** video and still-image inputs for each visual segment are scaled/fitted and composited in track order. Still images repeat their first decoded frame in the filter graph for the segment's duration, without using demuxer-specific input loop flags that GIF rejects. Gaps are black video and silence; assets without audio get silence. Audio-row sources loop as needed, are delayed to their timeline positions, and are mixed with the visual audio bed. The bed sums (without averaging) the sound of every visual clip in a segment, skipping split-audio clips and muted visual tracks, so export matches what preview plays. Output is libx264 (`medium`, selected CRF, default 20), AAC 192k stereo, `+faststart`. A final scale/fps stage converts the finished project-timebase composition only when needed; target frames are rounded from timeline seconds at the output rate, with at least one frame.
- **Safe output:** written to `exports/<name>-<timestamp>-<job-uuid>.mp4.part`, then ffprobe checks duration (within 2 output frames or 0.1 s), H.264/AAC codecs, actual dimensions and rational fps. A mismatch fails explicitly and cleans up owned files. A same-volume hard link publishes the final name without replacing an existing file, then the partial name is removed. Filesystems without hard-link support fail explicitly rather than using an overwrite-prone fallback.
- **Cancellation/commit boundary:** reservation begins before asynchronous validation and remains until the writer and cleanup settle. Cancel/reset/project changes are checked after rendering, verification and publication; cancellation during publication rolls back this job's own output. After the final synchronous `done` transition, the export is committed; a later cancel does not delete it. Reset during settlement can temporarily return `EXPORT_BUSY` for a new start.
- **Cleanup:** failed/cancelled/mismatching exports remove their owned output/partial files when possible. Deletion failure reports `EXPORT_CLEANUP_FAILED` with affected paths, not false success; stale-job failures are written to engine stderr rather than replacing another project's status. There is no general orphan-storage sweeper.
- **Engine API:** `POST /project/export` (202) accepts optional `{attemptId, settings}` (UUID and shared validated presets), `GET /project/export` (polled by the client), `POST /project/export/cancel`, `GET /project/media-status`. Unsupported settings return `INVALID_EXPORT_SETTINGS` before a writer starts. Export status retains resolved settings through reservation, progress and terminal states until project reset. Media-status includes the project ID and returns `PROJECT_CHANGED` if project identity or saved revision changes during the filesystem scan. One export at a time. Bodyless/empty-body starts remain compatible; correlated attempts retain the ID through reservation, progress and terminal states until project reset.
- **Client recovery (K18/K19):** one status request at a time per polling lifecycle, scheduled 500 ms after the previous response; obsolete pre-cancel/unmounted responses are ignored. Status/cancel failures show `[CODE]`; failed polling pauses until Retry status check. Status/cancel requests have a 15-second deadline. Cancel acknowledgement may still be `running`: the dialog stays locked and checks status until cleanup settles. A cancellation failure does not claim cancellation completed. The client uses the shared render plan's asset IDs to block only render-used offline media; engine preflight remains authoritative.
- **Export-start recovery (K24 slice):** start has a 15-second deadline covering fetch and body parsing. The client supplies a fresh attempt UUID. Explicit start rejections allow retry/close; transport, malformed response or unexpected server failure keeps the native modal locked with Check export status. Only a non-idle result identifying that attempt resolves uncertainty; prior results, absent IDs and idle do not prove a delayed request cannot still arrive. Matching running adopts normal polling/cancel; matching terminal permits retry/close. Checks never repeat the start mutation. This is correlation, not idempotent POST retry, durable job history or multi-client ownership.
- **Remaining uncertainty:** an unreachable/reset engine or a request that never arrived can leave this conservative modal locked; check again, or reload only after confirming the old engine has stopped. Older engines without attempt IDs cannot reconcile ambiguous starts. Deploy client/schema/engine together. Checks do not guarantee recoverability; show-in-folder and broader create/open/import recovery remain outside this slice.
- **Refusals (422):** `EMPTY_TIMELINE`, `OFFLINE_MEDIA` (names the files), `TOO_MANY_CUTS`, `MISSING_ASSET`.
- **Limits:** audio/video transition timing is not sample-accurate, and many cuts hit the Windows command-line limit (see L8 in the backlog).

## Candidate preview rendering

Candidates (see [Jump-Cut Pipeline](./07-jump-cut-pipeline.md)) store only an edit list.

- **Default:** play the segments back-to-back in the preview player directly from the edit list, using proxy media. No rendered file is needed, which suits short jump-cut sequences.
- **On demand:** the engine can render a low-resolution (about 360p, fast encoder settings, from proxies) preview file from the edit list and cache it in `candidates/`.
- **Starting targets (adjust after measuring in M6):** playback starts in under 3 seconds for a typical 5-second candidate; show progress if it takes longer than about 1 second.

## Hardware acceleration

Not required for the prototype. Encoder choice is a setting to revisit later.
