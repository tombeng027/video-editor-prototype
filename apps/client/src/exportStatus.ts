import type { Project } from "@ve/schema";

export type SaveStatus = "saved" | "saving" | "error";

export function saveLabel(status: SaveStatus): string {
  if (status === "saving") return "Saving…";
  if (status === "error") return "Save failed";
  return "Autosaved";
}

export function timelineHasClips(project: Project): boolean {
  return project.tracks.some((t) => t.kind !== "audio" && t.clips.length > 0);
}

export function exportDisabledReason(project: Project, offlineCount: number): string | null {
  if (!timelineHasClips(project)) return "Add a clip to the timeline first";
  if (offlineCount > 0) return "Some media is offline; relink or restore the files first";
  return null;
}