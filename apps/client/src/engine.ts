import { HealthResponseSchema, TOKEN_HEADER, type HealthResponse } from "@ve/schema";

export type EngineConfig = { url: string; token: string };

type DesktopBridge = { engine?: { url?: string; token?: string } };

export function resolveEngineConfig(
  bridge: DesktopBridge | undefined,
  env: Record<string, string | undefined>,
): EngineConfig {
  return {
    url: bridge?.engine?.url ?? env.VITE_ENGINE_URL ?? "http://127.0.0.1:7878",
    token: bridge?.engine?.token ?? env.VITE_ENGINE_TOKEN ?? "dev-token",
  };
}

export type HealthResult =
  | { state: "ok"; health: HealthResponse }
  | { state: "error"; message: string };

export async function fetchHealth(
  config: EngineConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthResult> {
  try {
    const res = await fetchImpl(`${config.url}/health`, {
      headers: { [TOKEN_HEADER]: config.token },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 401) {
      return { state: "error", message: "The engine rejected the session token." };
    }
    if (!res.ok) return { state: "error", message: `Engine returned HTTP ${res.status}.` };
    const parsed = HealthResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { state: "error", message: "Engine sent an unexpected response." };
    return { state: "ok", health: parsed.data };
  } catch {
    return { state: "error", message: "Cannot reach the engine. Is it running?" };
  }
}
