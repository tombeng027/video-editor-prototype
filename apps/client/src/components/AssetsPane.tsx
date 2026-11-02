import { useEffect, useRef, useState } from "react";
import type { Asset, Project, ProxyState } from "@ve/schema";
import { assetSeconds, formatDuration, formatFps, proxyBadge } from "../assets.js";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { importFiles } from "../projectApi.js";

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
  const pending = useRef(false);
  const generation = useRef(0);
  const [typedPath, setTypedPath] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    pending.current = false;
    setBusy(false);
    setPicking(false);
    setProblems([]);
    setTypedPath("");
    return () => { generation.current++; };
  }, [project.id, config.url, config.token, enabled]);

  async function runImport(paths: string[], mode: "copy" | "reference", owner: number): Promise<boolean> {
    if (paths.length === 0 || owner !== generation.current) return false;
    setPicking(false);
    setBusy(true);
    setProblems([]);
    const result = await importFiles(config, { paths, mode });
    if (owner !== generation.current) return false;
    pending.current = false;
    setBusy(false);
    if (!result.ok) {
      setProblems([`[${result.code}] ${result.message}`]);
      return false;
    }
    onProject(result.data.project);
    setProblems(result.data.failed.map((f) => `${f.path.split(/[\\/]/).pop()}: [${f.code}] ${f.message}`));
    return result.data.failed.length === 0;
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
        <button onClick={() => void pick()} disabled={!enabled || busy || picking}>
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
            disabled={!enabled || busy || picking}
            onChange={(e) => setTypedPath(e.target.value)}
          />
          <button type="submit" disabled={!enabled || busy || picking || !typedPath.trim()}>Import</button>
        </form>
      )}
      <label className="check">
        <input type="checkbox" checked={copy} disabled={!enabled || busy || picking} onChange={(e) => {
          if (enabled && !pending.current) setCopy(e.target.checked);
        }} />
        Copy files into the project
      </label>
      {picking && <p role="status">Choosing media... Leaving this editor discards the selection; no import has started.</p>}
      {busy && <p role="status">Importing media... Leaving this editor does not cancel an import already sent to the engine.</p>}
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
