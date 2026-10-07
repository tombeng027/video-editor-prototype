import { useEffect, useState } from "react";
import { fetchHealth, type EngineConfig, type HealthResult } from "./engine.js";

export function useHealth(config: EngineConfig, intervalMs = 10000): HealthResult | null {
  const [result, setResult] = useState<HealthResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const next = await fetchHealth(config);
      if (!cancelled) setResult(next);
    };
    void poll();
    const timer = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [config, intervalMs]);
  return result;
}
