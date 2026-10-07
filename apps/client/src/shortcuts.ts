export type Shortcut = "toggle-play" | "split" | "delete";

type KeyLike = { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean };

const TEXT_TARGETS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Maps a key press to an editor shortcut. Text fields keep every key. A focused button keeps Space
 * (it activates the button natively) but still lets S and Delete through, so the shortcuts keep
 * working right after a toolbar click.
 */
export function resolveShortcut(e: KeyLike, targetTag: string): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey || TEXT_TARGETS.has(targetTag)) return null;
  if (e.code === "Space") return targetTag === "BUTTON" ? null : "toggle-play";
  if (e.key === "s" || e.key === "S") return "split";
  if (e.key === "Delete" || e.key === "Backspace") return "delete";
  return null;
}
