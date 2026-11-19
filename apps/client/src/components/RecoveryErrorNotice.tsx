import { useEffect, useRef, useState } from "react";
import { errorFingerprint, findErrorDefinition, type ErrorContext } from "@ve/schema";
import type { EngineConfig } from "../engine.js";
import { recordUnknownEditError } from "../projectApi.js";
import { EditErrorNotice } from "./EditErrorNotice.js";

export function RecoveryErrorNotice({ config, problem, recordUnknown = true }: {
  config: EngineConfig; problem: { context: ErrorContext; detail: string }; recordUnknown?: boolean;
}) {
  const [recordingFailed, setRecordingFailed] = useState(false);
  const recorded = useRef(new Set<string>());
  const { context } = problem;
  const fingerprint = errorFingerprint(context);
  useEffect(() => {
    if (!recordUnknown || findErrorDefinition(context)) return;
    const key = `${fingerprint}:${context.diagnosticId ?? ""}`;
    if (recorded.current.has(key)) return;
    recorded.current.add(key);
    void recordUnknownEditError(config, context).then((result) => {
      if (!result.ok) setRecordingFailed(true);
    });
  }, [config, context, fingerprint, recordUnknown]);
  return <>
    <EditErrorNotice {...problem} />
    {recordingFailed && <p role="alert" className="error">This unknown {context.operation.startsWith("export") ? "export" : "preview"} problem could not be recorded for development. Check the engine connection, inbox capacity and diagnostic storage. Recovery safety is unchanged.</p>}
  </>;
}
