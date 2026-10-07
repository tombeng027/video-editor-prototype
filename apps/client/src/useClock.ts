import { useEffect, useSyncExternalStore } from "react";
import type { PlayheadClock } from "./clock.js";

/** Re-renders only when play/pause/rate changes, never per frame. */
export function useClockState(clock: PlayheadClock): { playing: boolean; rate: number } {
  const key = useSyncExternalStore(
    (notify) => clock.onState(notify),
    () => `${clock.playing ? 1 : 0}|${clock.rate}`,
  );
  const [playing, rate] = key.split("|");
  return { playing: playing === "1", rate: Number(rate) };
}

/** Runs `callback` on every clock tick without causing React renders. */
export function useClockTick(clock: PlayheadClock, callback: () => void): void {
  useEffect(() => {
    callback();
    return clock.onTick(callback);
  }, [clock, callback]);
}
