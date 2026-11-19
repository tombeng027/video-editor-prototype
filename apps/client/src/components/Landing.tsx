import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectResponse, RecentProject } from "@ve/schema";
import { getBridge } from "../desktop.js";
import type { EngineConfig, HealthResult } from "../engine.js";
import { listRecent, openProject } from "../projectApi.js";
import { useProjectOperation } from "../useProjectOperation.js";
import { Modal } from "./Modal.js";
import { NewProjectDialog } from "./NewProjectDialog.js";
import { StatusArea } from "./StatusArea.js";
import { HelpDialog } from "./HelpDialog.js";

type Props = {
  config: EngineConfig;
  health: HealthResult | null;
  onOpened: (response: ProjectResponse) => void;
};

export function Landing({ config, health, onOpened }: Props) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const operation = useProjectOperation(config, (response) => {
    onOpened(response);
  });
  const busy = picking || operation.busy;
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentLoading, setRecentLoading] = useState(false);
  const recentRequest = useRef(0);
  const pending = useRef(false);
  const pickFolder = getBridge()?.pickFolder;
  const engineReady = health?.state === "ok";

  const refreshRecent = useCallback(async () => {
    const request = ++recentRequest.current;
    setRecentLoading(true);
    const result = await listRecent(config);
    if (request !== recentRequest.current) return;
    setRecentLoading(false);
    if (result.ok) { setRecent(result.data.projects); setRecentError(null); }
    else setRecentError(`[${result.code}] ${result.message}`);
  }, [config]);

  useEffect(() => {
    if (engineReady) void refreshRecent();
    return () => { recentRequest.current++; };
  }, [engineReady, refreshRecent]);

  const open = async (folder: string) => {
    if (pending.current || operation.locked.current || creating) return;
    setMessage(null);
    await operation.start((attemptId) => openProject(config, folder, undefined, attemptId));
  };

  const browseAndOpen = async () => {
    if (pending.current || operation.locked.current || creating) return;
    pending.current = true;
    setPicking(true);
    setMessage(null);
    try {
      const folder = pickFolder ? await pickFolder("Open project folder") : window.prompt("Project folder path");
      if (folder) await operation.start((attemptId) => openProject(config, folder, undefined, attemptId));
    } catch (error) {
      setMessage(`[FOLDER_PICK_FAILED] ${error instanceof Error ? error.message : "Could not choose a folder."} Retry Open project.`);
    } finally { pending.current = false; setPicking(false); }
  };

  return (
    <main className="landing">
      <h1>Video Editor Prototype</h1>
      <button onClick={() => setHelpOpen(true)} disabled={busy || creating}>Help</button>
      <div className="actions">
        <button className="primary" disabled={!engineReady || busy} onClick={() => {
          if (!pending.current && !operation.locked.current && !creating) setCreating(true);
        }}>
          Create new project
        </button>
        <button disabled={!engineReady || busy || creating} onClick={() => void browseAndOpen()}>
          Open project…
        </button>
      </div>
      {!engineReady && <p className="placeholder">Waiting for the engine…</p>}
      {message && <p role="alert" className="error">{message}</p>}
      {operation.phase === "idle" && operation.error && <p role="alert" className="error">{operation.error}</p>}
      <section aria-label="Recent projects">
        <h2>Recent projects</h2>
        {recentError && (
          <div role="alert" className="error">
            {recentError}{" "}
            <button disabled={recentLoading} onClick={() => void refreshRecent()}>
              {recentLoading ? "Refreshing recent projects..." : "Retry recent projects"}
            </button>
          </div>
        )}
        {recent.length === 0 && !recentError ? (
          <p className="placeholder">No recent projects yet.</p>
        ) : (
          <ul className="recent">
            {recent.map((p) => (
              <li key={p.folder}>
                <button disabled={!engineReady || !p.exists || busy || creating} onClick={() => void open(p.folder)}>
                  <strong>{p.name}</strong>
                  <span className="muted">{p.exists ? p.folder : `${p.folder} (not found)`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <StatusArea result={health} />
      {helpOpen && <HelpDialog health={health} onClose={() => setHelpOpen(false)} />}
      {operation.busy && <Modal label="Open project" dismissible={false} onClose={() => undefined}>
        <h2>Open project</h2>
        <p role="status">{operation.phase === "pending" ? "Opening project... Waiting for preparation." : "Open outcome is unconfirmed. Check this attempt before retrying or leaving."}</p>
        {operation.error && <p role="alert" className="error">{operation.error}</p>}
        {(operation.phase === "unknown" || operation.phase === "checking") && <button disabled={operation.phase === "checking"} onClick={() => void operation.check()}>Check project operation</button>}
      </Modal>}
      {creating && (
        <NewProjectDialog
          config={config}
          onCancel={() => setCreating(false)}
          onCreated={(response) => {
            setCreating(false);
            onOpened(response);
          }}
        />
      )}
    </main>
  );
}
