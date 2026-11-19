import metadata from "../package.json";

export const APP_VERSION = metadata.version;
export const CREDIT_NAME = "Tombeng027";
export const SUPPORT_LINKS = [
  { label: "GitHub: tombeng027 (follow, star and send feedback)", url: "https://github.com/tombeng027" },
] as const;
export const OPEN_SOURCE_CREDITS = ["React", "Vite", "Electron", "Fastify", "Lucide icons", "FFmpeg"] as const;
export const HELP_GUIDES = [
  { title: "Start a project and import media", steps: [
    "Create a project with a frame rate and canvas size, or open an existing project folder.",
    "Import video, audio or still images in Assets. Reference mode uses the original file in place; copy mode copies it into the project and may take longer.",
    "If only some files import, keep the successful assets and retry only failed files. If confirmation is lost, Check import result; Load Assets for review only if needed, then explicitly continue after checking which files are already present.",
    "Supported originals can play without full-video conversion. Prepare optimized preview is optional; unsupported originals may need it before they can play.",
    "Right-click an asset and add it at the playhead, or drag it to a compatible timeline row. Importing alone does not place it on the timeline.",
  ] },
  { title: "Edit and navigate the timeline", steps: [
    "Select a clip to inspect it. Drag it to move; drag either edge to trim. Playback pauses when an editing drag starts. Clicking empty timeline space keeps the selection; press Escape to deselect.",
    "Place the playhead inside a clip and use Split; use Delete to remove a selected clip. Undo/Redo applies to confirmed edits in this session.",
    "Use Previous frame / Next frame beside Play, or the Left / Right arrow keys, for precise positioning. Each step pauses playback and moves one project frame, regardless of playback or clip speed, stopping at the first/last frame. Text fields, sliders and dropdowns keep their arrow keys; modified arrows do not step.",
    "Use zoom controls or Fit timeline for long videos. Horizontal scrolling while playing suspends Follow playhead; turn Follow playhead on to resume following.",
    "Track locks prevent edits. Audio and visual rows accept compatible media. Ripple edits affect neighbors, so review the timeline after a move, trim or insertion.",
    "Every clip you see on the timeline is heard, including stacked videos. Use a track's Mute button to silence it; on video and overlay tracks Mute silences the sound only and the picture stays visible. Preview and export match.",
  ] },
  { title: "Split audio from a video clip", steps: [
    "Select a video clip that has sound and choose Split audio in the timeline toolbar. The button is disabled for images, silent videos, audio clips, locked tracks or clips already split.",
    "The video clip goes silent and a matching audio clip appears on the first free audio track, or on a new audio track if none is free. It is one Undo step.",
    "Afterwards the two clips are independent: move, trim, mute or delete the audio clip without affecting the video. Hover a split video clip to see 'sound on audio track'.",
    "Export uses the audio-track copy and silences the original video's sound, matching Preview.",
  ] },
  { title: "Write manual captions", steps: [
    "Expand captions below the timeline. The thin collapsed strip shows cue density; the expanded lane shares the timeline zoom, horizontal scroll and playhead. Expanding makes room in the resizable timeline area.",
    "Move to an empty gap and choose New caption at playhead. Enter plain text and whole project-frame start/end values (end is exclusive), then Add caption. Selecting a cue in the lane or text list pauses and seeks to it without changing your media selection.",
    "Edit text/timing, then Apply caption; Cancel draft discards unsaved changes. Cues cannot overlap; adjacent cues are allowed. Drag a saved block to move it or either edge to retime it; release saves one Undo step, and Escape/pointer cancellation discards the gesture. Apply or cancel text drafts before dragging.",
    "Split caption uses the playhead inside the selected cue and keeps its text on both halves for editing. Merge with next joins the next chronological cue, including any gap, with a newline between texts. Each split/merge/delete is one confirmed Undo step.",
    "Saved cues draw in Preview as bottom-centered white multiline subtitles. Editor playback includes cues after the media ends, but captions are Preview-only for now: exports remain media-only and do not extend to later cues. SRT, burned-in output, styling controls and speech generation come later.",
  ] },
  { title: "Adjust clip properties and speed", steps: [
    "Select a timeline clip to open its Properties beside Preview. Hide Assistant or resize the panes if you need more space.",
    "Trim clips by dragging their edges on the timeline. Expand Appearance when needed; it controls fitted zoom, center and opacity on visual clips.",
    "Video/audio Clip speed accepts 0.25x to 4x and preserves audio pitch. Use the slider (saves on release), − / + (0.05x; quick clicks combine into one edit) or type a value and press Enter. Speed changes duration and shifts later clips on that track only; other tracks stay fixed. Images remain 1x.",
    "Animation drafts save when you choose Apply animations; Speed, Appearance and Zoom save when you release a slider, leave a box or press Enter. Open sections stay open after saving until you select another clip. The transport playback speed is preview-only and is not exported.",
    "Slow-motion splits sometimes cannot preserve whole source-frame timing. Move the playhead to a nearby frame when prompted.",
  ] },
  { title: "Save safely and recover an edit", steps: [
    "Confirmed changes autosave. Wait for Autosaved; Save unconfirmed is not proof of success or failure.",
    "If confirmation is lost, use Check whether edit saved. Do not send the same edit again while its result is unknown.",
    "If the receipt cannot be recovered, Load saved project for review. Inspect your last edit, then explicitly continue editing. This clears session Undo/Redo history.",
    "Retry edit is only offered after a confirmed save failure. Check disk space and folder permissions first. Error details contains technical information.",
    "A recovered backup may omit recent edits. Review it before editing; the next successful edit repairs the main project file.",
  ] },
  { title: "Animate a visual clip", steps: [
    "Select a video or image clip and expand Animations in Properties. Choose one of five entrance and five exit presets, or None, then set lengths on the shared bar: the entrance handle grows from the left, the exit handle from the right, and they cannot cross. Where they meet, drag left to move the entrance or right to move the exit. Arrow keys, − / + and boxes give exact values. Browse Help's Animation catalog for definitions.",
    "Apply animations saves the draft; Remove animations clears both ends. Animations support autosave and Undo/Redo, respect track locks and preserve static appearance, clip speed and audio.",
    "Length is a percentage of the clip, so it rescales when you trim or change speed. Entrance plus exit can use up to 100%; each slider stops where the other leaves off. The default is about 0.5 seconds. Properties shows the resulting seconds and frames; very short results are flagged and not shown. Zoom uses 80% to/from saved size; slides start/end fully outside the canvas.",
    "A split keeps the entrance on the left and the exit on the right at the same on-screen length, shortened only if a half is too short. Older projects with fixed-length animations still open; applying them again saves a percentage.",
    "Preview scrubbing and original-source export use the same clip-local timing. Animations finish on the last included frame. Animations stay per clip: when one clip ends with an exit, the next simply plays its own entrance (or appears). Between-clip crossfades and a custom animation editor are not available yet.",
  ] },
  { title: "Adjust appearance", steps: [
    "Expand Appearance in Properties. Zoom, Center X/Y and Opacity each have a slider, − / + buttons that change by 1%, and a box for exact values.",
    "Preview updates while you drag. Releasing a slider, leaving a box or pressing Enter saves one Undo step; quick − / + clicks combine into one step.",
    "Sliders cover common ranges (zoom 10–400%, center −100–200%). Type in the box for the full range. Reset appearance restores the fitted, centered default.",
  ] },
  { title: "Arrange pictures on the canvas", steps: [
    "Preview is the export canvas: what you see positioned there is what Export renders. Click a picture to select it (the top-most one under the pointer); its Properties open, just like clicking it on the timeline.",
    "Drag the selected picture to move it, or drag a white corner handle to resize it around its center (proportions are kept). Properties' Appearance sliders follow while you drag; releasing saves one Undo step.",
    "Pink guide lines show when an edge or center snaps to the canvas edges, the canvas center or another visible picture. Hold Alt to move freely, or turn Snap off below the Preview.",
    "Clicking or dragging on the canvas pauses playback first; the outline is hidden while playing. The outline shows the clip's resting position, so entrance/exit animations and zoom still play on top of it.",
    "Right-click a picture for Bring forward, Bring to front, Send backward and Send to back. These move the clip to another visual track at the same time, inserting a new track when needed; the timeline shows the result and it is one Undo step. Locked tracks can be selected but not changed.",
  ] },
  { title: "Zoom between two points", steps: [
    "Select a video or image clip, expand Zoom in Properties and choose Add zoom. It starts at 25% and 75% of the clip, zooming from 100% to 150%.",
    "Drag the two handles on the bar, or move the playhead and choose Set start at playhead / Set end at playhead. The start stays before the end; where the handles meet, drag left for the start or right for the end.",
    "Set Start scale and End scale (25–400%) with the sliders, − / + or the boxes. The clip holds the start scale before the start point, eases smoothly to the end scale, then holds it.",
    "Zoom scales around the clip's center from Appearance and combines with Appearance and entrance/exit animations. Preview updates while you drag; releasing, leaving a box or pressing Enter saves one Undo step. Remove zoom clears it.",
    "Points are a percentage of the clip, so they follow trims and speed changes. A split keeps exactly the same zoom motion across both halves. Export matches Preview.",
    "Zoomed clips show yellow diamond markers on the timeline at the start and end points, joined by a line; hover the clip to see its zoom scales. The markers move live while you drag in Properties.",
  ] },
  { title: "Recover preview playback", steps: [
    "Preview notices distinguish offline media, blocked playback, unsupported formats, decode/network failures and a five-second initial video-frame timeout. Error details stays collapsed until needed.",
    "Use Refresh preview status to check the engine and original files. Relink offline media from Assets. Retry preview or Retry audio reloads playback; press Play yourself afterward.",
    "For an original video that cannot play directly, choose Prepare optimized preview. Preparation remains optional for supported originals and does not change final export sources.",
    "If preparation or cancellation confirmation is lost, new job requests pause until status refresh succeeds. Refreshing never resends the job or locks timeline editing by itself.",
    "Unknown playback and optimization failures create local development follow-ups without file paths or raw error text. A preview failure is not proof of export success or failure.",
  ] },
  { title: "Relink media and export", steps: [
    "Keep referenced original files available. If an asset is offline, right-click it and choose Relink, then select the matching original rather than another encode.",
    "Export produces an MP4 using original sources, saved clip speed and appearance, and unmuted independent audio rows. Proxies do not lower final export quality.",
    "Choose MP4/H.264 output frame rate (including 60 fps), project size or aspect-preserving 720p/1080p/4K, and Smaller file/Standard/High quality. The summary shows actual even-pixel dimensions. Defaults keep the project rate/size and Standard quality.",
    "Output settings do not change saved edits. Higher fps repeats/drops frames, not motion interpolation; upscaling adds pixels, not source detail. Portrait and square projects retain their shape. Quality affects file size but is not a size guarantee.",
    "Settings freeze while export is starting, running or unconfirmed. Recovered status shows that attempt's actual output settings. After completion, form changes apply only to your next explicit export; reopening Export resets the form.",
    "Resolve uncertain saves and missing media before exporting. Use a short export to check timing, pitch and appearance before rendering a long project.",
    "If the start reply is lost, Check export status rather than starting again. If progress updates fail, Retry status check; the displayed percentage is only the last confirmed value.",
    "Cancel export requests cancellation; wait for the matching cancelled result and cleanup. If its reply is lost, check status before repeating cancellation. A finished render may win a cancellation race.",
    "Failed-render notices explain causes where known and keep technical details collapsed. Cleanup leftovers are not verified exports. Unknown failures create local development follow-ups without paths or raw messages.",
    "Use Projects to close the active project gracefully. Reopen it from the project list when needed.",
  ] },
] as const;

export const FEATURE_GROUPS = [
  { title: "Available", items: [
    "Project creation/opening, autosave, backup recovery, media import and matching-original relinking.",
    "Video, still-image and independent audio rows; clip insertion, movement, trimming, splitting, deletion and session Undo/Redo.",
    "Track names, locks, muting on audio and visual tracks (stacked clips are all heard), visual compositing, snapping, timeline zoom/Fit and optional playhead following.",
    "Selected-clip static zoom/position/opacity and pitch-preserving 0.25x-4x video/audio speed.",
    "Canvas editing in Preview: select, move and proportional resize with snapping guides, and right-click layer order; Preview placement matches export. Paused handles follow the displayed zoom/animation. Move inside a slide animation before editing its fully offscreen endpoint.",
    "Fit to canvas beside Preview or in the picture's right-click menu centers the original source and resets its base scale to 100%, preserving proportions, crop, opacity and effects. Asymmetric crop stays offset inside that original footprint. Active zoom can still enlarge the picture. Exit Crop mode first. Playback pauses; autosave and Undo/Redo apply.",
    "Canvas aspect ratio above Preview: 16:9, 9:16, 1:1 or 4:3 changes the saved project and export shape, with Undo/Redo. Playback pauses; clips keep their edits and refit. The long edge is retained where possible, rounding down to even exact-ratio dimensions.",
    "Crop: toggle handles beside Preview or from the picture's right-click menu. Drag an edge/corner to preview, release to save one Undo step, or press Escape to cancel. Properties > Crop has source-percent fields with Apply, Reset and Cancel draft. Free-form and Project aspect locked modes are shared with the right-click menu; aspect lock applies on the next crop edit and adjusts the other dimension around its center. Crop preserves effects, timing and sound.",
    "Five entrance and five exit animation presets for video/images, duration controls, Undo/Redo and a shared Help animation catalog.",
    "Two-point zoom per visual clip: start and end points with start/end scales, smooth easing, live preview and matching export.",
    "Split audio: move a video clip's sound onto an independent audio-track clip in one undoable step.",
    "Direct supported-original preview, optional optimized previews with prepare/cancel/retry, and original-source MP4 export.",
    "Previous/Next frame transport buttons and Left/Right arrow shortcuts: pause and step one project frame without changing saved edits.",
    "MP4/H.264 export settings: selectable output fps including 60 and fractional rates, aspect-preserving resolution presets and three quality levels.",
    "Context-aware edit/save, import, preview and export help, partial-import summaries, and temporary local unknown-error development follow-ups.",
  ] },
  { title: "Limited / experimental", items: [
    "Manual captions have one timeline-fixed, nonoverlapping plain-text lane and fixed Preview styling. Media edits do not move cues. SRT/burned-in output, styling controls and auto-generation are not available yet. New saves use project schema v2; v1 projects load with an empty caption lane and a migration notice. Opening alone does not rewrite files. Keep a separate pre-upgrade copy and do not open v2 work in older app builds.",
    "Crop trims edges in place without automatically refitting, enlarging or recentering the picture. Enter Crop to enable constraint choices; the menu radio dot and Properties status indicate the selected mode. Move/resize, Appearance and Fit controls are unavailable while Crop mode is active. Pixel rounding can slightly change the locked ratio. Extreme source/project ratios outside the crop limits cannot be locked.",
    "This is a development prototype, not a fully certified editor. Test important edits on copies and check short exports.",
    "Browser codec support, long-video responsiveness and audio drift vary. Preview is not sample-accurate or broad codec/color certification.",
    "Slow-motion splits must fit the whole-frame grid. Clip speed ripples one track only and does not synchronize detached audio.",
    "Undo/Redo is session-local and is cleared by uncertain-edit project review. Error catalog covers edit/save, imports, preview and export, but generic unexpected failures still require investigation.",
  ] },
  { title: "Planned - not available yet", items: [
    "Between-clip transitions, multiple zooms per clip and a custom entrance/exit animation editor.",
    "Free (non-proportional) resize, rotation and animated crop.",
    "Conversational Ollama assistant, confirmed AI action proposals and AI jump-cut candidates.",
    "Reverse playback, speed ramps, automatic caption generation, SRT/burned-in captions and demand-driven preview segments.",
    "Additional export codecs, hardware encoding, custom dimensions/bitrates and motion interpolation.",
  ] },
] as const;
