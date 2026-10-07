import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportState } from "@ve/schema";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { cancelExport, getExport, startExport } from "../projectApi.js";

type Props = { config: EngineConfig; onClose: () => void };

export function ExportDialog({ config, onClose }: Props) {
  const [state, setState] = useState<ExportState>({ state: "idle", percent: 0 });
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bridge = getBridge();

  const start = useCallback(async () => {
    setError(null);
    const result = await startExport(config);
    if (result.ok) setState(result.data);
    else setError(result.message);
  }, [config]);

  useEffect(() => {
    if (state.state !== "running") return;
    const timer = setInterval(() => {
      void getExport(config).then((r) => r.ok && setState(r.data));
    }, 500);
    return () => clearInterval(timer);
  }, [config, state.state]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const running = state.state === "running";

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Export video" onKeyDown={(e) => e.key === "Escape" && !running && onClose()}>
        <h2>Export video</h2>
        <p className="muted">Renders the whole timeline to an MP4 (H.264 + AAC) from your original media, at the project's size and frame rate.</p>

        {state.state === "idle" && !error && <p>Ready to export into the project's exports folder.</p>}
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
              <button onClick={() => void start()}>{state.state === "idle" && !error ? "Start export" : "Export again"}</button>
              <button ref={closeRef} onClick={onClose}>Close</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}