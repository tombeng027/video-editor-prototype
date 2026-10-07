export const IPC_PICK_FOLDER = "ve:pick-folder";
export const IPC_PICK_MEDIA = "ve:pick-media";
export const IPC_REVEAL = "ve:reveal";

export const MEDIA_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "m4a", "aac"];

/** Only the app's own client origin may call the native-dialog IPC. */
export function isTrustedSender(senderUrl: string | undefined, clientUrl: string): boolean {
  if (!senderUrl) return false;
  try {
    return new URL(senderUrl).origin === new URL(clientUrl).origin;
  } catch {
    return false;
  }
}

/** Reveal requests must be absolute paths; anything else is ignored. */
export function isRevealablePath(value: unknown): value is string {
  return typeof value === "string" && value.length < 1024 && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/"));
}

export function sanitizeTitle(title: unknown, fallback: string): string {
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 100) : fallback;
}
