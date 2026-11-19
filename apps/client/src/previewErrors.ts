import type { ErrorContext } from "@ve/schema";
import { safeErrorContext } from "./editErrors.js";

export type PreviewProblem = { context: ErrorContext; detail: string };
export function previewProblem(code: string, detail: string, operation: ErrorContext["operation"] = "preview",
  stage: ErrorContext["stage"] = "playback", diagnosticId?: string): PreviewProblem {
  return { context: safeErrorContext(code, stage,
    stage === "submit" && (operation === "preview-prepare" || operation === "preview-cancel") ? "unconfirmed" : "unavailable",
    operation, diagnosticId), detail };
}

export function playbackProblem(error: unknown): PreviewProblem {
  const name = typeof error === "object" && error !== null && "name" in error && typeof error.name === "string" ? error.name : "";
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" ? error.message : "";
  const code = name === "NotAllowedError" ? "PREVIEW_PLAY_BLOCKED"
    : name === "NotSupportedError" ? "PREVIEW_UNSUPPORTED"
      : name === "AbortError" ? "PREVIEW_ABORTED" : "PREVIEW_PLAYBACK_FAILED";
  return previewProblem(code, name ? `${name}: ${message}` : "Playback rejected without a recognized error.");
}

export function mediaProblem(code?: number): PreviewProblem {
  return previewProblem(code === 1 ? "PREVIEW_ABORTED" : code === 2 ? "PREVIEW_NETWORK_FAILED"
    : code === 3 ? "PREVIEW_DECODE_FAILED" : code === 4 ? "PREVIEW_UNSUPPORTED" : "PREVIEW_MEDIA_FAILED",
  `Preview media could not be loaded or decoded${code ? ` (media error ${code})` : ""}.`);
}
