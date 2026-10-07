import { useEffect, useRef, useState } from "react";
import { ProxyStateSchema, TOKEN_QUERY, type ProxyState } from "@ve/schema";
import type { EngineConfig } from "./engine.js";

/** Follows proxy progress over server-sent events; `onDone` fires when a proxy finishes. */
export function useProxyStatus(config: EngineConfig, onDone: () => void): Map<string, ProxyState> {
  const [states, setStates] = useState<Map<string, ProxyState>>(new Map());
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const source = new EventSource(`${config.url}/project/events?${TOKEN_QUERY}=${encodeURIComponent(config.token)}`);
    source.addEventListener("proxy", (event) => {
      const parsed = ProxyStateSchema.safeParse(JSON.parse((event as MessageEvent<string>).data));
      if (!parsed.success) return;
      const state = parsed.data;
      setStates((prev) => new Map(prev).set(state.assetId, state));
      if (state.state === "done") onDoneRef.current();
    });
    return () => source.close();
  }, [config.url, config.token]);

  return states;
}
