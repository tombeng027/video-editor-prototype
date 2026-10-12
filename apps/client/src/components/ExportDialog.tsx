import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportState } from "@ve/schema";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { cancelExport, getExport, startExport } from "../projectApi.js";
import { Modal } from "./Modal.js";

type Props = { config: EngineConfig; onClose: () => void };

export function ExportDialog({ config, onClose }: Props) {
  const [state, setState] = useState<ExportState>({ state: "idle", percent: 0 });
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const pendingStart = useRef(false);
  const pendingCancel = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  const bridge = getBridge();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; };
  }, []);

  const start = useCallback(async () => {
    if (pendingStart.current) return;
    pendingStart.current = true;
    const request = ++revision.current;
    setStarting(true);
    setError(null);
    setPollError(null);
    setCancelRequested(false);
    const result = await startExport(config);
    if (!mounted.current || request !== revision.current) return;
    if (result.ok) setState(result.data);
    else setError(`[${result.code}] ${result.message}`);
    pendingStart.current = false;
    setStarting(false);
  }, [config]);

  useEffect(() => {
    if (state.state !== "running" || cancelling || pollError) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const request = revision.current;
      const result = await getExport(config);
      if (!active || request !== revision.current || pendingCancel.current) return;
      if (!result.ok) {
        setPollError(`[${result.code}] ${result.message} Export status is unknown; retry the status check.`);
        return;
      }
      setState(result.data);
      if (result.data.state === "running") timer = setTimeout(() => void poll(), 500);
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { active = false; clearTimeout(timer); };
  }, [config, state.state, cancelling, pollError, pollAttempt]);

  const cancel = async () => {
    if (pendingCancel.current || cancelRequested) return;
    pendingCancel.current = true;
    const request = ++revision.current;
    setCancelling(true);
    setError(null);
    setPollError(null);
    const result = await cancelExport(config);
    if (!mounted.current || request !== revision.current) return;
    if (result.ok) {
      setState(result.data);
      setCancelRequested(result.data.state === "running");
    }
    else setError(`[${result.code}] ${result.message} Cancellation was not confirmed; check status before retrying.`);
    pendingCancel.current = false;
    setCancelling(false);
    setPollAttempt((attempt) => attempt + 1);
  };

  const running = state.state === "running";
  const close = () => {
    if (!pendingStart.current && !running) onClose();
  };

  return (
    <Modal label="Export video" dismissible={!running && !starting} onClose={close}>
        <h2>Export video</h2>
        <p className="muted">Renders the whole timeline to an MP4 (H.264 + AAC) from your original media, at the project's size and frame rate.</p>

        {starting && <p role="status">Starting export... Please wait.</p>}
        {state.state === "idle" && !error && !starting && <p>Ready to export into the project's exports folder.</p>}
        {running && (
          <>
            <progress value={state.percent} max={100} aria-label="Export progress" />
            <p>{Math.round(state.percent)}%</p>
          </>
        )}
        {state.state === "done" && (
          <p role="status">
            Export finished: <code>{state.outputPath}</code>
          </p>
        )}
        {state.state === "cancelled" && <p role="status">Export cancelled.</p>}
        {state.state === "failed" && <p role="alert" className="error">{state.message ?? "Export failed."}</p>}
        {error && <p role="alert" className="error">{error}</p>}
        {pollError && <p role="alert" className="error">{pollError}</p>}
        {cancelling && <p role="status">Requesting cancellation... Waiting for the engine.</p>}
        {running && cancelRequested && <p role="status">Cancellation requested. Waiting for export cleanup to finish.</p>}

        <div className="row modal-actions">
          {running ? (
            <>
              <button disabled={cancelling || cancelRequested} onClick={() => void cancel()}>{cancelling ? "Requesting cancellation..." : "Cancel export"}</button>
              {pollError && <button onClick={() => {
                setPollError(null);
                setPollAttempt((attempt) => attempt + 1);
              }}>Retry status check</button>}
            </>
          ) : (
            <>
              {state.state === "done" && state.outputPath && bridge?.revealInFolder && (
                <button onClick={() => void bridge.revealInFolder?.(state.outputPath!)}>Show in folder</button>
              )}
              <button disabled={starting} onClick={() => void start()}>{state.state === "idle" && !error ? "Start export" : "Export again"}</button>
              <button disabled={starting} data-modal-initial-focus onClick={close}>Close</button>
            </>
          )}
        </div>
    </Modal>
  );
}