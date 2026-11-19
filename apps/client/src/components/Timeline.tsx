import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Scissors, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { TrackNameSchema, type ClipZoom, type Command, type Project } from "@ve/schema";
import { applyCommand, assetDurationInProjectFrames, clipDuration, clipEnd, formatTimecode } from "@ve/timeline-core";
import type { PlayheadClock } from "../clock.js";
import { timelineDuration } from "../playback.js";
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, clampZoom, framesToPx, pxToFrame, rulerTicks, snapClipFrame } from "../timelineMath.js";
import { useClockState, useClockTick } from "../useClock.js";
import { ASSET_DRAG_TYPE } from "../assets.js";
import { CaptionWorkspace } from "./CaptionWorkspace.js";

type Props = {
  project: Project;
  clock: PlayheadClock;
  selectedClipId: string | null;
  selectedTrackId?: string | null;
  offline: ReadonlySet<string>;
  message: string | null;
  onSelect: (clipId: string | null) => void;
  onSelectTrack?: (trackId: string | null) => void;
  onDropAsset?: (assetId: string, timelineStart: number, trackId: string | null) => void;
  onSplit: () => void;
  onDelete: () => void;
  onSplitAudio?: () => void;
  onTrim: (clipId: string, sourceIn: number, sourceOut: number) => void;
  onMoveClip?: (clipId: string, timelineStart: number, trackId: string) => void;
  onAddVisualTrack: () => void;
  onAddAudioTrack?: () => void;
  onRemoveTrack?: (trackId: string) => void;
  onRenameTrack?: (trackId: string, name: string) => void;
  onLockTrack?: (trackId: string, locked: boolean) => void;
  onReorderVisualTrack: (trackId: string, direction: -1 | 1) => void;
  onReorderAudioTrack?: (trackId: string, direction: -1 | 1) => void;
  onToggleTrackMuted?: (trackId: string, muted: boolean) => void;
  mutationsDisabled?: boolean;
  onCaptionCommands?: (commands: Command[]) => Promise<boolean>;
  onCaptionExpand?: () => void;
  /** Unsaved Properties zoom for one clip; null means the draft removes the zoom. */
  zoomDraft?: { clipId: string; zoom: ClipZoom | null } | null;
};

const RATES = [0.5, 1, 1.5, 2];
const TAIL_SECONDS = 5;
const TRACK_LABEL_WIDTH = 160;
const EDGE_SCROLL_ZONE = 48;
const MAX_EDGE_SCROLL_PX = 12;
type TrimDraft = { clipId: string; timelineStart: number; sourceIn: number; sourceOut: number };
type Gesture =
  | { kind: "scrub" }
  | { kind: "trim"; pointerId: number; pointerStartFrame: number; initial: TrimDraft; draft: TrimDraft; edge: "left" | "right" }
  | {
      kind: "move";
      pointerId: number;
      pointerStartFrame: number;
      pointerStartX: number;
      initialStart: number;
      durationFrames: number;
      clipId: string;
      initialTrackId: string;
      draftTrackId: string | null;
      trackKind: "audio" | "video" | "overlay";
      dragging: boolean;
      draftStart: number;
      guideFrame: number | null;
    };

function Timecode({ clock, project }: { clock: PlayheadClock; project: Project }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fps = project.settings.fps;
  const update = useCallback(() => {
    if (ref.current) ref.current.textContent = formatTimecode(clock.frame, fps);
  }, [clock, fps]);
  useClockTick(clock, update);
  return <span className="timecode" ref={ref} aria-label="Playhead time" />;
}

export function Timeline({
  project, clock, selectedClipId, selectedTrackId = null, offline, message, onSelect, onSelectTrack = () => undefined,
  onSplit, onDelete, onTrim, zoomDraft = null, onSplitAudio,
  onDropAsset,
  onMoveClip = () => undefined, onAddVisualTrack, onAddAudioTrack = () => undefined,
  onRemoveTrack = () => undefined,
  onRenameTrack = () => undefined, onLockTrack = () => undefined,
  onReorderVisualTrack, onReorderAudioTrack = () => undefined, onToggleTrackMuted = () => undefined,
  mutationsDisabled = false,
  onCaptionCommands, onCaptionExpand,
}: Props) {
  const fps = project.settings.fps;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [following, setFollowing] = useState(true);
  const followEnabled = useRef(true);
  const scrollLeft = useRef(0);
  const [captionScrollLeft, setCaptionScrollLeft] = useState(0);
  const zoomScroll = useRef<number | null>(null);
  const { playing, rate } = useClockState(clock);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const edgePointerX = useRef<number | null>(null);
  const edgePointerY = useRef<number | null>(null);
  const edgeScrollFrame = useRef<number | null>(null);
  const [trimDraftProject, setTrimDraftProject] = useState<Project | null>(null);
  const [snapGuideFrame, setSnapGuideFrame] = useState<number | null>(null);
  const [assetDropFrame, setAssetDropFrame] = useState<number | null>(null);

  const duration = timelineDuration(project);
  const canSplitAudio = project.tracks.some((track) => track.kind !== "audio" && !track.locked && track.clips.some((clip) =>
    clip.id === selectedClipId && clip.audioLinked &&
    project.assets.some((asset) => asset.id === clip.assetId && asset.kind === "video" && asset.hasAudio)));
  const displayDuration = timelineDuration(trimDraftProject ?? project);
  const totalSeconds = (displayDuration * fps.den) / fps.num;
  const width = TRACK_LABEL_WIDTH + Math.max(framesToPx(displayDuration, fps, zoom) + TAIL_SECONDS * zoom, 400);
  const ticks = useMemo(() => rulerTicks(totalSeconds + TAIL_SECONDS, fps, zoom), [totalSeconds, fps, zoom]);
  const tracks = [...(trimDraftProject ?? project).tracks].sort((a, b) => b.order - a.order);
  const visualTracks = tracks.filter((track) => track.kind !== "audio");
  const audioTracks = tracks.filter((track) => track.kind === "audio");
  const laneTracks = [...visualTracks, ...audioTracks];
  const selectedTrack = project.tracks.find((track) => track.id === selectedTrackId);
  const [trackName, setTrackName] = useState("");
  const [trackNameError, setTrackNameError] = useState<string | null>(null);
  useEffect(() => {
    setTrackName(selectedTrack?.name ?? "");
    setTrackNameError(null);
  }, [selectedTrack?.id, selectedTrack?.name]);

  useEffect(() => clock.configure(fps, duration), [clock, fps, duration]);

  const suspendFollow = useCallback(() => {
    followEnabled.current = false;
    setFollowing(false);
  }, []);

  const scrollTo = useCallback((left: number) => {
    const box = scroller.current;
    if (!box) return;
    box.scrollLeft = Math.max(0, Math.min(left, box.scrollWidth - box.clientWidth));
    scrollLeft.current = box.scrollLeft;
    setCaptionScrollLeft(box.scrollLeft);
  }, []);

  const changeZoom = (value: number, fit = false) => {
    const next = clampZoom(value);
    const box = scroller.current;
    if (box) {
      const playheadX = TRACK_LABEL_WIDTH + framesToPx(clock.position, fps, zoom) - box.scrollLeft;
      const anchorX = playheadX >= TRACK_LABEL_WIDTH && playheadX <= box.clientWidth - 24
        ? playheadX : TRACK_LABEL_WIDTH + Math.max(0, box.clientWidth - TRACK_LABEL_WIDTH) / 2;
      const seconds = (box.scrollLeft + anchorX - TRACK_LABEL_WIDTH) / zoom;
      zoomScroll.current = fit ? 0 : TRACK_LABEL_WIDTH + seconds * next - anchorX;
      if (next === zoom) {
        scrollTo(zoomScroll.current);
        zoomScroll.current = null;
      }
    }
    setZoom(next);
  };
  useLayoutEffect(() => {
    if (zoomScroll.current === null) return;
    scrollTo(zoomScroll.current);
    zoomScroll.current = null;
  }, [scrollTo, zoom]);

  const placeHead = useCallback(() => {
    const el = head.current;
    if (!el) return;
    const x = TRACK_LABEL_WIDTH + framesToPx(clock.position, fps, zoom);
    el.style.transform = `translateX(${x}px)`;
    const box = scroller.current;
    // Detect user scrolling even if its scroll event has not run before this tick.
    if (box && Math.abs(box.scrollLeft - scrollLeft.current) > 1) {
      scrollLeft.current = box.scrollLeft;
      suspendFollow();
    }
    if (box && followEnabled.current && clock.playing &&
      (x > box.scrollLeft + box.clientWidth - 24 || x < box.scrollLeft + TRACK_LABEL_WIDTH)) {
      scrollTo(x - TRACK_LABEL_WIDTH - 48);
    }
  }, [clock, fps, scrollTo, suspendFollow, zoom]);
  useClockTick(clock, placeHead);

  const seekFromPointer = (clientX: number) => {
    const rect = content.current?.getBoundingClientRect();
    if (rect) clock.seek(pxToFrame(clientX - rect.left - TRACK_LABEL_WIDTH, fps, zoom));
  };

  const stopEdgeScroll = () => {
    edgePointerX.current = null;
    edgePointerY.current = null;
    if (edgeScrollFrame.current !== null) cancelAnimationFrame(edgeScrollFrame.current);
    edgeScrollFrame.current = null;
  };

  const updateTrim = (clientX: number) => {
    const current = gesture.current;
    const rect = content.current?.getBoundingClientRect();
    if (current?.kind !== "trim" || !rect) return;
    const pointerFrame = pxToFrame(clientX - rect.left - TRACK_LABEL_WIDTH, fps, zoom);
    const deltaFrames = pointerFrame - current.pointerStartFrame;
    const clip = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === current.initial.clipId);
    if (!clip) return;
    const sourceDelta = Math.round(deltaFrames * clip.speed);
    let draft: TrimDraft;
    if (current.edge === "left") {
      const sourceIn = Math.min(current.initial.sourceOut - 1, Math.max(0, current.initial.sourceIn + sourceDelta));
      draft = { ...current.initial, sourceIn, timelineStart: current.initial.timelineStart +
        clipDuration(clip) - clipDuration({ ...clip, sourceIn }) };
    } else {
      const asset = project.assets.find((item) => item.id === project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === current.initial.clipId)?.assetId);
      const clipTrack = project.tracks.find((track) => track.clips.some((clip) => clip.id === current.initial.clipId));
      const maximum = asset && asset.kind !== "image" && clipTrack?.kind !== "audio"
        ? assetDurationInProjectFrames(asset, fps) : Number.MAX_SAFE_INTEGER;
      const sourceOut = Math.min(maximum, Math.max(current.initial.sourceIn + 1,
        current.initial.sourceOut + sourceDelta));
      draft = { ...current.initial, sourceOut };
    }
    current.draft = draft;
    const result = applyCommand(project, {
      type: "TrimClip",
      clipId: draft.clipId,
      sourceIn: draft.sourceIn,
      sourceOut: draft.sourceOut,
    });
    if (result.ok) setTrimDraftProject(result.project);
  };

  const trackAtPointer = (clientY: number, fallbackTrackId: string) => {
    const lanes = [...(content.current?.querySelectorAll<HTMLElement>(".tl-lane") ?? [])];
    for (const lane of lanes) {
      const bounds = lane.getBoundingClientRect();
      if (bounds.height > 0 && clientY >= bounds.top && clientY < bounds.bottom) {
        return lane.dataset.trackId ?? fallbackTrackId;
      }
    }
    return lanes.some((lane) => lane.getBoundingClientRect().height > 0) ? null : fallbackTrackId;
  };

  const updateMove = (clientX: number, clientY: number) => {
    const current = gesture.current;
    const rect = content.current?.getBoundingClientRect();
    if (current?.kind !== "move" || !rect) return;
    if (!current.dragging && Math.abs(clientX - current.pointerStartX) < 3) return;
    current.dragging = true;
    let timelineStart = Math.max(0, current.initialStart +
      pxToFrame(clientX - rect.left - TRACK_LABEL_WIDTH, fps, zoom) - current.pointerStartFrame);
    const destinationTrackId = trackAtPointer(clientY, current.initialTrackId);
    const destinationTrack = destinationTrackId && project.tracks.find((track) => track.id === destinationTrackId);
    let guideFrame: number | null = null;
    if (!destinationTrack || destinationTrack.locked ||
      ((destinationTrack.kind === "audio") !== (current.trackKind === "audio"))) {
      current.draftTrackId = null;
      current.draftStart = timelineStart;
      current.guideFrame = null;
      setSnapGuideFrame(null);
      setTrimDraftProject(null);
      return;
    }
    if (current.trackKind !== "audio") {
      const candidates = [
        Math.round(clock.frame),
        ...project.tracks
          .filter((track) => track.kind !== "audio")
          .flatMap((track) => track.clips)
          .filter((clip) => clip.id !== current.clipId)
          .flatMap((clip) => [clip.timelineStart, clipEnd(clip)]),
      ];
      const snapped = snapClipFrame(timelineStart, current.durationFrames, candidates, fps, zoom);
      if (snapped) {
        timelineStart = snapped.startFrame;
        guideFrame = snapped.guideFrame;
      }
    }
    current.draftStart = timelineStart;
    current.draftTrackId = destinationTrackId;
    current.guideFrame = guideFrame;
    setSnapGuideFrame(guideFrame);
    const result = applyCommand(project, {
      type: "MoveClip", clipId: current.clipId, timelineStart, trackId: destinationTrackId,
    });
    if (result.ok) setTrimDraftProject(result.project);
    else {
      current.draftTrackId = null;
      setTrimDraftProject(null);
    }
  };

  const scrollAtEdge = () => {
    edgeScrollFrame.current = null;
    const box = scroller.current;
    const pointerX = edgePointerX.current;
    const pointerY = edgePointerY.current;
    const current = gesture.current;
    if (!box || pointerX === null || pointerY === null ||
      (current?.kind !== "move" && !(current?.kind === "trim" && current.edge === "right"))) return;
    const bounds = box.getBoundingClientRect();
    const distanceToEdge = bounds.right - pointerX;
    if (bounds.width === 0 || pointerX < bounds.left || distanceToEdge > EDGE_SCROLL_ZONE) {
      edgePointerX.current = null;
      return;
    }

    const progress = (EDGE_SCROLL_ZONE - distanceToEdge) / EDGE_SCROLL_ZONE;
    const scrollBy = Math.max(1, Math.ceil(MAX_EDGE_SCROLL_PX * progress));
    box.scrollLeft = Math.min(box.scrollWidth - box.clientWidth, box.scrollLeft + scrollBy);
    if (current.kind === "move") updateMove(pointerX, pointerY);
    else updateTrim(pointerX);
    edgeScrollFrame.current = requestAnimationFrame(scrollAtEdge);
  };

  const updateEdgeScroll = (clientX: number, clientY: number) => {
    const box = scroller.current;
    const current = gesture.current;
    if (!box || (current?.kind !== "move" && !(current?.kind === "trim" && current.edge === "right"))) {
      stopEdgeScroll();
      return;
    }
    const bounds = box.getBoundingClientRect();
    if (bounds.width === 0 || clientX < bounds.right - EDGE_SCROLL_ZONE) {
      stopEdgeScroll();
      return;
    }
    edgePointerX.current = clientX;
    edgePointerY.current = clientY;
    if (edgeScrollFrame.current === null) edgeScrollFrame.current = requestAnimationFrame(scrollAtEdge);
  };

  useEffect(() => () => {
    edgePointerX.current = null;
    if (edgeScrollFrame.current !== null) cancelAnimationFrame(edgeScrollFrame.current);
  }, []);

  const finishMove = (clientX: number, clientY: number) => {
    const current = gesture.current;
    if (current?.kind !== "move") return;
    updateMove(clientX, clientY);
    if (!current.dragging) {
      seekFromPointer(clientX);
    } else if (current.draftTrackId &&
      (current.initialStart !== current.draftStart || current.initialTrackId !== current.draftTrackId)) {
      onMoveClip(current.clipId, current.draftStart, current.draftTrackId);
    }
  };

  return (
    <>
      {selectedTrack && (
        <form className="track-controls" aria-label="Selected track settings" onSubmit={(event) => {
          event.preventDefault();
          if (mutationsDisabled) return;
          const parsed = TrackNameSchema.safeParse(trackName);
          if (!parsed.success) {
            setTrackNameError("Enter a track name containing 1-80 characters.");
            return;
          }
          setTrackNameError(null);
          if (parsed.data !== selectedTrack.name) onRenameTrack(selectedTrack.id, parsed.data);
        }}>
          <label>
            Track name
            <input aria-label="Track name" value={trackName} maxLength={80}
              placeholder="Use the default track label" disabled={mutationsDisabled}
              onChange={(event) => { setTrackName(event.target.value); setTrackNameError(null); }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setTrackName(selectedTrack.name ?? "");
                  setTrackNameError(null);
                }
              }} />
          </label>
          <button type="submit" disabled={mutationsDisabled || trackName.trim() === selectedTrack.name}>Rename track</button>
          <button type="button" aria-pressed={selectedTrack.locked} disabled={mutationsDisabled}
            onClick={() => onLockTrack(selectedTrack.id, !selectedTrack.locked)}>
            {selectedTrack.locked ? "Unlock track" : "Lock track"}
          </button>
          {selectedTrack.locked && <span className="muted">Locked: clip edits and track removal are disabled.</span>}
          {trackNameError && <span role="alert" className="error">{trackNameError}</span>}
        </form>
      )}
      <div className="transport">
        <button onClick={() => clock.stepFrame(-1)} disabled={duration === 0}
          aria-label="Previous frame" title="Pause and move back one project frame (Left arrow)"><SkipBack size={16} aria-hidden="true" /></button>
        <button className="primary" onClick={() => clock.toggle()} disabled={duration === 0}         aria-label={playing ? "Pause" : "Play"}
                  title={playing ? "Pause (Space)" : "Play (Space)"}>
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <button onClick={() => clock.stepFrame(1)} disabled={duration === 0}
          aria-label="Next frame" title="Pause and move forward one project frame (Right arrow)"><SkipForward size={16} aria-hidden="true" /></button>
        <Timecode clock={clock} project={project} />
        <span className="muted">/ {formatTimecode(duration, fps)}</span>
        <button onClick={onSplit} disabled={duration === 0 || mutationsDisabled} aria-label="Split" title="Split at playhead (S)"><Scissors size={16} aria-hidden="true" /></button>
        <button onClick={onDelete} disabled={!selectedClipId || mutationsDisabled} aria-label="Delete" title="Delete selected clip (Delete)"><Trash2 size={16} aria-hidden="true" /></button>
        {onSplitAudio && (
          <button onClick={onSplitAudio} disabled={!canSplitAudio || mutationsDisabled}
            title={canSplitAudio ? "Move the selected video clip's sound to an audio track" : "Select a video clip that still plays its own sound"}>Split audio</button>
        )}
        <button onClick={onAddVisualTrack} disabled={mutationsDisabled}>Add visual track</button>
        <button onClick={onAddAudioTrack} disabled={mutationsDisabled}>Add audio track</button>
        <label className="inline">
          Speed
          <select value={rate} onChange={(e) => clock.setRate(Number(e.target.value))} aria-label="Playback speed">
            {RATES.map((r) => (
              <option key={r} value={r}>{r}×</option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        {message && <span role="alert" className="error">{message}</span>}
        <button aria-pressed={following} title="Manual horizontal scrolling turns follow off; enable to return to the playhead"
          onClick={() => {
            const next = !followEnabled.current;
            followEnabled.current = next;
            setFollowing(next);
            if (next) scrollTo(framesToPx(clock.position, fps, zoom) - 48);
          }}>Follow playhead</button>
        <button onClick={() => {
          const box = scroller.current;
          if (box) changeZoom(Math.max(1, box.clientWidth - TRACK_LABEL_WIDTH - 80) / (totalSeconds + TAIL_SECONDS), true);
        }} disabled={duration === 0} title="Show the entire timeline">Fit timeline</button>
        <button onClick={() => changeZoom(zoom / 1.5)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">−</button>
        <button onClick={() => changeZoom(zoom * 1.5)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">+</button>
      </div>
      <div className="tl-scroll" ref={scroller} tabIndex={0} role="region" aria-label="Timeline scroll area"
        onWheel={(event) => {
          if (event.deltaX !== 0 || (event.shiftKey && event.deltaY !== 0)) suspendFollow();
        }}
        onScroll={(event) => {
          const left = event.currentTarget.scrollLeft;
          if (Math.abs(left - scrollLeft.current) > 1) suspendFollow();
          scrollLeft.current = left;
          setCaptionScrollLeft(left);
        }}>
        <div
          className="tl-content"
          ref={content}
          style={{ width }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
            event.preventDefault();
            if (mutationsDisabled || !onDropAsset) {
              event.dataTransfer.dropEffect = "none";
              setAssetDropFrame(null);
              return;
            }
            clock.pause();
            event.dataTransfer.dropEffect = "copy";
            const rect = event.currentTarget.getBoundingClientRect();
            setAssetDropFrame(pxToFrame(event.clientX - rect.left - TRACK_LABEL_WIDTH, fps, zoom));
          }}
          onDragLeave={(event) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
              setAssetDropFrame(null);
            }
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
            event.preventDefault();
            setAssetDropFrame(null);
            if (mutationsDisabled || !onDropAsset) return;
            clock.pause();
            const rect = event.currentTarget.getBoundingClientRect();
            const timelineStart = pxToFrame(event.clientX - rect.left - TRACK_LABEL_WIDTH, fps, zoom);
            const lane = (event.target as HTMLElement).closest<HTMLElement>(".tl-lane");
            onDropAsset(event.dataTransfer.getData(ASSET_DRAG_TYPE), timelineStart, lane?.dataset.trackId ?? selectedTrackId);
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            const clipEl = target.closest<HTMLElement>("[data-clip-id]");
            const lane = target.closest<HTMLElement>(".tl-lane");
            if (lane?.dataset.trackId) onSelectTrack(lane.dataset.trackId);
            // Empty-space clicks keep the selected clip so Properties stays on it.
            if (clipEl?.dataset.clipId) onSelect(clipEl.dataset.clipId);
            if (target.closest("[data-trim-handle]")) return;
            if (clipEl && clipEl.dataset.trackLocked !== "true") {
              const rect = content.current?.getBoundingClientRect();
              const pointerStartFrame = rect
                ? pxToFrame(e.clientX - rect.left - TRACK_LABEL_WIDTH, fps, zoom)
                : 0;
              const clip = project.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipEl.dataset.clipId);
              const track = project.tracks.find((candidate) => candidate.clips.some((item) => item.id === clip?.id));
              if (clip && track) {
                clock.pause();
                gesture.current = {
                  kind: "move",
                  pointerId: e.pointerId,
                  pointerStartFrame,
                  pointerStartX: e.clientX,
                  initialStart: clip.timelineStart,
                  durationFrames: clipEnd(clip) - clip.timelineStart,
                  draftStart: clip.timelineStart,
                  clipId: clip.id,
                  initialTrackId: track.id,
                  draftTrackId: track.id,
                  trackKind: track.kind,
                  dragging: false,
                  guideFrame: null,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
                return;
              }
            }
            gesture.current = { kind: "scrub" };
            e.currentTarget.setPointerCapture(e.pointerId);
            seekFromPointer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (gesture.current?.kind === "trim") {
              updateTrim(e.clientX);
              updateEdgeScroll(e.clientX, e.clientY);
            } else if (gesture.current?.kind === "move") {
              updateMove(e.clientX, e.clientY);
              updateEdgeScroll(e.clientX, e.clientY);
            }
            else if (gesture.current?.kind === "scrub") seekFromPointer(e.clientX);
          }}
          onPointerUp={(event) => {
            stopEdgeScroll();
            if (gesture.current?.kind === "trim") updateTrim(event.clientX);
            const current = gesture.current;
            if (current?.kind === "trim" &&
              (current.initial.sourceIn !== current.draft.sourceIn || current.initial.sourceOut !== current.draft.sourceOut)) {
              onTrim(current.draft.clipId, current.draft.sourceIn, current.draft.sourceOut);
            }
            if (current?.kind === "move") finishMove(event.clientX, event.clientY);
            gesture.current = null;
            setTrimDraftProject(null);
            setSnapGuideFrame(null);
          }}
          onPointerCancel={() => {
            stopEdgeScroll();
            gesture.current = null;
            setTrimDraftProject(null);
            setSnapGuideFrame(null);
          }}
        >
          <div className="tl-ruler">
            <span className="tl-track-label">Visual tracks</span>
            {ticks.map((t) => (
              <span key={t.seconds} className="tl-tick" style={{ left: TRACK_LABEL_WIDTH + t.px }}>{t.label}</span>
            ))}
          </div>
          {tracks.length === 0 && <p className="placeholder tl-empty">Add a clip from the Assets pane to start.</p>}
          {laneTracks.map((track) => (
            <div
              key={track.id}
              className={`tl-lane${track.locked ? " locked-track" : ""}${track.kind === "audio" ? " audio-lane" : ""}${track.muted ? " muted" : ""}${track.id === selectedTrackId ? " selected-track" : ""}`}
              data-track-id={track.id}
              data-track-locked={track.locked}
              data-track-selected={track.id === selectedTrackId}
            >
              {track.kind === "audio" && (
                <div className="tl-track-label">
                  <button
                    className="tl-track-select"
                    title={`${track.name ?? `Audio ${audioTracks.indexOf(track) + 1}`}${track.locked ? " (locked)" : ""}`}
                    aria-label={`Select audio track ${audioTracks.indexOf(track) + 1}`}
                    aria-pressed={track.id === selectedTrackId}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onSelectTrack(track.id)}
                  >{track.locked ? "[L] " : ""}{track.name ?? `Audio ${audioTracks.indexOf(track) + 1}`}</button>
                  <button
                    aria-label={`${track.muted ? "Unmute" : "Mute"} audio track ${audioTracks.indexOf(track) + 1}`}
                    disabled={mutationsDisabled}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onToggleTrackMuted(track.id, !track.muted)}
                  >{track.muted ? "Unmute" : "Mute"}</button>
                  <button
                    aria-label={`Move audio track ${audioTracks.indexOf(track) + 1} up`}
                    disabled={mutationsDisabled || audioTracks.indexOf(track) === 0}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onReorderAudioTrack(track.id, 1)}
                  >↑</button>
                  <button
                    aria-label={`Move audio track ${audioTracks.indexOf(track) + 1} down`}
                    disabled={mutationsDisabled || audioTracks.indexOf(track) === audioTracks.length - 1}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onReorderAudioTrack(track.id, -1)}
                  >↓</button>
                  <button
                    aria-label={`Remove audio track ${audioTracks.indexOf(track) + 1}`}
                    title={track.locked ? "Unlock the track before removing it" : track.clips.length > 0 ? "Remove the track's clips before removing it" : "Remove this empty track"}
                    disabled={mutationsDisabled || track.locked || track.clips.length > 0}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onRemoveTrack(track.id)}
                  >×</button>
                </div>
              )}
              {track.kind !== "audio" && (
                <div className="tl-track-label">
                  <button
                    className="tl-track-select"
                    title={`${track.name ?? `${track.kind === "video" ? "Video" : "Overlay"} ${visualTracks.indexOf(track) + 1}`}${track.locked ? " (locked)" : ""}`}
                    aria-label={`Select ${track.kind} track ${visualTracks.indexOf(track) + 1}`}
                    aria-pressed={track.id === selectedTrackId}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onSelectTrack(track.id)}
                  >{track.locked ? "[L] " : ""}{track.name ?? `${track.kind === "video" ? "Video" : "Overlay"} ${visualTracks.indexOf(track) + 1}`}</button>
                  <button
                    aria-label={`${track.muted ? "Unmute" : "Mute"} ${track.kind} track ${visualTracks.indexOf(track) + 1}`}
                    title={track.muted ? "Play this track's video sound again" : "Silence this track's video sound (picture stays visible)"}
                    aria-pressed={track.muted}
                    disabled={mutationsDisabled}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onToggleTrackMuted(track.id, !track.muted)}
                  >{track.muted ? "Unmute" : "Mute"}</button>
                  <button
                    aria-label={`Raise ${track.kind} track ${visualTracks.indexOf(track) + 1}`}
                    title="Bring this track in front"
                    disabled={mutationsDisabled || visualTracks.indexOf(track) === 0}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onReorderVisualTrack(track.id, 1)}
                  >↑</button>
                  <button
                    aria-label={`Lower ${track.kind} track ${visualTracks.indexOf(track) + 1}`}
                    title="Send this track behind"
                    disabled={mutationsDisabled || visualTracks.indexOf(track) === visualTracks.length - 1}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onReorderVisualTrack(track.id, -1)}
                  >↓</button>
                  <button
                    aria-label={`Remove ${track.kind} track ${visualTracks.indexOf(track) + 1}`}
                    title={track.locked ? "Unlock the track before removing it" : track.clips.length > 0 ? "Remove the track's clips before removing it" : "Remove this empty track"}
                    disabled={mutationsDisabled || track.locked || track.clips.length > 0}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => onRemoveTrack(track.id)}
                  >×</button>
                </div>
              )}
              {track.clips.map((clip) => {
                const asset = project.assets.find((a) => a.id === clip.assetId);
                const clipZoom = track.kind === "audio" ? undefined
                  : zoomDraft?.clipId === clip.id ? zoomDraft.zoom ?? undefined : clip.zoom;
                const zoomStart = clipZoom && Math.min(100, Math.max(0, clipZoom.startPercent));
                const zoomEnd = clipZoom && Math.min(100, Math.max(0, clipZoom.endPercent));
                const zoomLabel = clipZoom
                  ? `Zoom ${Math.round(clipZoom.startScale * 100)}% → ${Math.round(clipZoom.endScale * 100)}%`
                  : "";
                return (
                  <div
                    key={clip.id}
                    data-clip-id={clip.id}
                    data-track-kind={track.kind}
                    data-track-locked={track.locked}
                    className={`tl-clip${track.kind === "audio" ? " audio" : ""}${clip.id === selectedClipId ? " selected" : ""}${offline.has(clip.assetId) ? " offline" : ""}${gesture.current?.kind === "move" && gesture.current.clipId === clip.id && gesture.current.initialTrackId !== gesture.current.draftTrackId ? " moving" : ""}`}
                    style={{
                      left: TRACK_LABEL_WIDTH + framesToPx(clip.timelineStart, fps, zoom),
                      width: framesToPx(clipDuration(clip), fps, zoom),
                    }}
                    title={`${offline.has(clip.assetId) ? `${asset?.name ?? "Media"} (offline)` : asset?.name ?? ""}${track.kind !== "audio" && !clip.audioLinked ? " · sound on audio track" : ""}${zoomLabel ? ` · ${zoomLabel}` : ""}`}
                  >
                    {asset?.name ?? "Missing media"}
                    {clipZoom && zoomStart !== undefined && zoomEnd !== undefined && (
                      <span className="tl-zoom" data-testid={`zoom-markers-${clip.id}`} aria-label={zoomLabel}>
                        <span className="tl-zoom-range" style={{ left: `${zoomStart}%`, width: `${zoomEnd - zoomStart}%` }} />
                        {clipZoom.startPercent >= 0 && clipZoom.startPercent <= 100 && (
                          <span className="tl-zoom-point start" data-testid={`zoom-start-${clip.id}`} style={{ left: `${zoomStart}%` }} />
                        )}
                        {clipZoom.endPercent >= 0 && clipZoom.endPercent <= 100 && (
                          <span className="tl-zoom-point end" data-testid={`zoom-end-${clip.id}`} style={{ left: `${zoomEnd}%` }} />
                        )}
                      </span>
                    )}
                    {!mutationsDisabled && !track.locked && (
                      <>
                        <button
                          className="tl-trim-handle left"
                          data-trim-handle="left"
                          aria-label={`Trim start of ${asset?.name ?? "clip"}`}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            clock.pause();
                            const initial = { clipId: clip.id, timelineStart: clip.timelineStart, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut };
                            const rect = content.current?.getBoundingClientRect();
                            const pointerStartFrame = rect
                              ? pxToFrame(event.clientX - rect.left - TRACK_LABEL_WIDTH, fps, zoom)
                              : clip.timelineStart;
                            gesture.current = { kind: "trim", pointerId: event.pointerId, pointerStartFrame, initial, draft: initial, edge: "left" };
                            setTrimDraftProject(project);
                            content.current?.setPointerCapture(event.pointerId);
                            onSelect(clip.id);
                          }}
                        />
                        <button
                          className="tl-trim-handle right"
                          data-trim-handle="right"
                          aria-label={`Trim end of ${asset?.name ?? "clip"}`}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            clock.pause();
                            const initial = { clipId: clip.id, timelineStart: clip.timelineStart, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut };
                            const rect = content.current?.getBoundingClientRect();
                            const pointerStartFrame = rect
                              ? pxToFrame(event.clientX - rect.left - TRACK_LABEL_WIDTH, fps, zoom)
                              : clipEnd(clip);
                            gesture.current = { kind: "trim", pointerId: event.pointerId, pointerStartFrame, initial, draft: initial, edge: "right" };
                            setTrimDraftProject(project);
                            content.current?.setPointerCapture(event.pointerId);
                            onSelect(clip.id);
                          }}
                        />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="tl-playhead" ref={head} aria-hidden="true" />
          {assetDropFrame !== null && (
            <div
              className="tl-snap-guide"
              style={{ left: TRACK_LABEL_WIDTH + framesToPx(assetDropFrame, fps, zoom) }}
              aria-hidden="true"
            />
          )}
          {snapGuideFrame !== null && (
            <div
              className="tl-snap-guide"
              style={{ left: TRACK_LABEL_WIDTH + framesToPx(snapGuideFrame, fps, zoom) }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      {onCaptionCommands && <CaptionWorkspace project={project} clock={clock} zoom={zoom} width={width}
        labelWidth={TRACK_LABEL_WIDTH} scrollLeft={captionScrollLeft}
        onScroll={(delta) => { suspendFollow(); scrollTo(scrollLeft.current + delta); }}
        onCommands={onCaptionCommands} disabled={mutationsDisabled} onExpand={onCaptionExpand} />}
    </>
  );
}
