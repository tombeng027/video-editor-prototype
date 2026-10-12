import { useMemo, useRef, useState } from "react";
import type { ProjectResponse } from "@ve/schema";
import { Editor } from "./components/Editor.js";
import { Landing } from "./components/Landing.js";
import { getBridge } from "./desktop.js";
import { resolveEngineConfig } from "./engine.js";
import { closeProject, getProject } from "./projectApi.js";
import { Modal } from "./components/Modal.js";
import { useHealth } from "./useHealth.js";

export function App() {
  const config = useMemo(
    () => resolveEngineConfig(getBridge(), import.meta.env as Record<string, string | undefined>),
    [],
  );
  const health = useHealth(config);
  const [opened, setOpened] = useState<ProjectResponse | null>(null);
  const [closing, setClosing] = useState<"pending" | "unknown" | "retry" | "changed" | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<ProjectResponse | null>(null);
  const pendingClose = useRef(false);

  const close = async () => {
    if (pendingClose.current) return;
    pendingClose.current = true;
    setClosing("pending");
    setCloseError(null);
    const result = await closeProject(config, opened ? { id: opened.project.id, folder: opened.folder } : undefined);
    pendingClose.current = false;
    if (result.ok) {
      setOpened(null);
      setClosing(null);
      setReconciled(null);
    } else {
      setCloseError(`[${result.code}] ${result.message} Close completion is not confirmed. Check project status before retrying.`);
      setClosing("unknown");
    }
  };

  const checkClose = async () => {
    if (pendingClose.current) return;
    pendingClose.current = true;
    setClosing("pending");
    const result = await getProject(config);
    pendingClose.current = false;
    if (!result.ok) {
      if (result.code === "NO_PROJECT") {
        setCloseError("The engine has no open project, but background cleanup was not confirmed. Retry close to confirm cleanup before returning to Projects.");
        setClosing("retry");
      } else {
        setCloseError(`[${result.code}] ${result.message} Project status is still unknown.`);
        setClosing("unknown");
      }
    } else if (result.data.project.id === opened?.project.id && result.data.folder === opened.folder) {
      setCloseError("The same project is still open. You can retry close; it will wait for background cleanup.");
      setClosing("retry");
    } else {
      setReconciled(result.data);
      setCloseError("The engine has a different project open. It has not been closed. Use its authoritative state to continue.");
      setClosing("changed");
    }
  };

  if (!opened) return <Landing config={config} health={health} onOpened={setOpened} />;
  return (
    <>
      <Editor
        key={`${opened.project.id}|${opened.folder}`}
        config={config}
        project={opened.project}
        folder={opened.folder}
        health={health}
        warnings={opened.warnings}
        onClose={() => { if (closing === null) void close(); }}
      />
      {closing !== null && (
        <Modal label="Close project" dismissible={false} onClose={() => undefined}>
          <h2>Close project</h2>
          {closing === "pending" && <p role="status">Checking project/close completion... Waiting for the engine and background cleanup.</p>}
          {closing !== "pending" && closeError && <p role="alert" className="error">{closeError}</p>}
          <div className="row modal-actions">
            {closing === "unknown" && <button onClick={() => void checkClose()}>Check project status</button>}
            {closing === "retry" && <button onClick={() => void close()}>Retry close</button>}
            {closing === "changed" && reconciled && <button onClick={() => {
              setOpened({ ...reconciled, warnings: [
                ...(reconciled.warnings ?? []),
                { code: "PROJECT_RECONCILED", message: "The editor adopted the engine's active project after close recovery. No close was sent to this different project." },
              ] });
              setClosing(null);
              setReconciled(null);
            }}>Use active project</button>}
          </div>
        </Modal>
      )}
    </>
  );
}
