export type Shortcut = "toggle-play" | "split" | "delete" | "undo" | "redo" | "deselect" | "previous-frame" | "next-frame";

type KeyLike = { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

const TEXT_TARGETS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Maps a key press to an editor shortcut. Text fields keep every key. A focused button keeps Space
 * (it activates the button natively) but still lets S and Delete through, so the shortcuts keep
 * working right after a toolbar click.
 */
export function resolveShortcut(e: KeyLike, targetTag: string): Shortcut | null {
  if (TEXT_TARGETS.has(targetTag) || e.altKey) return null;
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === "z") return e.shiftKey ? "redo" : "undo";
    if (e.key.toLowerCase() === "y" && e.ctrlKey) return "redo";
    return null;
  }
  if (!e.shiftKey && e.key === "ArrowLeft") return "previous-frame";
  if (!e.shiftKey && e.key === "ArrowRight") return "next-frame";
  if (e.code === "Space") return targetTag === "BUTTON" ? null : "toggle-play";
  if (e.key === "s" || e.key === "S") return "split";
  if (e.key === "Delete" || e.key === "Backspace") return "delete";
  if (e.key === "Escape") return "deselect";
  return null;
}
