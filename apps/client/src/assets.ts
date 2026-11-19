import type { Asset, ProxyState } from "@ve/schema";

export const ASSET_DRAG_TYPE = "application/x-video-editor-asset";

export function assetSeconds(asset: Pick<Asset, "durationFrames" | "fps">, projectFps?: { num: number; den: number }): number {
  const fps = asset.fps ?? projectFps;
  return fps ? (asset.durationFrames * fps.den) / fps.num : 0;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatFps(fps: Asset["fps"]): string {
  if (!fps) return "";
  const value = fps.num / fps.den;
  return `${Number.isInteger(value) ? value : value.toFixed(3).replace(/0+$/, "")} fps`;
}

export type ProxyBadge = { label: string; tone: "ok" | "busy" | "error" | "neutral" | "none" };

export function proxyBadge(asset: Asset, state: ProxyState | undefined): ProxyBadge {
  if (asset.kind !== "video") return { label: "", tone: "none" };
  if (state?.state === "failed") return { label: "Optimization failed", tone: "error" };
  if (state?.state === "running") return { label: `Optimizing preview ${state.percent}%`, tone: "busy" };
  if (state?.state === "queued") return { label: "Optimization queued", tone: "busy" };
  if (asset.proxyPath) return { label: "Preview ready", tone: "ok" };
  if (state?.state === "cancelled") return { label: "Optimization cancelled", tone: "neutral" };
  return { label: "Original preview", tone: "none" };
}
