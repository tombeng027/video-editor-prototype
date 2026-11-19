import { useCallback, useEffect, useRef, useState } from "react";
import { captionCuesError, type CaptionCue, type Command, type Project } from "@ve/schema";
import { formatTimecode } from "@ve/timeline-core";
import type { PlayheadClock } from "../clock.js";
import { framesToPx } from "../timelineMath.js";
import { useClockTick } from "../useClock.js";

type Props = {
  project: Project;
  clock: PlayheadClock;
  zoom: number;
  width: number;
  labelWidth: number;
  scrollLeft: number;
  onScroll: (delta: number) => void;
  onCommands: (commands: Command[]) => Promise<boolean>;
  disabled?: boolean;
  onExpand?: () => void;
};
type Fields = { start: string; end: string; text: string };
type Drag = { cue: CaptionCue; kind: "move" | "start" | "end"; x: number; pointerId: number; project: Project };
const fieldsFor = (cue: CaptionCue): Fields => ({ start: String(cue.start), end: String(cue.end), text: cue.text });

export function CaptionWorkspace({ project, clock, zoom, width, labelWidth, scrollLeft, onScroll, onCommands,
  disabled = false, onExpand }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>({ start: "0", end: "1", text: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const drag = useRef<Drag | null>(null);
  const [dragCue, setDragCue] = useState<CaptionCue | null>(null);
  const head = useRef<HTMLDivElement>(null);
  const selected = project.captionCues.find((cue) => cue.id === selectedId);
  const cues = [...project.captionCues].sort((a, b) => a.start - b.start);
  const fps = project.settings.fps;
  const locked = disabled || busy;
  const savedStart = selected?.start;
  const savedEnd = selected?.end;
  const savedText = selected?.text;
  const newSaved = newId !== null && project.captionCues.some((cue) => cue.id === newId);

  useEffect(() => {
    if (newId) {
      if (newSaved) {
        setSelectedId(newId);
        setNewId(null);
      }
      return;
    }
    if (savedStart !== undefined && savedEnd !== undefined && savedText !== undefined) {
      setFields({ start: String(savedStart), end: String(savedEnd), text: savedText });
    }
    else setSelectedId(null);
    setError(null);
  }, [selectedId, savedStart, savedEnd, savedText, newId, newSaved]);

  const cancelDrag = useCallback(() => { drag.current = null; setDragCue(null); }, []);
  useEffect(() => { cancelDrag(); }, [project, disabled, expanded, cancelDrag]);
  const placeHead = useCallback(() => {
    if (head.current) head.current.style.left = `${labelWidth + framesToPx(clock.position, fps, zoom)}px`;
  }, [clock, labelWidth, fps, zoom]);
  useClockTick(clock, placeHead);

  const choose = (cue: CaptionCue) => {
    clock.pause();
    clock.seek(cue.start);
    setSelectedId(cue.id);
    setNewId(null);
    setFields(fieldsFor(cue));
    setError(null);
  };
  const submit = async (commands: Command[], after?: () => void) => {
    if (disabled || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (await onCommands(commands)) after?.();
      else setError("Caption edit was not confirmed. Check the edit/save guidance above before retrying.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const validate = (cue: CaptionCue) => captionCuesError([
    ...project.captionCues.filter((item) => item.id !== cue.id), cue,
  ]);
  const newCue = () => {
    const start = clock.frame;
    if (cues.some((cue) => start >= cue.start && start < cue.end)) {
      setError("A caption already covers the playhead. Select it to edit, or move to an empty gap.");
      return;
    }
    clock.pause();
    const next = cues.find((cue) => cue.start > start);
    const end = Math.min(start + Math.max(1, Math.round(2 * fps.num / fps.den)), next?.start ?? Number.MAX_SAFE_INTEGER);
    setSelectedId(null);
    setNewId(crypto.randomUUID());
    setFields({ start: String(start), end: String(end), text: "" });
    setError(null);
  };
  const apply = () => {
    const cue = { id: newId ?? selectedId ?? "", start: fields.start.trim() ? Number(fields.start) : NaN,
      end: fields.end.trim() ? Number(fields.end) : NaN, text: fields.text };
    const problem = validate(cue);
    if (problem) { setError(problem); return; }
    void submit([newId ? { type: "AddCaptionCue", cue } : { type: "SetCaptionCue", cue }], () => {
      setSelectedId(cue.id);
      setNewId(null);
    });
  };
  const updateDrag = (x: number): CaptionCue | null => {
    const current = drag.current;
    if (!current || current.project !== project || locked) return null;
    const { cue, kind } = current;
    const delta = Math.round((x - current.x) * fps.num / (fps.den * zoom));
    const before = cues.filter((item) => item.id !== cue.id && item.end <= cue.start).at(-1)?.end ?? 0;
    const after = cues.find((item) => item.id !== cue.id && item.start >= cue.end)?.start ?? Number.MAX_SAFE_INTEGER;
    let next: CaptionCue;
    if (kind === "move") {
      const start = Math.max(before, Math.min(cue.start + delta, after - (cue.end - cue.start)));
      next = { ...cue, start, end: start + (cue.end - cue.start) };
    } else if (kind === "start") next = { ...cue, start: Math.max(before, Math.min(cue.start + delta, cue.end - 1)) };
    else next = { ...cue, end: Math.max(cue.start + 1, Math.min(cue.end + delta, after)) };
    setDragCue(next);
    return next;
  };
  const nextCue = selected && cues[cues.findIndex((cue) => cue.id === selected.id) + 1];
  const dirty = Boolean(newId || selected && (fields.start !== String(selected.start) ||
    fields.end !== String(selected.end) || fields.text !== selected.text));
  const mutateSelected = (action: "delete" | "split" | "merge") => {
    if (!selected) return;
    if (action === "delete") {
      void submit([{ type: "RemoveCaptionCue", cueId: selected.id }], () => setSelectedId(null));
    } else if (action === "split") {
      const frame = clock.frame;
      if (frame <= selected.start || frame >= selected.end) {
        setError("Move the playhead inside the selected caption to split it.");
        return;
      }
      void submit([{ type: "SetCaptionCue", cue: { ...selected, end: frame } },
        { type: "AddCaptionCue", cue: { ...selected, id: crypto.randomUUID(), start: frame } }]);
    } else if (nextCue) {
      const text = `${selected.text}\n${nextCue.text}`;
      if (text.length > 2000) { setError("Merged caption text would exceed 2000 characters."); return; }
      void submit([{ type: "RemoveCaptionCue", cueId: nextCue.id },
        { type: "SetCaptionCue", cue: { ...selected, end: nextCue.end, text } }]);
    }
  };

  return <section className={`caption-workspace${expanded ? " expanded" : ""}`} aria-label="Captions"
    onKeyDown={(event) => {
      // Caption focus must never delete/split a media clip. Global Undo/Redo still works outside text fields.
      if (!event.ctrlKey && !event.metaKey && ["s", "S", "Delete", "Backspace", "Escape"].includes(event.key)) event.stopPropagation();
      if (event.key === "Escape") { cancelDrag(); setError(null); }
    }}>
    <div className="caption-heading">
      <button aria-expanded={expanded} aria-controls={expanded ? "caption-workspace-body" : undefined} onClick={() => {
        if (!expanded) onExpand?.();
        setExpanded(!expanded);
      }}>{expanded ? "Collapse captions" : "Expand captions"}</button>
      <span>{cues.length} {cues.length === 1 ? "cue" : "cues"}</span>
      {expanded && <button disabled={locked} onClick={newCue}>New caption at playhead</button>}
      {expanded && <span className="muted">Preview only - not included in exports yet</span>}
    </div>
    <div className={`caption-axis${expanded ? "" : " density"}`} aria-label="Caption timeline"
      onWheel={(event) => {
        const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
        if (delta) { event.preventDefault(); onScroll(delta); }
      }}>
      <div className="caption-axis-content" style={{ width, transform: `translateX(${-scrollLeft}px)` }}>
        {cues.map((saved) => {
          const cue = dragCue?.id === saved.id ? dragCue : saved;
          return <div key={cue.id} className={`caption-block${selectedId === cue.id ? " selected" : ""}`}
            style={{ left: labelWidth + framesToPx(cue.start, fps, zoom), width: framesToPx(cue.end - cue.start, fps, zoom) }}
            data-caption-id={cue.id} title={`${formatTimecode(cue.start, fps)} - ${formatTimecode(cue.end, fps)}: ${cue.text}`}
            onPointerDown={(event) => {
              if (!expanded || locked || dirty || event.button !== 0) return;
              event.preventDefault();
              choose(saved);
              const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-caption-edge]")?.dataset.captionEdge;
              drag.current = { cue: saved, kind: edge === "start" || edge === "end" ? edge : "move",
                x: event.clientX, pointerId: event.pointerId, project };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => { if (drag.current?.pointerId === event.pointerId) updateDrag(event.clientX); }}
            onPointerUp={(event) => {
              const current = drag.current;
              if (current?.pointerId !== event.pointerId) return;
              const next = updateDrag(event.clientX);
              cancelDrag();
              if (next && (next.start !== current.cue.start || next.end !== current.cue.end)) {
                const problem = validate(next);
                if (problem) setError(problem);
                else void submit([{ type: "SetCaptionCue", cue: next }]);
              }
            }}
            onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
            {expanded && <>
              <button className="caption-select" disabled={locked} onClick={() => choose(saved)} aria-label={`Select caption: ${saved.text}`}
                title="Select caption; drag the block to move it after applying text/timing drafts">{cue.text}</button>
              <button className="tl-trim-handle left" data-caption-edge="start" disabled={locked || dirty}
                aria-label={`Retime caption start: ${saved.text}`} />
              <button className="tl-trim-handle right" data-caption-edge="end" disabled={locked || dirty}
                aria-label={`Retime caption end: ${saved.text}`} />
            </>}
          </div>;
        })}
        <div className="tl-playhead" ref={head} aria-hidden="true" />
      </div>
      <span className="caption-axis-label" style={{ width: labelWidth }}>Captions</span>
    </div>
    {expanded && <div id="caption-workspace-body" className="caption-body">
      <div className="caption-list" aria-label="Caption text list">
        {cues.length === 0 && <p className="muted">Move the playhead, then add a caption.</p>}
        {cues.map((cue) => <button key={cue.id} disabled={locked} aria-pressed={selectedId === cue.id} onClick={() => choose(cue)}>
          <span className="muted">{formatTimecode(cue.start, fps)} - {formatTimecode(cue.end, fps)}</span>
          <span>{cue.text}</span>
        </button>)}
      </div>
      <form className="caption-editor" aria-label="Caption editor" noValidate onSubmit={(event) => { event.preventDefault(); if (!locked) apply(); }}>
        {selected || newId ? <>
          <div className="caption-timing">
            <label>Start frame<input type="number" step="1" min="0" aria-label="Caption start frame" disabled={locked}
              value={fields.start} onChange={(event) => setFields({ ...fields, start: event.target.value })} /></label>
            <label>End frame (exclusive)<input type="number" step="1" min="1" aria-label="Caption end frame" disabled={locked}
              value={fields.end} onChange={(event) => setFields({ ...fields, end: event.target.value })} /></label>
            <span className="muted">{fps.num}/{fps.den} fps</span>
          </div>
          <label>Caption text<textarea aria-label="Caption text" disabled={locked} maxLength={2000}
            value={fields.text} onChange={(event) => setFields({ ...fields, text: event.target.value })} /></label>
          <div className="caption-actions">
            <button type="submit" disabled={locked || !dirty}>{newId ? "Add caption" : "Apply caption"}</button>
            <button type="button" disabled={locked} onClick={() => {
              setNewId(null); setError(null);
              if (selected) setFields(fieldsFor(selected));
            }}>Cancel draft</button>
            {selected && <>
              <button type="button" disabled={locked || dirty} onClick={() => mutateSelected("delete")}>Delete caption</button>
              <button type="button" disabled={locked || dirty} onClick={() => mutateSelected("split")}
                title="Split at the playhead; both halves keep the text for you to edit.">Split caption</button>
              <button type="button" disabled={locked || dirty || !nextCue} onClick={() => mutateSelected("merge")}
                title="Join with the next chronological cue, including any gap; text is joined with a newline.">Merge with next</button>
            </>}
          </div>
        </> : <p className="muted">Select a cue to edit its text and timing.</p>}
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </div>}
  </section>;
}
