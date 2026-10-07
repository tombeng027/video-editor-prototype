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
  const [overlay, setOverlay] = useState<Overlay>("empty");

  const sync = useCallback(() => {
    const el = video.current;
    if (!el) return;
    // At the very end the clock sits one past the last frame; keep showing that last frame.
    const end = timelineDuration(project);
    const active = activeClipAt(project, Math.min(clock.frame, Math.max(0, end - 1)));
    if (!active) {
      if (!el.paused) el.pause();
      setOverlay(end === 0 ? "empty" : "gap");
      return;
    }
    if (!active.asset.proxyPath) {
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
    const wanted = clampToProxy(sourceSeconds(active.clip, clock.position, fps), el.duration, fps);
    el.playbackRate = clock.rate;
    if (changed || needsSeek(el.currentTime, wanted, clock.playing, fps)) el.currentTime = wanted;
    if (clock.playing && el.paused) void el.play().catch(() => undefined);
    if (!clock.playing && !el.paused) el.pause();
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
