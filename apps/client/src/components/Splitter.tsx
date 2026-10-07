import type { PointerEvent as ReactPointerEvent } from "react";

type Props = {
  orientation: "vertical" | "horizontal";
  label: string;
  /** Called with the pointer movement in px since the drag started. */
  onDrag: (deltaPx: number) => void;
  onDragStart: () => void;
  onNudge: (deltaPx: number) => void;
};

export function Splitter({ orientation, label, onDrag, onDragStart, onNudge }: Props) {
  const vertical = orientation === "vertical";

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const origin = vertical ? event.clientX : event.clientY;
    onDragStart();
    const move = (e: PointerEvent) => onDrag((vertical ? e.clientX : e.clientY) - origin);
    const stop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };

  return (
    <div
      className={`splitter ${vertical ? "splitter-v" : "splitter-h"}`}
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        const back = vertical ? "ArrowLeft" : "ArrowUp";
        const forward = vertical ? "ArrowRight" : "ArrowDown";
        if (e.key === back) onNudge(-step);
        else if (e.key === forward) onNudge(step);
        else return;
        e.preventDefault();
      }}
    />
  );
}
