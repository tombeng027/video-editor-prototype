import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@ve/schema";
import { clipEnd, formatTimecode } from "@ve/timeline-core";
import type { PlayheadClock } from "../clock.js";
import { timelineDuration } from "../playback.js";
import { DEFAULT_ZOOM, clampZoom, framesToPx, pxToFrame, rulerTicks } from "../timelineMath.js";
import { useClockState, useClockTick } from "../useClock.js";

type Props = {
  project: Project;
  clock: PlayheadClock;
  selectedClipId: string | null;
  offline: ReadonlySet<string>;
  message: string | null;
  onSelect: (clipId: string | null) => void;
  onSplit: () => void;
  onDelete: () => void;
};

const RATES = [0.5, 1, 1.5, 2];
const TAIL_SECONDS = 5;

function Timecode({ clock, project }: { clock: PlayheadClock; project: Project }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fps = project.settings.fps;
  const update = useCallback(() => {
    if (ref.current) ref.current.textContent = formatTimecode(clock.frame, fps);
  }, [clock, fps]);
  useClockTick(clock, update);
  return <span className="timecode" ref={ref} aria-label="Playhead time" />;
}

export function Timeline({ project, clock, selectedClipId, offline, message, onSelect, onSplit, onDelete }: Props) {
  const fps = project.settings.fps;
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const { playing, rate } = useClockState(clock);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const duration = timelineDuration(project);
  const totalSeconds = (duration * fps.den) / fps.num;
  const width = Math.max(framesToPx(duration, fps, zoom) + TAIL_SECONDS * zoom, 400);
  const ticks = useMemo(() => rulerTicks(totalSeconds + TAIL_SECONDS, fps, zoom), [totalSeconds, fps, zoom]);
  const tracks = [...project.tracks].sort((a, b) => b.order - a.order);

  useEffect(() => clock.configure(fps, duration), [clock, fps, duration]);

  const placeHead = useCallback(() => {
    const el = head.current;
    if (!el) return;
    const x = framesToPx(clock.position, fps, zoom);
    el.style.transform = `translateX(${x}px)`;
    const box = scroller.current;
    if (box && clock.playing && (x > box.scrollLeft + box.clientWidth - 24 || x < box.scrollLeft)) {
      box.scrollLeft = Math.max(0, x - 48);
    }
  }, [clock, fps, zoom]);
  useClockTick(clock, placeHead);

  const seekFromPointer = (clientX: number) => {
    const rect = content.current?.getBoundingClientRect();
    if (rect) clock.seek(pxToFrame(clientX - rect.left, fps, zoom));
  };

  return (
    <>
      <div className="transport">
        <button onClick={() => clock.toggle()} disabled={duration === 0} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "Pause" : "Play"}
        </button>
        <Timecode clock={clock} project={project} />
        <span className="muted">/ {formatTimecode(duration, fps)}</span>
        <button onClick={onSplit} disabled={duration === 0} title="Split at playhead (S)">Split</button>
        <button onClick={onDelete} disabled={!selectedClipId} title="Delete selected clip (Delete)">Delete</button>
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
        <button onClick={() => setZoom((z) => clampZoom(z / 1.5))} aria-label="Zoom out">−</button>
        <button onClick={() => setZoom((z) => clampZoom(z * 1.5))} aria-label="Zoom in">+</button>
      </div>
      <div className="tl-scroll" ref={scroller}>
        <div
          className="tl-content"
          ref={content}
          style={{ width }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const clipEl = (e.target as HTMLElement).closest<HTMLElement>("[data-clip-id]");
            onSelect(clipEl?.dataset.clipId ?? null);
            seekFromPointer(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && seekFromPointer(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          <div className="tl-ruler">
            {ticks.map((t) => (
              <span key={t.seconds} className="tl-tick" style={{ left: t.px }}>{t.label}</span>
            ))}
          </div>
          {tracks.length === 0 && <p className="placeholder tl-empty">Add a clip from the Assets pane to start.</p>}
          {tracks.map((track) => (
            <div key={track.id} className="tl-lane" data-track-id={track.id}>
              {track.clips.map((clip) => {
                const asset = project.assets.find((a) => a.id === clip.assetId);
                return (
                  <div
                    key={clip.id}
                    data-clip-id={clip.id}
                    className={`tl-clip${clip.id === selectedClipId ? " selected" : ""}${offline.has(clip.assetId) ? " offline" : ""}`}
                    style={{ left: framesToPx(clip.timelineStart, fps, zoom), width: framesToPx(clipEnd(clip) - clip.timelineStart, fps, zoom) }}
                    title={offline.has(clip.assetId) ? `${asset?.name ?? "Media"} (offline)` : asset?.name}
                  >
                    {asset?.name ?? "Missing media"}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="tl-playhead" ref={head} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}
