import { useCallback, useEffect, useRef, useState } from "react";
import { ProxyStateSchema, TOKEN_QUERY, type ProxyState } from "@ve/schema";
import type { EngineConfig } from "./engine.js";
import { getProxyStates } from "./projectApi.js";
import { previewProblem, type PreviewProblem } from "./previewErrors.js";

type EventUpdate = { revision: number; state: ProxyState };

export function useProxyStatus(config: EngineConfig, onDone: () => void) {
  const [states, setStates] = useState<Map<string, ProxyState>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<PreviewProblem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const onDoneRef = useRef(onDone);
  const requestId = useRef(0);
  const revision = useRef(0);
  const eventUpdates = useRef(new Map<string, EventUpdate>());
  const reconciledDone = useRef(new Set<string>());
  onDoneRef.current = onDone;

  const notifyDone = useCallback((statesToCheck: Iterable<ProxyState>) => {
    for (const state of statesToCheck) {
      if (state.state !== "done" || reconciledDone.current.has(state.assetId)) continue;
      reconciledDone.current.add(state.assetId);
      onDoneRef.current();
    }
  }, []);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    const startRevision = revision.current;
    setRefreshing(true);
    const result = await getProxyStates(config);
    if (request !== requestId.current) return false;
    setRefreshing(false);
    if (!result.ok) {
      setError(`[${result.code}] ${result.message}`);
      setProblem(previewProblem(result.code, `[${result.code}] ${result.message}`, "preview-status", "status", result.diagnosticId));
      return false;
    }
    const next = new Map(result.data.proxies.map((state) => [state.assetId, state]));
    for (const [assetId, update] of eventUpdates.current) {
      if (update.revision > startRevision) next.set(assetId, update.state);
    }
    setStates(next);
    setError(null);
    setProblem(null);
    notifyDone(next.values());
    return true;
  }, [config, notifyDone]);

  useEffect(() => {
    requestId.current++;
    revision.current = 0;
    eventUpdates.current.clear();
    reconciledDone.current.clear();
    setStates(new Map());
    setError(null);
    setProblem(null);
    setRefreshing(false);
  }, [config.url, config.token]);

  useEffect(() => {
    let active = true;
    if (typeof EventSource === "undefined") {
      setError("Live proxy updates are unavailable. Refresh proxy status to reconcile.");
      setProblem(previewProblem("PREVIEW_EVENTS_UNAVAILABLE", "EventSource is unavailable in this environment.", "preview-status", "status"));
      void refresh();
      return () => {
        active = false;
        requestId.current++;
      };
    }

    const source = new EventSource(`${config.url}/project/events?${TOKEN_QUERY}=${encodeURIComponent(config.token)}`);
    const onOpen = () => { if (active) void refresh(); };
    const onError = () => {
      if (!active) return;
      setError("Live proxy updates disconnected. Reconciling with engine status; retry if refresh fails.");
      setProblem(previewProblem("PREVIEW_EVENTS_DISCONNECTED", "The preview event stream disconnected.", "preview-status", "status"));
      void refresh();
    };
    const onProxy = (event: Event) => {
      if (!active) return;
      let payload: unknown;
      try { payload = JSON.parse((event as MessageEvent<string>).data); }
      catch {
        setError("The engine sent an invalid proxy event. Refresh proxy status to reconcile.");
        setProblem(previewProblem("PREVIEW_EVENT_INVALID", "The preview event was not valid JSON.", "preview-status", "status"));
        void refresh();
        return;
      }
      const parsed = ProxyStateSchema.safeParse(payload);
      if (!parsed.success) {
        setError("The engine sent an invalid proxy event. Refresh proxy status to reconcile.");
        setProblem(previewProblem("PREVIEW_EVENT_INVALID", "The preview event did not match the state schema.", "preview-status", "status"));
        void refresh();
        return;
      }
      const state = parsed.data;
      const update = { revision: ++revision.current, state };
      eventUpdates.current.set(state.assetId, update);
      setStates((previous) => new Map(previous).set(state.assetId, state));
      notifyDone([state]);
    };
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    source.addEventListener("proxy", onProxy);
    void refresh();
    window.addEventListener("focus", onOpen);
    return () => {
      active = false;
      requestId.current++;
      source.close();
      window.removeEventListener("focus", onOpen);
    };
  }, [config.url, config.token, refresh, notifyDone]);

  return { states, error, problem, refreshing, refresh };
}
