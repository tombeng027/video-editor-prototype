import type { Asset, ProxyState } from "@ve/schema";

export function assetSeconds(asset: Pick<Asset, "durationFrames" | "fps">): number {
  return asset.fps ? (asset.durationFrames * asset.fps.den) / asset.fps.num : 0;
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

export type ProxyBadge = { label: string; tone: "ok" | "busy" | "error" | "none" };

export function proxyBadge(asset: Asset, state: ProxyState | undefined): ProxyBadge {
  if (asset.kind !== "video") return { label: "", tone: "none" };
  if (state?.state === "failed") return { label: "Preview failed", tone: "error" };
  if (state?.state === "running") return { label: `Preparing preview ${state.percent}%`, tone: "busy" };
  if (state?.state === "queued") return { label: "Preview queued", tone: "busy" };
  if (asset.proxyPath) return { label: "Preview ready", tone: "ok" };
  return { label: "Preparing preview", tone: "busy" };
}
