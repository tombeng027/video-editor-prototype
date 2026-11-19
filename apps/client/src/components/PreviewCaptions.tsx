import { useCallback, useRef } from "react";
import type { Project } from "@ve/schema";
import type { PlayheadClock } from "../clock.js";
import { useClockTick } from "../useClock.js";

export function PreviewCaptions({ project, clock }: { project: Project; clock: PlayheadClock }) {
  const text = useRef<HTMLDivElement>(null);
  const sync = useCallback(() => {
    const element = text.current;
    if (!element) return;
    const cue = project.captionCues.find((item) => clock.frame >= item.start && clock.frame < item.end);
    if (element.textContent !== (cue?.text ?? "")) element.textContent = cue?.text ?? "";
  }, [project.captionCues, clock]);
  useClockTick(clock, sync);
  const { width, height } = project.settings;
  return <svg className="preview-captions" viewBox={`0 0 ${width} ${height}`} aria-label="Preview captions">
    <foreignObject x="0" y="0" width={width} height={height}>
      <div className="preview-caption-layout" style={{ padding: `${height * 0.06}px ${width * 0.06}px`,
        fontSize: Math.min(width, height) * 0.055 }}>
        <div ref={text} className="preview-caption-text" />
      </div>
    </foreignObject>
  </svg>;
}
