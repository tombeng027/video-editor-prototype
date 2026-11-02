import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@ve/schema";
import type { PlayheadClock } from "../clock.js";
import type { EngineConfig } from "../engine.js";
import { activeClipAt, clampToProxy, needsSeek, proxyUrl, sourceSeconds, timelineDuration } from "../playback.js";
import { useClockTick } from "../useClock.js";

type Props = { config: EngineConfig; project: Project; clock: PlayheadClock };
type Overlay = "none" | "empty" | "gap" | "preparing";

export function Preview({ config, project, clock }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const loadedAsset = useRef<string | null>(null);
  const continuity = useRef<{ key: string; sourceOffset: number; holding: boolean } | null>(null);
  const [overlay, setOverlay] = useState<Overlay>("empty");

  const sync = useCallback(() => {
    const el = video.current;
    if (!el) return;
    // At the very end the clock sits one past the last frame; keep showing that last frame.
    const end = timelineDuration(project);
    const active = activeClipAt(project, Math.min(clock.frame, Math.max(0, end - 1)));
    if (!active) {
      continuity.current = null;
      if (!el.paused) el.pause();
      setOverlay(end === 0 ? "empty" : "gap");
      return;
    }
    if (!active.asset.proxyPath) {
      continuity.current = null;
      if (!el.paused) el.pause();
      setOverlay("preparing");
      return;
    }
    setOverlay("none");
    const key = `${active.asset.id}|${active.asset.proxyPath}`;
    const changed = loadedAsset.current !== key;
    if (changed) {
      loadedAsset.current = key;
      el.src = proxyUrl(config, active.asset.id);
    }
    const fps = project.settings.fps;
    const sourceOffset = active.clip.sourceIn - active.clip.timelineStart;
    const discontinuous = continuity.current?.key !== key || continuity.current.sourceOffset !== sourceOffset;
    const next = activeClipAt(project, clock.frame + 1);
    // Stop native playback before it can decode across a removed range or into a gap.
    const holdBoundary = !next || next.asset.id !== active.asset.id ||
      next.asset.proxyPath !== active.asset.proxyPath ||
      next.clip.sourceIn - next.clip.timelineStart !== sourceOffset;
    const enteringHold = holdBoundary && !continuity.current?.holding;
    continuity.current = { key, sourceOffset, holding: holdBoundary };
    const wanted = clampToProxy(sourceSeconds(active.clip, holdBoundary ? clock.frame : clock.position, fps), el.duration, fps);
    el.playbackRate = clock.rate;
    if ((!clock.playing || holdBoundary) && !el.paused) el.pause();
    if (changed || discontinuous || enteringHold ||
      needsSeek(el.currentTime, wanted, clock.playing && !holdBoundary, fps)) el.currentTime = wanted;
    if (clock.playing && !holdBoundary && el.paused) void el.play().catch(() => undefined);
  }, [clock, config, project]);

  useClockTick(clock, sync);
  useEffect(() => clock.onState(sync), [clock, sync]);

  return (
    <div className="preview-frame">
      <video ref={video} className={overlay === "none" ? "" : "hidden"} playsInline preload="auto" onLoadedMetadata={sync} />
      {overlay === "empty" && <span className="placeholder">{project.assets.length ? "Add a clip to the timeline" : "Import media to begin"}</span>}
      {overlay === "gap" && <span className="placeholder">No clip here</span>}
      {overlay === "preparing" && <span className="placeholder">Preparing preview…</span>}
    </div>
  );
}
