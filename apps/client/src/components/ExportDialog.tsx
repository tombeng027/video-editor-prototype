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
  const pendingStart = useRef(false);
  const bridge = getBridge();

  const start = useCallback(async () => {
    if (pendingStart.current) return;
    pendingStart.current = true;
    setStarting(true);
    setError(null);
    const result = await startExport(config);
    if (result.ok) setState(result.data);
    else setError(result.message);
    pendingStart.current = false;
    setStarting(false);
  }, [config]);

  useEffect(() => {
    if (state.state !== "running") return;
    const timer = setInterval(() => {
      void getExport(config).then((r) => r.ok && setState(r.data));
    }, 500);
    return () => clearInterval(timer);
  }, [config, state.state]);

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

        <div className="row modal-actions">
          {running ? (
            <button onClick={() => void cancelExport(config).then((r) => r.ok && setState(r.data))}>Cancel export</button>
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