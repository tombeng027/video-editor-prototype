import { useEffect, useRef, useState, type ReactNode } from "react";
import { ANIMATION_CATALOG, animationDurationError, ClipAnimationsSchema, ClipSpeedSchema, ClipVolumeSchema, ClipZoomSchema, TransformSchema,
  ZOOM_SCALE_MAX, ZOOM_SCALE_MIN, type ClipAnimations, type ClipZoom, type Asset, type Clip, type Project, type Track,
  type Transform } from "@ve/schema";
import { clipDuration, findClip, formatTimecode } from "@ve/timeline-core";
import { CropProperties } from "./CropProperties.js";
import type { CropControls } from "../cropEdit.js";

type Props = {
  project: Project;
  selectedClipId: string | null;
  disabledReason?: string;
  onTransform: (clipId: string, transform?: Transform) => void;
  /** Unsaved appearance shown in Preview while dragging; null restores the saved appearance. */
  onAppearancePreview?: (clipId: string, transform: Transform | null) => void;
  onSpeed: (clipId: string, speed: number) => void;
  /** Saves the clip's own sound level; undefined resets it to 100%. */
  onVolume?: (clipId: string, volume?: number) => void;
  onAnimations: (clipId: string, animations?: ClipAnimations) => void;
  onZoom?: (clipId: string, zoom?: ClipZoom) => void;
  /** Unsaved zoom shown in Preview; null previews no zoom and undefined restores the saved zoom. */
  onZoomPreview?: (clipId: string, zoom: ClipZoom | null | undefined) => void;
  /** Current timeline frame, read when setting a zoom point at the playhead. */
  playheadFrame?: () => number;
  /** Appearance being dragged on the canvas; shown read-only in the sliders until it is saved. */
  liveTransform?: Transform | null;
  cropControls?: CropControls;
};

type Settle = "drag" | "step" | "type" | "settle";
const STEP_COMMIT_DELAY_MS = 400;
const clean = (value: number) => String(Number(value.toFixed(6)));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Debounces rapid -/+ clicks into one commit; a pending burst still commits on unmount. */
function useStepCommit(commit: () => void, onIdleUnmount?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const idleRef = useRef(onIdleUnmount);
  idleRef.current = onIdleUnmount;
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); commitRef.current(); }
    else idleRef.current?.();
  }, []);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return {
    cancel,
    flush: () => { cancel(); commitRef.current(); },
    schedule: () => { cancel(); timer.current = setTimeout(() => { timer.current = null; commitRef.current(); }, STEP_COMMIT_DELAY_MS); },
  };
}

/** State mirrored in a ref so delayed commits read the latest value. */
function useLatest<T>(initial: T | (() => T)) {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const set = (next: T) => { ref.current = next; setValue(next); };
  return [value, set, ref] as const;
}

function SliderField({ label, value, min, max, sliderMin = min, sliderMax = max, step = 1, slider = true, onValue, onSettle }: {
  label: string; value: string; min: number; max: number; sliderMin?: number; sliderMax?: number; step?: number;
  /** False when a shared RangeBar provides the slider. */
  slider?: boolean;
  onValue: (value: string, kind: Settle) => void; onSettle?: () => void;
}) {
  const numeric = Number(value);
  const nudge = (delta: number) => {
    const base = value.trim() !== "" && Number.isFinite(numeric) ? numeric : min;
    onValue(clean(clamp(Math.round(base / step) * step + delta * step, min, max)), "step");
  };
  return <div className="slider-field">
    <label>{label}<input type="number" min={min} max={max} step="any" value={value} required
      onChange={(event) => onValue(event.target.value, "type")} onBlur={onSettle} /></label>
    <div className="slider-row">
      <button type="button" aria-label={`Decrease ${label}`} onClick={() => nudge(-1)}>−</button>
      {slider ? <input type="range" aria-label={`${label} slider`} min={sliderMin} max={sliderMax} step={step}
        value={Number.isFinite(numeric) ? clamp(numeric, sliderMin, sliderMax) : sliderMin}
        onChange={(event) => onValue(event.target.value, "drag")}
        onPointerUp={onSettle} onKeyUp={onSettle} onBlur={onSettle} /> : <span className="slider-spacer" />}
      <button type="button" aria-label={`Increase ${label}`} onClick={() => nudge(1)}>+</button>
    </div>
  </div>;
}

type BarHandle = { label: string; value: number; onChange: (value: number) => void };
type Side = "start" | "end";

/**
 * Chooses which handle a press on the bar controls. When both handles sit within `overlap`
 * bar units of the press point (e.g. they meet), the choice waits for the drag direction:
 * left moves the start handle and right moves the end handle, so neither can get stuck under the other.
 */
export function pickBarHandle(position: number, startPosition: number | undefined, endPosition: number | undefined,
  overlap: number): Side | "undecided" | null {
  if (startPosition === undefined) return endPosition === undefined ? null : "end";
  if (endPosition === undefined) return "start";
  const toStart = Math.abs(position - startPosition), toEnd = Math.abs(position - endPosition);
  if (Math.abs(startPosition - endPosition) <= overlap && Math.min(toStart, toEnd) <= overlap) return "undecided";
  return toStart <= toEnd ? "start" : "end";
}

const THUMB_PX = 16;

/**
 * One track with two handles. The end handle can measure from the right edge (`reverseEnd`),
 * so entrance grows from the left and exit from the right on the same bar.
 */
function RangeBar({ min, max, step = 1, start, end, reverseEnd = false, fills, disabled = false, onSettle }: {
  min: number; max: number; step?: number; start?: BarHandle; end?: BarHandle; reverseEnd?: boolean;
  /** Highlighted spans in bar units, measured from the left. */
  fills: [number, number][];
  disabled?: boolean;
  onSettle?: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ side: Side | "undecided"; x: number } | null>(null);
  const span = max - min || 1;
  const pct = (value: number) => `${clamp((value - min) / span * 100, 0, 100)}%`;
  const handles = { start, end };
  const positionOf = (side: Side) => {
    const handle = handles[side];
    if (!handle) return undefined;
    return side === "end" && reverseEnd ? max - (handle.value - min) : handle.value;
  };
  const setPosition = (side: Side, position: number) => {
    const handle = handles[side];
    if (!handle) return;
    const snapped = clamp(Math.round((position - min) / step) * step + min, min, max);
    handle.onChange(Number((side === "end" && reverseEnd ? max - (snapped - min) : snapped).toFixed(6)));
  };
  const pointerPosition = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect();
    const usable = rect.width - THUMB_PX;
    return usable > 0 ? min + clamp((clientX - rect.left - THUMB_PX / 2) / usable, 0, 1) * span : undefined;
  };
  const focusHandle = (side: Side) => bar.current?.querySelector<HTMLElement>(`[data-side="${side}"]`)?.focus();

  return <div ref={bar} className={`range-bar${disabled ? " disabled" : ""}`}
    onPointerDown={(event) => {
      if (disabled || event.button !== 0) return;
      const position = pointerPosition(event.clientX);
      const rect = bar.current!.getBoundingClientRect();
      if (position === undefined) return;
      const overlap = THUMB_PX / Math.max(1, rect.width - THUMB_PX) * span;
      const side = pickBarHandle(position, positionOf("start"), positionOf("end"), overlap);
      if (!side) return;
      event.preventDefault();
      bar.current!.setPointerCapture?.(event.pointerId);
      drag.current = { side, x: event.clientX };
      if (side !== "undecided") {
        focusHandle(side);
        // Pressing a thumb grabs it; pressing the empty track jumps the nearer handle there.
        if (Math.abs(position - positionOf(side)!) > overlap / 2) setPosition(side, position);
      }
    }}
    onPointerMove={(event) => {
      const current = drag.current;
      if (!current) return;
      if (current.side === "undecided") {
        if (event.clientX === current.x) return;
        current.side = event.clientX < current.x ? "start" : "end";
        focusHandle(current.side);
      }
      const position = pointerPosition(event.clientX);
      if (position !== undefined) setPosition(current.side, position);
    }}
    onPointerUp={(event) => {
      if (!drag.current) return;
      drag.current = null;
      bar.current?.releasePointerCapture?.(event.pointerId);
      onSettle?.();
    }}
    onPointerCancel={() => { if (drag.current) { drag.current = null; onSettle?.(); } }}>
    <div className="range-bar-track" aria-hidden="true">
      {fills.map(([from, to], index) => <span key={index} className="range-bar-fill"
        style={{ left: pct(from), width: `calc(${pct(to)} - ${pct(from)})` }} />)}
    </div>
    {(["start", "end"] as const).map((side) => {
      const handle = handles[side];
      if (!handle) return null;
      const position = positionOf(side)!;
      return <span key={side} role="slider" data-side={side} className={`range-bar-thumb ${side}`}
        aria-label={`${handle.label} slider`} aria-valuemin={min} aria-valuemax={max} aria-valuenow={handle.value}
        aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
        style={{ left: `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${clamp((position - min) / span, 0, 1)})` }}
        onKeyDown={(event) => {
          if (disabled) return;
          const delta = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[event.key];
          const target = delta !== undefined ? position + delta : event.key === "Home" ? min : event.key === "End" ? max : undefined;
          if (target === undefined) return;
          event.preventDefault();
          setPosition(side, target);
        }}
        onKeyUp={() => onSettle?.()} />;
    })}
  </div>;
}

const APPEARANCE = [
  { key: "scale", label: "Zoom (%)", min: 1, max: 1000, sliderMin: 10, sliderMax: 400 },
  { key: "x", label: "Center X (%)", min: -1000, max: 1000, sliderMin: -100, sliderMax: 200 },
  { key: "y", label: "Center Y (%)", min: -1000, max: 1000, sliderMin: -100, sliderMax: 200 },
  { key: "opacity", label: "Opacity (%)", min: 0, max: 100, sliderMin: 0, sliderMax: 100 },
] as const;
type AppearanceValues = Record<(typeof APPEARANCE)[number]["key"], string>;
type ZoomValues = { start: string; end: string; startScale: string; endScale: string };
const ZOOM_DEFAULT: ZoomValues = { start: "25", end: "75", startScale: "100", endScale: "150" };
const ZOOM_ERROR = "Keep the zoom start point before the end point and each scale from 25% to 400%.";
type SectionState = { open: ReadonlySet<string>; onToggle: (name: string, open: boolean) => void };

/** A collapsible section whose open state survives saves; only a new selection collapses it. */
function Section({ name, sections, children }: { name: string; sections: SectionState; children: ReactNode }) {
  return <details open={sections.open.has(name)} onToggle={(event) => sections.onToggle(name, event.currentTarget.open)}>
    <summary>{name}</summary>
    {children}
  </details>;
}

function PropertiesForm({ clip, track, asset, project, disabledReason, onTransform, onAppearancePreview, onSpeed, onVolume, onAnimations,
  onZoom, onZoomPreview, playheadFrame, liveTransform, cropControls, sections }:
  Omit<Props, "selectedClipId"> & { clip: Clip; track: Track; asset: Asset; sections: SectionState }) {
  const [speed, setSpeed, speedRef] = useLatest(String(clip.speed));
  const current = clip.transform ?? { x: 0.5, y: 0.5, scale: 1, opacity: 1 };
  const percent = (value: number) => String(Number((value * 100).toFixed(6)));
  const [appearance, setAppearance, appearanceRef] = useLatest<AppearanceValues>(() => ({
    x: percent(current.x), y: percent(current.y), scale: percent(current.scale), opacity: percent(current.opacity),
  }));
  const [error, setError] = useState<string | null>(null);
  const fps = project.settings.fps.num / project.settings.fps.den;
  const clipFrames = clipDuration(clip);
  const savedPercent = (saved: ClipAnimations["entrance"] | ClipAnimations["exit"]) => !saved ? undefined
    : "durationPercent" in saved ? saved.durationPercent : Number((saved.durationFrames / clipFrames * 100).toFixed(2));
  const defaultPercent = Math.min(50, Math.max(1, Math.round(ANIMATION_CATALOG[0]!.defaultSeconds * fps / clipFrames * 100)));
  const [animationDraft, setAnimationDraft] = useState(() => ({
    entrance: { id: clip.animations?.entrance?.id ?? "none", percent: String(savedPercent(clip.animations?.entrance) ?? defaultPercent) },
    exit: { id: clip.animations?.exit?.id ?? "none", percent: String(savedPercent(clip.animations?.exit) ?? defaultPercent) },
  }));
  const reason = disabledReason ?? (track.locked ? "Unlock this track to change clip properties." : undefined);
  const disabled = Boolean(reason);
  // Avoids resending an identical edit (e.g. blur right after release) before the confirmed clip arrives.
  const sent = useRef<{ speed?: number; zoom?: string; volume?: number }>({});
  const [volume, setVolume, volumeRef] = useLatest(String(Math.round((clip.volume ?? 1) * 100)));
  const hasSound = asset.hasAudio && (track.kind === "audio" || clip.audioLinked);

  const commitVolume = () => {
    if (disabled || !onVolume) return;
    const raw = volumeRef.current;
    const parsed = ClipVolumeSchema.safeParse(raw.trim() === "" ? NaN : Number(raw) / 100);
    if (!parsed.success) { setError("Enter a clip volume from 0% to 100%."); return; }
    setError(null);
    if (parsed.data !== (clip.volume ?? 1) && sent.current.volume !== parsed.data) {
      sent.current.volume = parsed.data;
      onVolume(clip.id, parsed.data === 1 ? undefined : parsed.data);
    }
  };
  const volumeStep = useStepCommit(commitVolume);
  const changeVolume = (value: string, kind: Settle) => {
    if (disabled) return;
    setVolume(value);
    if (kind === "step") volumeStep.schedule();
  };

  const commitSpeed = () => {
    if (disabled) return;
    const raw = speedRef.current;
    const parsed = ClipSpeedSchema.safeParse(raw.trim() === "" ? NaN : Number(raw));
    if (!parsed.success) { setError("Enter a clip speed from 0.25x to 4x."); return; }
    setError(null);
    if (parsed.data !== clip.speed && sent.current.speed !== parsed.data) {
      sent.current.speed = parsed.data;
      onSpeed(clip.id, parsed.data);
    }
  };
  const speedStep = useStepCommit(commitSpeed);
  const changeSpeed = (value: string, kind: Settle) => {
    if (disabled) return;
    setSpeed(value);
    if (kind === "step") speedStep.schedule();
  };

  const parseAppearance = (values: AppearanceValues) => {
    if (Object.values(values).some((value) => value.trim() === "")) return null;
    const parsed = TransformSchema.safeParse({
      x: Number(values.x) / 100, y: Number(values.y) / 100, scale: Number(values.scale) / 100, opacity: Number(values.opacity) / 100,
    });
    return parsed.success ? parsed.data : null;
  };
  const commitAppearance = () => {
    if (disabled || cropControls?.active) return;
    const parsed = parseAppearance(appearanceRef.current);
    if (!parsed) {
      setError("Use position -1000 to 1000%, zoom 1 to 1000%, and opacity 0 to 100%.");
      return;
    }
    setError(null);
    if (parsed.x !== current.x || parsed.y !== current.y || parsed.scale !== current.scale || parsed.opacity !== current.opacity) {
      onTransform(clip.id, parsed);
    } else {
      onAppearancePreview?.(clip.id, null);
    }
  };
  // A pending -/+ burst still saves when the selection changes; otherwise drop any unsaved preview.
  const appearanceStep = useStepCommit(commitAppearance, () => onAppearancePreview?.(clip.id, null));
  const changeAppearance = (key: keyof AppearanceValues, value: string, kind: Settle) => {
    if (disabled || cropControls?.active) return;
    const next = { ...appearanceRef.current, [key]: value };
    setAppearance(next);
    const parsed = parseAppearance(next);
    if (!parsed) {
      setError("Use position -1000 to 1000%, zoom 1 to 1000%, and opacity 0 to 100%.");
      return;
    }
    setError(null);
    onAppearancePreview?.(clip.id, parsed);
    if (kind === "step") appearanceStep.schedule();
  };

  const animationActive = { entrance: animationDraft.entrance.id !== "none", exit: animationDraft.exit.id !== "none" };
  const animationPercent = (phase: "entrance" | "exit") => animationActive[phase] ? Number(animationDraft[phase].percent) || 0 : 0;
  const setAnimationPercent = (phase: "entrance" | "exit", value: string) =>
    setAnimationDraft((previous) => ({ ...previous, [phase]: { ...previous[phase], percent: value } }));
  const barHandle = (phase: "entrance" | "exit"): BarHandle | undefined => {
    if (!animationActive[phase]) return undefined;
    const other = animationPercent(phase === "entrance" ? "exit" : "entrance");
    return { label: `${phase === "entrance" ? "Entrance" : "Exit"} length (% of clip)`, value: animationPercent(phase),
      onChange: (value) => setAnimationPercent(phase, clean(clamp(value, 1, Math.max(1, 100 - other)))) };
  };

  const [zoom, setZoom, zoomRef] = useLatest<ZoomValues | null>(() => clip.zoom ? {
    start: clean(clip.zoom.startPercent), end: clean(clip.zoom.endPercent),
    startScale: percent(clip.zoom.startScale), endScale: percent(clip.zoom.endScale),
  } : null);
  const parseZoom = (values: ZoomValues) => {
    if (Object.values(values).some((value) => value.trim() === "")) return null;
    const parsed = ClipZoomSchema.safeParse({ version: 1, startPercent: Number(values.start), endPercent: Number(values.end),
      startScale: Number(values.startScale) / 100, endScale: Number(values.endScale) / 100 });
    return parsed.success ? parsed.data : null;
  };
  const sendZoom = (next: ClipZoom | undefined) => {
    const key = JSON.stringify(next ?? null);
    if (key === JSON.stringify(clip.zoom ?? null) || sent.current.zoom === key) { onZoomPreview?.(clip.id, undefined); return; }
    sent.current.zoom = key;
    onZoom?.(clip.id, next);
  };
  const commitZoom = () => {
    if (disabled || !zoomRef.current) return;
    const parsed = parseZoom(zoomRef.current);
    if (!parsed) { setError(ZOOM_ERROR); return; }
    setError(null);
    sendZoom(parsed);
  };
  const zoomStep = useStepCommit(commitZoom, () => onZoomPreview?.(clip.id, undefined));
  const changeZoom = (key: keyof ZoomValues, value: string, kind: Settle) => {
    if (disabled || !zoomRef.current) return;
    const next = { ...zoomRef.current, [key]: value };
    setZoom(next);
    const parsed = parseZoom(next);
    if (!parsed) { setError(ZOOM_ERROR); return; }
    setError(null);
    onZoomPreview?.(clip.id, parsed);
    if (kind === "step") zoomStep.schedule();
    else if (kind === "settle") zoomStep.flush();
  };
  const zoomPoint = (side: "start" | "end") => Number(zoom?.[side]);
  // Handles keep at least 1% apart so the start always stays before the end.
  const zoomHandle = (side: "start" | "end"): BarHandle | undefined => zoom ? {
    label: `Zoom ${side} point (% of clip)`, value: clamp(zoomPoint(side), 0, 100),
    onChange: (value) => changeZoom(side, clean(side === "start"
      ? clamp(value, 0, Math.max(0, zoomPoint("end") - 1)) : clamp(value, Math.min(100, zoomPoint("start") + 1), 100)), "drag"),
  } : undefined;
  const setPointAtPlayhead = (side: "start" | "end") => {
    const frame = (playheadFrame?.() ?? clip.timelineStart) - clip.timelineStart;
    if (frame < 0 || frame > clipFrames) { setError("Move the playhead inside this clip, then set the zoom point."); return; }
    const value = clean(Number((frame / clipFrames * 100).toFixed(2)));
    const other = zoomPoint(side === "start" ? "end" : "start");
    if (side === "start" ? Number(value) >= other : Number(value) <= other) {
      setError(`The zoom ${side} point must stay ${side === "start" ? "before the end" : "after the start"} point.`);
      return;
    }
    changeZoom(side, value, "settle");
  };

  return <>
    <strong>{asset.name}</strong>
    <dl className="clip-info">
      <dt>Track</dt><dd>{track.name ?? track.kind}</dd>
      <dt>Start</dt><dd>{formatTimecode(clip.timelineStart, project.settings.fps)}</dd>
      <dt>Duration</dt><dd>{formatTimecode(clipDuration(clip), project.settings.fps)}</dd>
      <dt>Playback speed</dt><dd>{clip.speed}x</dd>
    </dl>
    {reason && <p className="muted">{reason}</p>}
    {asset.kind !== "image" && <form aria-label="Clip speed" onSubmit={(event) => {
      event.preventDefault();
      speedStep.flush();
    }}>
      <fieldset disabled={disabled}>
        <legend>Speed</legend>
        <SliderField label="Clip speed (x)" value={speed} min={0.25} max={4} step={0.05}
          onValue={changeSpeed} onSettle={speedStep.flush} />
        <p className="muted">Releasing the slider, leaving the box or pressing Enter saves; − / + change by 0.05x. Preserves audio pitch. Changes duration and shifts later clips on this track only; other tracks stay fixed.</p>
      </fieldset>
    </form>}
    {hasSound && onVolume && <form aria-label="Clip volume" onSubmit={(event) => {
      event.preventDefault();
      volumeStep.flush();
    }}>
      <fieldset disabled={disabled}>
        <legend>Volume</legend>
        <SliderField label="Clip volume (%)" value={volume} min={0} max={100} step={1}
          onValue={changeVolume} onSettle={volumeStep.flush} />
        <p className="muted">Lowers this clip's own sound in Preview and export, e.g. background music under a voice-over. Releasing the slider, leaving the box or pressing Enter saves one Undo step. Split keeps the volume on both halves.</p>
      </fieldset>
    </form>}
    {track.kind !== "audio" && <form aria-label="Clip appearance" onSubmit={(event) => {
      event.preventDefault();
      appearanceStep.flush();
    }}>
      <Section name="Appearance" sections={sections}>
      <fieldset disabled={disabled || cropControls?.active}>
        <legend>Appearance</legend>
        {cropControls?.active && <p className="muted">Exit Crop mode before moving or resizing the picture.</p>}
        {APPEARANCE.map((field) => <SliderField key={field.key} label={field.label}
          value={liveTransform ? percent(liveTransform[field.key]) : appearance[field.key]}
          min={field.min} max={field.max} sliderMin={field.sliderMin} sliderMax={field.sliderMax}
          onValue={(value, kind) => changeAppearance(field.key, value, kind)} onSettle={appearanceStep.flush} />)}
        <p className="muted">Preview updates while you drag; releasing a slider, leaving a box or pressing Enter saves one Undo step. − / + change by 1%. Sliders show common ranges; type a value for the full range.</p>
        <p className="muted">50% / 50% centers the fitted image. Applies to this clip in preview and export.</p>
        <div className="row">
          <button type="button" onClick={() => {
            appearanceStep.cancel();
            setAppearance({ x: "50", y: "50", scale: "100", opacity: "100" });
            setError(null);
            if (clip.transform) onTransform(clip.id);
            else onAppearancePreview?.(clip.id, null);
          }}>Reset appearance</button>
        </div>
      </fieldset>
      </Section>
    </form>}
    {track.kind !== "audio" && <form aria-label="Clip animations" onSubmit={(event) => {
      event.preventDefault();
      if (disabled) return;
      const candidate = Object.fromEntries(
        (["entrance", "exit"] as const).filter((phase) => animationActive[phase]).map((phase) => [
          phase, { id: animationDraft[phase].id, version: 1,
            durationPercent: animationDraft[phase].percent.trim() === "" ? NaN : Number(animationDraft[phase].percent) },
        ]));
      const invalid = animationDurationError(candidate as ClipAnimations, clipFrames);
      const parsed = ClipAnimationsSchema.safeParse(candidate);
      if (invalid || !parsed.success) { setError(invalid ?? "Choose an animation length from 1% to 100% of the clip."); return; }
      setError(null);
      if (JSON.stringify(parsed.data) !== JSON.stringify(clip.animations ?? {})) {
        onAnimations(clip.id, parsed.data.entrance || parsed.data.exit ? parsed.data : undefined);
      }
    }}>
      <Section name="Animations" sections={sections}>
        <fieldset disabled={disabled}>
          <legend>Entrance and exit</legend>
          {(["entrance", "exit"] as const).map((phase) => {
            const label = phase === "entrance" ? "Entrance" : "Exit";
            const other = animationPercent(phase === "entrance" ? "exit" : "entrance");
            const remaining = Math.max(1, 100 - other);
            return <label key={phase}>{label} animation<select value={animationDraft[phase].id} onChange={(event) => {
              const id = event.target.value;
              setAnimationDraft((previous) => ({ ...previous, [phase]: { id,
                percent: Number(previous[phase].percent) > remaining ? clean(remaining) : previous[phase].percent } }));
            }}>
              <option value="none">None</option>
              {ANIMATION_CATALOG.filter((item) => item.phase === phase).map((item) =>
                <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>;
          })}
          {(animationActive.entrance || animationActive.exit) && <>
            <RangeBar min={0} max={100} reverseEnd disabled={disabled} start={barHandle("entrance")} end={barHandle("exit")}
              fills={[
                ...(animationActive.entrance ? [[0, animationPercent("entrance")] as [number, number]] : []),
                ...(animationActive.exit ? [[100 - animationPercent("exit"), 100] as [number, number]] : []),
              ]} />
            <p className="muted range-bar-caption"><span>Entrance →</span><span>← Exit</span></p>
          </>}
          {(["entrance", "exit"] as const).filter((phase) => animationActive[phase]).map((phase) => {
            const label = phase === "entrance" ? "Entrance" : "Exit";
            const draft = animationDraft[phase];
            const remaining = Math.max(1, 100 - animationPercent(phase === "entrance" ? "exit" : "entrance"));
            const definition = ANIMATION_CATALOG.find((item) => item.id === draft.id);
            const value = Number(draft.percent);
            const frames = Number.isFinite(value) && value > 0 ? Math.round(clipFrames * value / 100) : 0;
            return <div key={phase}>
              {definition && <p className="muted">{definition.name}: {definition.description}</p>}
              <SliderField label={`${label} length (% of clip)`} value={draft.percent} min={1} max={remaining} slider={false}
                onValue={(next) => setAnimationPercent(phase, next)} />
              <p className="muted">≈ {(frames / fps).toFixed(2)} s ({frames} frames) at the current clip length.
                {frames < 2 ? " Too short to show; increase the percentage." : ""}</p>
            </div>;
          })}
          <p className="muted">Drag the entrance handle from the left and the exit handle from the right; together they can use up to 100% of the clip. Lengths rescale when you trim or change speed. Smooth start/stop; visual only, audio is unchanged.</p>
          <p className="muted">Split keeps the entrance on the left half and the exit on the right, at the same on-screen length where it fits.</p>
          <div className="row">
            <button type="submit">Apply animations</button>
            <button type="button" onClick={() => {
              setAnimationDraft({ entrance: { id: "none", percent: String(defaultPercent) }, exit: { id: "none", percent: String(defaultPercent) } });
              setError(null);
              if (clip.animations) onAnimations(clip.id);
            }}>Remove animations</button>
          </div>
        </fieldset>
      </Section>
    </form>}
    {track.kind !== "audio" && onZoom && <form aria-label="Clip zoom" onSubmit={(event) => {
      event.preventDefault();
      zoomStep.flush();
    }}>
      <Section name="Zoom" sections={sections}>
        <fieldset disabled={disabled}>
          <legend>Two-point zoom</legend>
          {!zoom ? <>
            <p className="muted">Zoom smoothly between two points in this clip, like a slow push-in.</p>
            <div className="row">
              <button type="button" onClick={() => {
                if (disabled) return;
                setZoom(ZOOM_DEFAULT);
                setError(null);
                sendZoom(parseZoom(ZOOM_DEFAULT)!);
              }}>Add zoom</button>
            </div>
          </> : <>
            <RangeBar min={0} max={100} disabled={disabled} start={zoomHandle("start")} end={zoomHandle("end")}
              fills={[[clamp(zoomPoint("start"), 0, 100), clamp(zoomPoint("end"), 0, 100)]]} onSettle={zoomStep.flush} />
            <p className="muted range-bar-caption"><span>Start</span><span>End</span></p>
            <div className="row">
              <button type="button" onClick={() => setPointAtPlayhead("start")}>Set start at playhead</button>
              <button type="button" onClick={() => setPointAtPlayhead("end")}>Set end at playhead</button>
            </div>
            {(["start", "end"] as const).map((side) => <SliderField key={side} label={`Zoom ${side} point (% of clip)`}
              value={zoom[side]} min={0} max={100} slider={false}
              onValue={(value, kind) => changeZoom(side, value, kind)} onSettle={zoomStep.flush} />)}
            <SliderField label="Start scale (%)" value={zoom.startScale} min={ZOOM_SCALE_MIN * 100} max={ZOOM_SCALE_MAX * 100}
              onValue={(value, kind) => changeZoom("startScale", value, kind)} onSettle={zoomStep.flush} />
            <SliderField label="End scale (%)" value={zoom.endScale} min={ZOOM_SCALE_MIN * 100} max={ZOOM_SCALE_MAX * 100}
              onValue={(value, kind) => changeZoom("endScale", value, kind)} onSettle={zoomStep.flush} />
            <p className="muted">Holds the start scale until the start point, eases smoothly to the end scale, then holds it. Zooms around the clip's center from Appearance and combines with Appearance and animations.</p>
            <p className="muted">Preview updates while you drag; releasing, leaving a box or pressing Enter saves one Undo step. Points follow the clip when you trim or change speed; a split keeps the same motion on both halves.</p>
            <div className="row">
              <button type="button" onClick={() => {
                if (disabled) return;
                zoomStep.cancel();
                setZoom(null);
                setError(null);
                onZoomPreview?.(clip.id, null);
                sendZoom(undefined);
              }}>Remove zoom</button>
            </div>
          </>}
        </fieldset>
      </Section>
    </form>}
    {error && <p role="alert" className="error">{error}</p>}
    <p className="muted">Between-clip transitions and a custom animation editor are not available yet.</p>
  </>;
}

export function ClipProperties(props: Props) {
  const found = props.selectedClipId ? findClip(props.project, props.selectedClipId) : undefined;
  const asset = found && props.project.assets.find((item) => item.id === found.clip.assetId);
  const [openSections, setOpenSections] = useState<{ clipId: string | null; open: ReadonlySet<string> }>(
    () => ({ clipId: props.selectedClipId, open: new Set() }));
  const open = openSections.clipId === props.selectedClipId ? openSections.open : new Set<string>();
  const sections: SectionState = {
    open,
    onToggle: (name, isOpen) => setOpenSections((previous) => {
      const next = new Set(previous.clipId === props.selectedClipId ? previous.open : []);
      if (isOpen) next.add(name); else next.delete(name);
      return { clipId: props.selectedClipId, open: next };
    }),
  };
  return <section className="pane clip-properties" aria-label="Clip properties">
    <h2>Properties</h2>
    {found && asset ? <PropertiesForm {...props} {...found} asset={asset} sections={sections}
      key={JSON.stringify([found.clip, found.track.id])} /> : <p className="placeholder">Select a timeline clip to edit its properties.</p>}
    {props.cropControls && found && asset && found.track.kind !== "audio" && <Section name="Crop" sections={sections}>
      <CropProperties project={props.project} selectedClipId={props.selectedClipId}
        controls={props.cropControls} disabledReason={props.disabledReason} />
    </Section>}
  </section>;
}
