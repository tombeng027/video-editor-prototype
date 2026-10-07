export const ENGINE_ARG_PREFIX = "--ve-engine=";

export type EngineInfo = { url: string; token: string };

// Kept free of Node imports: the sandboxed preload bundles this file.
export function encodeEngineArg(info: EngineInfo): string {
  return ENGINE_ARG_PREFIX + encodeURIComponent(JSON.stringify(info));
}

export function decodeEngineArg(argv: string[]): EngineInfo | undefined {
  const raw = argv.find((a) => a.startsWith(ENGINE_ARG_PREFIX));
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw.slice(ENGINE_ARG_PREFIX.length)));
    if (typeof parsed?.url === "string" && typeof parsed?.token === "string") return parsed;
  } catch {
    // fall through
  }
  return undefined;
}
