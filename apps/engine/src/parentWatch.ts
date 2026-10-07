export type ParentStream = {
  on(event: "end" | "close", listener: () => void): unknown;
  resume(): unknown;
};

/**
 * The desktop shell holds the engine's stdin open. When the shell dies, even from a
 * force-kill, the pipe closes and the engine exits instead of being orphaned.
 */
export function exitWhenParentGone(stream: ParentStream, onGone: () => void): void {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    onGone();
  };
  stream.on("end", fire);
  stream.on("close", fire);
  stream.resume();
}
