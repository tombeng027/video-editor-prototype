import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { animatedTransform, clipCanvasRect, type CanvasRect, type ClipCrop, type Project, type Transform } from "@ve/schema";
import { canLockCrop, editCrop, NO_CROP, type CropControls, type CropMode, type CropSide } from "../cropEdit.js";
import { clipDuration } from "@ve/timeline-core";
import type { PlayheadClock } from "../clock.js";
import { canvasTransformToBase, fitToCanvasTransform, snapMove, snapScale, snapTargets, topmostAt, type Guides } from "../canvasEdit.js";
import { activeVisualClipsAt, timelineDuration } from "../playback.js";
import { planLayerClip, type LayerAction } from "../timelineOps.js";
import { useClockState, useClockTick } from "../useClock.js";

const SNAP_PX = 6;
const DRAG_START_PX = 3;
const LAYER_ACTIONS: Array<[LayerAction, string]> = [
  ["forward", "Bring forward"], ["front", "Bring to front"], ["backward", "Send backward"], ["back", "Send to back"],
];
const CORNERS = ["nw", "ne", "sw", "se"] as const;

type Drag = {
  mode: "move" | "resize";
  clipId: string;
  pointerId: number;
  start: { x: number; y: number };
  base: Transform;
  rect: CanvasRect;
  others: CanvasRect[];
  moved: boolean;
  latest: Transform;
  frame: number;
};

type Props = {
  project: Project;
  clock: PlayheadClock;
  offline?: ReadonlySet<string>;
  selectedClipId: string | null;
  snapping: boolean;
  /** Why canvas edits are unavailable; pictures can still be selected. */
  disabledReason?: string;
  onSelect: (clipId: string) => void;
  onDraft: (clipId: string, transform: Transform | null) => void;
  onCommit: (clipId: string, transform: Transform) => void;
  onLayer: (clipId: string, action: LayerAction) => void;
  cropControls?: CropControls;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const tidy = (value: number) => Number(value.toFixed(4));

/** Direct manipulation over the Preview: select the top-most picture, drag to move, drag corners to resize. */
export function CanvasEditLayer({ project, clock, offline, selectedClipId, snapping, disabledReason, onSelect, onDraft, onCommit, onLayer, cropControls }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const cropDrag = useRef<{ clipId: string; pointerId: number; sides: CropSide[]; start: { x: number; y: number };
    crop: ClipCrop; rect: CanvasRect; latest: ClipCrop; moved: boolean; frame: number; mode: CropMode;
    width: number; height: number } | null>(null);
  const { playing } = useClockState(clock);
  const [frame, setFrame] = useState(clock.frame);
  const [guides, setGuides] = useState<Guides>({ x: null, y: null });
  const [menu, setMenu] = useState<{ clipId: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const croppingActive = Boolean(cropControls?.active);
  useEffect(() => {
    if (!croppingActive || !drag.current) return;
    const current = drag.current;
    drag.current = null; setGuides({ x: null, y: null });
    if (current.moved) onDraft(current.clipId, null);
  }, [croppingActive, onDraft]);

  useClockTick(clock, () => { if (!clock.playing) setFrame(clock.frame); });
  useEffect(() => clock.onState(() => setFrame(clock.frame)), [clock]);

  const layers = useMemo(() => {
    const last = Math.max(0, timelineDuration(project) - 1);
    return activeVisualClipsAt(project, Math.min(frame, last)).filter(({ asset }) => !offline?.has(asset.id));
  }, [frame, offline, project]);
  const displayFrame = Math.min(frame, Math.max(0, timelineDuration(project) - 1));
  const transforms = useMemo(() => layers.map(({ clip }) =>
    animatedTransform(clip.animations, clipDuration(clip), displayFrame - clip.timelineStart,
      clip.transform, clip.zoom)), [displayFrame, layers]);
  const rects = useMemo(() => layers.map(({ clip, asset }, index) =>
    clipCanvasRect(transforms[index], project.settings, asset, clip.crop)), [layers, project.settings, transforms]);
  const selectedIndex = layers.findIndex(({ clip }) => clip.id === selectedClipId);
  useEffect(() => {
    const current = cropDrag.current;
    if (!current) return;
    const target = layers.find(({ clip }) => clip.id === current.clipId);
    if (selectedClipId !== current.clipId || disabledReason || target?.track.locked || !target || playing ||
      !cropControls?.active || cropControls.mode !== current.mode || displayFrame !== current.frame ||
      project.settings.width !== current.width || project.settings.height !== current.height) {
      cropDrag.current = null;
      if (current.moved) cropControls?.onDraft(current.clipId, null);
    }
  }, [cropControls, disabledReason, displayFrame, layers, playing, project.settings, selectedClipId]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(null); };
    window.addEventListener("pointerdown", close);
    const dismiss = () => setMenu(null);
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) dismiss(); };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [menu]);
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const bounds = menuRef.current.getBoundingClientRect();
    const x = clamp(menu.x, 0, Math.max(0, window.innerWidth - bounds.width));
    const y = clamp(menu.y, 0, Math.max(0, window.innerHeight - bounds.height));
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x, y });
  }, [menu]);

  const pointAt = useCallback((event: { clientX: number; clientY: number }) => {
    const bounds = box.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height, bounds };
  }, []);

  const hit = (event: ReactPointerEvent | ReactMouseEvent) => {
    const { x, y } = pointAt(event);
    const index = topmostAt(rects, { x, y });
    return index < 0 ? null : index;
  };

  const begin = (event: ReactPointerEvent, index: number, mode: Drag["mode"]) => {
    if (croppingActive) return;
    const { clip, track } = layers[index]!;
    onSelect(clip.id);
    if (disabledReason || track.locked) return;
    const { x, y } = pointAt(event);
    const base = transforms[index]!;
    if (!canvasTransformToBase(clip, displayFrame, base)) return;
    drag.current = {
      mode, clipId: clip.id, pointerId: event.pointerId, start: { x, y }, base, rect: rects[index]!,
      others: rects.filter((_, other) => other !== index), moved: false, latest: base,
      frame: displayFrame,
    };
    box.current?.setPointerCapture?.(event.pointerId);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    setMenu(null);
    if (clock.playing) clock.pause();
    const index = hit(event);
    if (cropControls?.active) { if (index !== null) onSelect(layers[index]!.clip.id); return; }
    if (index !== null) begin(event, index, "move");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const cropping = cropDrag.current;
    if (cropping && cropping.pointerId === event.pointerId && cropControls) {
      const { x, y, bounds } = pointAt(event);
      if (!cropping.moved && Math.hypot((x - cropping.start.x) * bounds.width, (y - cropping.start.y) * bounds.height) < DRAG_START_PX) return;
      const layer = layers.find(({ clip }) => clip.id === cropping.clipId);
      if (disabledReason || layer?.track.locked || !layer?.asset.width || !layer.asset.height) return;
      if (cropControls.mode === "locked" && !canLockCrop({ width: layer.asset.width, height: layer.asset.height }, project.settings)) return;
      let next = cropping.crop;
      const sides = cropControls.mode === "locked" ? [...cropping.sides].sort((a, b) => {
        const distance = (side: CropSide) => side === "left" || side === "right"
          ? Math.abs((x - cropping.start.x) / cropping.rect.width) : Math.abs((y - cropping.start.y) / cropping.rect.height);
        return distance(b) - distance(a);
      }) : cropping.sides;
      for (const side of sides) {
        const horizontal = side === "left" || side === "right";
        const delta = horizontal ? (x - cropping.start.x) / cropping.rect.width
          : (y - cropping.start.y) / cropping.rect.height;
        const value = cropping.crop[side] + (side === "right" || side === "bottom" ? -delta : delta);
        next = editCrop(next, side, value, cropControls.mode, { width: layer.asset.width, height: layer.asset.height }, project.settings);
        if (cropControls.mode === "locked") break;
      }
      cropping.latest = next; cropping.moved = true;
      cropControls.onDraft(cropping.clipId, next);
      return;
    }
    if (croppingActive) return;
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const { x, y, bounds } = pointAt(event);
    const dxPx = (x - current.start.x) * bounds.width, dyPx = (y - current.start.y) * bounds.height;
    if (!current.moved && Math.hypot(dxPx, dyPx) < DRAG_START_PX) return;
    current.moved = true;
    const threshold = { x: SNAP_PX / bounds.width, y: SNAP_PX / bounds.height };
    const targets = snapTargets(current.others);
    const snap = snapping && !event.altKey;
    let next: Transform;
    if (current.mode === "move") {
      const dx = x - current.start.x, dy = y - current.start.y;
      const moved = { ...current.rect, left: current.rect.left + dx, top: current.rect.top + dy };
      const snapped = snap ? snapMove(moved, targets, threshold) : { dx: 0, dy: 0, guides: { x: null, y: null } };
      setGuides(snapped.guides);
      next = { ...current.base, x: tidy(clamp(current.base.x + dx + snapped.dx, -10, 10)), y: tidy(clamp(current.base.y + dy + snapped.dy, -10, 10)) };
    } else {
      const center = { x: current.base.x * bounds.width, y: current.base.y * bounds.height };
      const from = Math.hypot(current.start.x * bounds.width - center.x, current.start.y * bounds.height - center.y);
      const to = Math.hypot(x * bounds.width - center.x, y * bounds.height - center.y);
      const layer = layers.find(({ clip }) => clip.id === current.clipId)!;
      const scaleFactor = current.base.scale / (layer.clip.transform?.scale ?? 1);
      let scale = clamp(current.base.scale * (from > 0 ? to / from : 1), 0.01 * scaleFactor, 10 * scaleFactor);
      if (snap) {
        const fitted = clipCanvasRect({ x: 0, y: 0, scale: 1, opacity: 1 }, project.settings, layer?.asset, layer?.clip.crop);
        const snapped = snapScale({ x: current.base.x, y: current.base.y },
          { x: fitted.width / 2, y: fitted.height / 2, left: fitted.left, top: fitted.top }, scale, targets, threshold);
        scale = clamp(snapped.scale, 0.01 * scaleFactor, 10 * scaleFactor);
        setGuides(snapped.guides);
      } else setGuides({ x: null, y: null });
      next = { ...current.base, scale: tidy(scale) };
    }
    const clip = layers.find(({ clip }) => clip.id === current.clipId)!.clip;
    const saved = canvasTransformToBase(clip, current.frame, next);
    if (!saved) return;
    current.latest = {
      x: tidy(clamp(saved.x, -10, 10)), y: tidy(clamp(saved.y, -10, 10)),
      scale: tidy(clamp(saved.scale, 0.01, 10)), opacity: saved.opacity,
    };
    onDraft(current.clipId, current.latest);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const cropping = cropDrag.current;
    if (cropping && cropping.pointerId === event.pointerId) {
      cropDrag.current = null;
      if (cropping.moved) {
        const target = layers.find(({ clip }) => clip.id === cropping.clipId);
        if (cancelled || disabledReason || !target || target.track.locked) cropControls?.onDraft(cropping.clipId, null);
        else if ((Object.keys(cropping.crop) as CropSide[]).some((side) => Math.abs(cropping.latest[side] - cropping.crop[side]) > 1e-8)) {
          cropControls?.onCommit(cropping.clipId, cropping.latest);
        } else cropControls?.onDraft(cropping.clipId, null);
      }
      return;
    }
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setGuides({ x: null, y: null });
    if (!current.moved) return;
    if (cancelled || croppingActive) onDraft(current.clipId, null);
    else onCommit(current.clipId, current.latest);
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (clock.playing) clock.pause();
    const index = hit(event);
    if (index === null) { setMenu(null); return; }
    const { clip } = layers[index]!;
    onSelect(clip.id);
    setMenu({ clipId: clip.id, x: event.clientX, y: event.clientY });
  };

  const selected = !playing && selectedIndex >= 0 ? rects[selectedIndex]! : null;
  const animationEditable = selectedIndex >= 0 && canvasTransformToBase(layers[selectedIndex]!.clip, displayFrame, transforms[selectedIndex]!);
  const editable = selected && !disabledReason && !layers[selectedIndex]!.track.locked && animationEditable;
  const cropTarget = layers[selectedIndex];
  const cropSize = cropTarget?.asset.width && cropTarget.asset.height ? { width: cropTarget.asset.width, height: cropTarget.asset.height } : null;
  const cropUnavailable = !cropSize || (cropControls?.mode === "locked" && !canLockCrop(cropSize, project.settings));
  const percent = (value: number) => `${value * 100}%`;
  return (
    <div ref={box} className="canvas-edit" aria-label="Canvas: click a picture to select it, drag to move, drag a corner to resize, right-click for layer order"
      title={disabledReason ?? (cropControls?.active && cropUnavailable ? "Crop needs source dimensions and a project ratio within the source crop limits. Choose Free-form in Properties."
        : selected && !animationEditable ? "Move the playhead inside the slide animation before editing this picture." : undefined)}
      tabIndex={0} onKeyDown={(event) => {
        if (event.key === "Escape" && cropDrag.current) {
          const current = cropDrag.current; cropDrag.current = null;
          cropControls?.onDraft(current.clipId, null); event.preventDefault(); event.stopPropagation();
        }
      }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, false)} onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
      onContextMenu={onContextMenu}>
      {selected && (
        <div className={`canvas-selection${editable ? croppingActive ? " cropping" : " editable" : ""}`} data-testid="canvas-selection"
          style={{ left: percent(selected.left), top: percent(selected.top), width: percent(selected.width), height: percent(selected.height) }}>
          {editable && !cropControls?.active && CORNERS.map((corner) => (
            <span key={corner} className={`canvas-handle ${corner}`} aria-label={`Resize from ${corner} corner`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                setMenu(null);
                begin(event, selectedIndex, "resize");
              }} />
          ))}
          {editable && cropControls?.active && !cropUnavailable && (["nw", "n", "ne", "w", "e", "sw", "s", "se"] as const).map((edge) => (
            <span key={edge} className={`canvas-handle ${edge}`} aria-label={`Crop from ${edge} edge`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation(); clock.pause();
                setMenu(null); box.current?.focus();
                const layer = layers[selectedIndex]!;
                if (!layer.asset.width || !layer.asset.height) return;
                if (drag.current?.moved) onDraft(drag.current.clipId, null);
                drag.current = null;
                const point = pointAt(event);
                const crop = layer.clip.crop ?? NO_CROP;
                cropDrag.current = { clipId: layer.clip.id, pointerId: event.pointerId, start: point, crop,
                  rect: clipCanvasRect(transforms[selectedIndex], project.settings, layer.asset), latest: crop, moved: false,
                  frame: displayFrame, mode: cropControls.mode, width: project.settings.width, height: project.settings.height,
                  sides: [...(edge.includes("w") ? ["left" as const] : edge.includes("e") ? ["right" as const] : []),
                    ...(edge.includes("n") ? ["top" as const] : edge.includes("s") ? ["bottom" as const] : [])] };
                box.current?.setPointerCapture?.(event.pointerId);
              }} />
          ))}
        </div>
      )}
      {guides.x !== null && <div className="canvas-guide vertical" style={{ left: percent(guides.x) }} />}
      {guides.y !== null && <div className="canvas-guide horizontal" style={{ top: percent(guides.y) }} />}
      {menu && createPortal(
        <div ref={menuRef} className="canvas-menu" role="menu" aria-label="Layer order" style={{ left: menu.x, top: menu.y }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMenu(null); }
          }}>
          {cropControls && <>
            <span className="muted">Crop</span>
            <button role="menuitemcheckbox" aria-checked={cropControls.active} disabled={Boolean(disabledReason) || layers.find(({ clip }) => clip.id === menu.clipId)?.track.locked}
              onClick={() => { cropControls.onActive(!cropControls.active); setMenu(null); }}>{cropControls.active ? "Exit crop mode" : "Enter crop mode"}</button>
            {(["free", "locked"] as const).map((mode) => <button key={mode} role="menuitemradio" aria-checked={cropControls.mode === mode}
              disabled={!croppingActive || Boolean(disabledReason) || layers.find(({ clip }) => clip.id === menu.clipId)?.track.locked}
              title={!croppingActive ? "Enter Crop mode to change the crop constraint." : undefined}
              onClick={() => { if (!croppingActive) return; cropControls.onMode(mode); setMenu(null); }}>
              <span className="menu-choice-indicator" aria-hidden="true">{cropControls.mode === mode ? "\u25cf" : "\u25cb"}</span>
              {mode === "free" ? "Free-form crop" : "Project aspect locked crop"}</button>)}
          </>}
          <button role="menuitem" disabled={croppingActive || Boolean(disabledReason) || layers.find(({ clip }) => clip.id === menu.clipId)?.track.locked}
            title={disabledReason ?? (croppingActive ? "Exit Crop mode before resizing or fitting the picture." : "Center the clip and reset its base scale to 100%. Crop, opacity and animations stay unchanged.")}
            onClick={() => {
              const target = layers.find(({ clip }) => clip.id === menu.clipId);
              if (!target || croppingActive || disabledReason || target.track.locked) return;
              clock.pause();
              setMenu(null);
              onCommit(target.clip.id, fitToCanvasTransform(target.clip));
            }}>Fit to canvas</button>
          {LAYER_ACTIONS.map(([action, label]) => {
            const plan = planLayerClip(project, menu.clipId, action);
            const reason = disabledReason ?? (plan.ok ? undefined : plan.message);
            return <button key={action} role="menuitem" disabled={Boolean(reason)} title={reason}
              onClick={() => { setMenu(null); onLayer(menu.clipId, action); }}>{label}</button>;
          })}
        </div>, document.body
      )}
    </div>
  );
}
