export type PaneSizes = {
  assetsWidth: number;
  assistantWidth: number;
  timelineHeight: number;
  assistantOpen: boolean;
};

export const DEFAULT_SIZES: PaneSizes = {
  assetsWidth: 260,
  assistantWidth: 340,
  timelineHeight: 280,
  assistantOpen: true,
};

export const LIMITS = {
  assetsWidth: { min: 180, max: 520 },
  assistantWidth: { min: 260, max: 640 },
  timelineHeight: { min: 160, max: 700 },
} as const;

const STORAGE_KEY = "ve.layout.v1";

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

type Numeric = Exclude<keyof PaneSizes, "assistantOpen">;

export function clampSize(key: Numeric, value: number): number {
  return clamp(Math.round(value), LIMITS[key].min, LIMITS[key].max);
}

export function loadSizes(storage: Pick<Storage, "getItem">): PaneSizes {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIZES };
    const parsed = JSON.parse(raw) as Partial<Record<keyof PaneSizes, unknown>>;
    const pick = (key: Numeric): number => {
      const v = parsed[key];
      return typeof v === "number" && Number.isFinite(v) ? clampSize(key, v) : DEFAULT_SIZES[key];
    };
    return {
      assetsWidth: pick("assetsWidth"),
      assistantWidth: pick("assistantWidth"),
      timelineHeight: pick("timelineHeight"),
      assistantOpen:
        typeof parsed.assistantOpen === "boolean" ? parsed.assistantOpen : DEFAULT_SIZES.assistantOpen,
    };
  } catch {
    return { ...DEFAULT_SIZES };
  }
}

export function saveSizes(storage: Pick<Storage, "setItem">, sizes: PaneSizes): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // Persistence is best effort.
  }
}
