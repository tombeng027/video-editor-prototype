import { useEffect, useState } from "react";
import type { ProjectResponse, RecentProject } from "@ve/schema";
import { getBridge } from "../desktop.js";
import type { EngineConfig, HealthResult } from "../engine.js";
import { listRecent, openProject, type ApiResult } from "../projectApi.js";
import { NewProjectDialog } from "./NewProjectDialog.js";
import { StatusArea } from "./StatusArea.js";

type Props = {
  config: EngineConfig;
  health: HealthResult | null;
  onOpened: (response: ProjectResponse) => void;
};

export function Landing({ config, health, onOpened }: Props) {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pickFolder = getBridge()?.pickFolder;
  const engineReady = health?.state === "ok";

  useEffect(() => {
    if (engineReady) void listRecent(config).then(setRecent);
  }, [config, engineReady]);

  const finish = (result: ApiResult<ProjectResponse>) => {
    setBusy(false);
    if (!result.ok) return setMessage(result.message);
    if (result.data.recoveredFromBackup) {
      window.alert("The project file was damaged, so the last backup was loaded instead.");
    }
    onOpened(result.data);
  };

  const open = async (folder: string) => {
    setBusy(true);
    setMessage(null);
    finish(await openProject(config, folder));
  };

  const browseAndOpen = async () => {
    const folder = pickFolder ? await pickFolder("Open project folder") : window.prompt("Project folder path");
    if (folder) await open(folder);
  };

  return (
    <main className="landing">
      <h1>Video Editor Prototype</h1>
      <div className="actions">
        <button className="primary" disabled={!engineReady || busy} onClick={() => setCreating(true)}>
          Create new project
        </button>
        <button disabled={!engineReady || busy} onClick={() => void browseAndOpen()}>
          Open project…
        </button>
      </div>
      {!engineReady && <p className="placeholder">Waiting for the engine…</p>}
      {message && <p role="alert" className="error">{message}</p>}
      <section aria-label="Recent projects">
        <h2>Recent projects</h2>
        {recent.length === 0 ? (
          <p className="placeholder">No recent projects yet.</p>
        ) : (
          <ul className="recent">
            {recent.map((p) => (
              <li key={p.folder}>
                <button disabled={!p.exists || busy} onClick={() => void open(p.folder)}>
                  <strong>{p.name}</strong>
                  <span className="muted">{p.exists ? p.folder : `${p.folder} (not found)`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <StatusArea result={health} />
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
