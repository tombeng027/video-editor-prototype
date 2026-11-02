import { useEffect, useRef, useState } from "react";
import type { ProjectResponse } from "@ve/schema";
import type { EngineConfig } from "./engine.js";
import { diagnosticMessage, getProjectOperation, type ApiResult } from "./projectApi.js";

const rejectedCodes = new Set(["INVALID_REQUEST", "INVALID_PATH", "ALREADY_EXISTS", "NOT_FOUND", "CORRUPT",
  "STORE_IO_FAILED", "SAVE_FAILED", "SAVE_CLEANUP_FAILED", "PROJECT_OPERATION_BUSY"]);

export function useProjectOperation(config: EngineConfig, onOpened: (response: ProjectResponse) => void) {
  const [phase, setPhase] = useState<"idle" | "pending" | "unknown" | "checking">("idle");
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const checking = useRef(false);
  const attempt = useRef("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const finish = (result: ApiResult<ProjectResponse>) => {
    if (!mounted.current) return;
    if (result.ok) { onOpened(result.data); return; }
    setError(`[${result.code}] ${result.message}`);
    const unknown = !rejectedCodes.has(result.code);
    locked.current = unknown;
    setPhase(unknown ? "unknown" : "idle");
  };
  const start = async (submit: (attemptId: string) => Promise<ApiResult<ProjectResponse>>) => {
    if (locked.current) return;
    locked.current = true;
    attempt.current = crypto.randomUUID();
    setPhase("pending");
    setError(null);
    finish(await submit(attempt.current));
  };
  const check = async () => {
    if (!locked.current || checking.current || phase !== "unknown") return;
    checking.current = true;
    setPhase("checking");
    const result = await getProjectOperation(config, attempt.current);
    if (!mounted.current) return;
    checking.current = false;
    if (!result.ok) {
      setError(`[${result.code}] ${result.message} Outcome is still unconfirmed. Check again; if the engine restarted, reload only after confirming the old engine stopped.`);
    } else if (result.data.attemptId !== attempt.current) {
      setError("[BAD_RESPONSE] Status identifies a different project attempt.");
    } else if (result.data.state === "pending") {
      setError("The engine is still preparing this project. Check again; no create/open retry was sent.");
    } else if (result.data.state === "done") {
      onOpened(result.data.response);
      return;
    } else {
      locked.current = false;
      setPhase("idle");
      setError(`[${result.data.error.code}] ${diagnosticMessage(result.data.error)}`);
      return;
    }
    setPhase("unknown");
  };
  return { start, check, phase, error, locked, busy: phase !== "idle" };
}
