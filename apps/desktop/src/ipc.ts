export const IPC_PICK_FOLDER = "ve:pick-folder";

/** Only the app's own client origin may call the native-dialog IPC. */
export function isTrustedSender(senderUrl: string | undefined, clientUrl: string): boolean {
  if (!senderUrl) return false;
  try {
    return new URL(senderUrl).origin === new URL(clientUrl).origin;
  } catch {
    return false;
  }
}

export function sanitizeTitle(title: unknown, fallback: string): string {
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 100) : fallback;
}
