import { useEffect, useRef, useState } from "react";
import type { Asset, Project, ProxyState } from "@ve/schema";
import { assetSeconds, formatDuration, formatFps, proxyBadge } from "../assets.js";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { getImportOperation, getProject, importFiles } from "../projectApi.js";

type Props = {
  config: EngineConfig;
  project: Project;
  proxyStates: Map<string, ProxyState>;
  offline: ReadonlySet<string>;
  onProject: (project: Project) => void;
  onAddToTimeline: (asset: Asset) => void;
  enabled?: boolean;
};

export function AssetsPane({ config, project, proxyStates, offline, onProject, onAddToTimeline, enabled = true }: Props) {
  const bridge = getBridge();
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [operationPhase, setOperationPhase] = useState<"idle" | "pending" | "unknown" | "checking" | "reconciled">("idle");
  const pending = useRef(false);
  const attempt = useRef<string | null>(null);
  const generation = useRef(0);
  const [typedPath, setTypedPath] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    pending.current = false;
    attempt.current = null;
    setOperationPhase("idle");
    setBusy(false);
    setPicking(false);
    setProblems([]);
    setTypedPath("");
    return () => { generation.current++; };
  }, [project.id, config.url, config.token]);

  useEffect(() => {
    if (enabled) return;
    generation.current++;
    setPicking(false);
    if (!attempt.current) {
      pending.current = false;
      setBusy(false);
      setOperationPhase("idle");
      setProblems([]);
      setTypedPath("");
    } else {
      setBusy(false);
      setOperationPhase("unknown");
      setProblems(["The editor is closing while an import may still be running. Check status before retrying."]);
    }
  }, [enabled]);

  async function runImport(paths: string[], mode: "copy" | "reference", owner: number): Promise<boolean> {
    if (paths.length === 0 || owner !== generation.current) return false;
    const attemptId = crypto.randomUUID();
    attempt.current = attemptId;
    setOperationPhase("pending");
    setPicking(false);
    setBusy(true);
    setProblems([]);
    const result = await importFiles(config, { attemptId, paths, mode });
    if (owner !== generation.current) return false;
    setBusy(false);
    if (!result.ok) {
      if (["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN_ORIGIN", "IMPORT_OPERATION_BUSY"].includes(result.code)) {
        pending.current = false;
        attempt.current = null;
        setOperationPhase("idle");
        setProblems([`[${result.code}] ${result.message}`]);
      } else {
        setOperationPhase("unknown");
        setProblems([`[${result.code}] ${result.message} Check import status before retrying.`]);
      }
      return false;
    }
    pending.current = false;
    attempt.current = null;
    setOperationPhase("idle");
    onProject(result.data.project);
    setProblems(result.data.failed.map((f) => `${f.path.split(/[\\/]/).pop()}: [${f.code}] ${f.message}`));
    return result.data.failed.length === 0;
  }

  async function checkImportStatus() {
    const attemptId = attempt.current;
    if (!attemptId || operationPhase === "checking") return;
    const owner = generation.current;
    setOperationPhase("checking");
    const result = await getImportOperation(config, attemptId);
    if (owner !== generation.current || attempt.current !== attemptId) return;
    if (!result.ok) {
      setOperationPhase("unknown");
      setProblems([`[${result.code}] ${result.message} Import outcome remains unconfirmed.`]);
      return;
    }
    if (result.data.state === "pending") {
      setOperationPhase("pending");
      setProblems(["The engine is still processing this import. Check again before retrying."]);
    } else if (result.data.state === "done") {
      if (result.data.response.project.id !== project.id) {
        setOperationPhase("unknown");
        setProblems(["The completed import belongs to a different project. Refresh and inspect the current project before retrying."]);
        return;
      }
      pending.current = false;
      attempt.current = null;
      setOperationPhase("idle");
      onProject(result.data.response.project);
      setProblems(result.data.response.failed.map((f) => `${f.path.split(/[\\/]/).pop()}: [${f.code}] ${f.message}`));
      if (result.data.response.failed.length === 0) setTypedPath("");
    } else if (result.data.state === "failed") {
      pending.current = false;
      attempt.current = null;
      setOperationPhase("idle");
      setProblems([`[${result.data.error.code}] ${result.data.error.message}`]);
    } else {
      setOperationPhase("unknown");
      setProblems([`[${result.data.error.code}] ${result.data.error.message}`]);
    }
  }

  async function refreshProjectForReconciliation() {
    if (operationPhase !== "unknown") return;
    const owner = generation.current;
    const result = await getProject(config);
    if (owner !== generation.current || !attempt.current) return;
    if (!result.ok) {
      setProblems([`[${result.code}] ${result.message} The import outcome remains unconfirmed.`]);
      return;
    }
    if (result.data.project.id !== project.id) {
      setProblems(["A different project is open. The import outcome remains unconfirmed; inspect that project before retrying."]);
      return;
    }
    onProject(result.data.project);
    setOperationPhase("reconciled");
    setProblems(["Project state refreshed. Verify the asset list before explicitly allowing another import attempt."]);
  }

  function allowRetryAfterReconciliation() {
    if (operationPhase !== "reconciled") return;
    pending.current = false;
    attempt.current = null;
    setOperationPhase("idle");
    setProblems([]);
  }

  async function submitPath() {
    if (!enabled || pending.current || !typedPath.trim()) return;
    pending.current = true;
    const owner = generation.current;
    const success = await runImport([typedPath.trim()], copy ? "copy" : "reference", owner);
    if (success && owner === generation.current) setTypedPath("");
  }

  async function pick() {
    if (!enabled || pending.current || !bridge?.pickMedia) return;
    pending.current = true;
    const owner = generation.current;
    const mode = copy ? "copy" : "reference";
    setPicking(true);
    setProblems([]);
    let paths: string[];
    try { paths = await bridge.pickMedia("Import media"); }
    catch (error) {
      if (owner !== generation.current) return;
      pending.current = false;
      setPicking(false);
      setProblems([`[MEDIA_PICK_FAILED] ${error instanceof Error ? error.message : "Could not choose media."} Retry Import media.`]);
      return;
    }
    if (owner !== generation.current) return;
    if (paths.length === 0) {
      pending.current = false;
      setPicking(false);
      return;
    }
    await runImport(paths, mode, owner);
  }

  return (
    <section className="pane" aria-label="Assets">
      <h2>Assets</h2>
      {bridge?.pickMedia ? (
        <button onClick={() => void pick()} disabled={!enabled || pending.current || picking}>
          {picking ? "Choosing media..." : busy ? "Importing…" : "Import media"}
        </button>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void submitPath();
          }}
        >
          <input
            aria-label="File path"
            placeholder="Full file path (browser only)"
            value={typedPath}
            disabled={!enabled || pending.current || picking}
            onChange={(e) => setTypedPath(e.target.value)}
          />
          <button type="submit" disabled={!enabled || pending.current || picking || !typedPath.trim()}>Import</button>
        </form>
      )}
      <label className="check">
        <input type="checkbox" checked={copy} disabled={!enabled || pending.current || picking} onChange={(e) => {
          if (enabled && !pending.current) setCopy(e.target.checked);
        }} />
        Copy files into the project
      </label>
      {picking && <p role="status">Choosing media... Leaving this editor discards the selection; no import has started.</p>}
      {busy && <p role="status">Importing media... Leaving this editor does not cancel an import already sent to the engine.</p>}
      {["pending", "unknown", "checking"].includes(operationPhase) && (
        <div>
          <p role="status">Import outcome is not yet confirmed. Do not retry until its status is checked.</p>
          <button onClick={() => void checkImportStatus()} disabled={!enabled || operationPhase === "checking"}>
            {operationPhase === "checking" ? "Checking import status..." : "Check import status"}
          </button>
        </div>
      )}
      {operationPhase === "unknown" && (
        <button onClick={() => void refreshProjectForReconciliation()} disabled={!enabled}>Refresh project state</button>
      )}
      {operationPhase === "reconciled" && (
        <button onClick={allowRetryAfterReconciliation} disabled={!enabled}>I checked; allow another import attempt</button>
      )}
      {problems.map((p) => (
        <p key={p} role="alert" className="error">{p}</p>
      ))}
      {project.assets.length === 0 ? (
        <p className="placeholder">No media yet. Import a video to begin.</p>
      ) : (
        <ul className="assets">
          {project.assets.map((asset) => {
            const badge = proxyBadge(asset, proxyStates.get(asset.id));
            const isOffline = offline.has(asset.id);
            return (
              <li key={asset.id}>
                <strong title={asset.sourcePath}>{asset.name}</strong>
                <span className="muted">
                  {asset.kind === "video" ? `${asset.width}×${asset.height} · ${formatFps(asset.fps)} · ` : "Audio · "}
                  {formatDuration(assetSeconds(asset))}
                  {asset.mediaMode === "copy" ? " · copied" : ""}
                </span>
                {isOffline && <span className="badge offline" title="The source file cannot be found">Offline</span>}
                {badge.tone !== "none" && <span className={`badge ${badge.tone}`}>{badge.label}</span>}
                {asset.kind === "video" && (
                  <button onClick={() => onAddToTimeline(asset)} disabled={isOffline} aria-label={`Add ${asset.name} to timeline`}>
                    Add to timeline
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
