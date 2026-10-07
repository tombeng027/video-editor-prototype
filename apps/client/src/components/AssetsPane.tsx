import { useState } from "react";
import type { Asset, Project, ProxyState } from "@ve/schema";
import { assetSeconds, formatDuration, formatFps, proxyBadge } from "../assets.js";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { importFiles } from "../projectApi.js";

type Props = {
  config: EngineConfig;
  project: Project;
  proxyStates: Map<string, ProxyState>;
  onProject: (project: Project) => void;
  onAddToTimeline: (asset: Asset) => void;
};

export function AssetsPane({ config, project, proxyStates, onProject, onAddToTimeline }: Props) {
  const bridge = getBridge();
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typedPath, setTypedPath] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  async function runImport(paths: string[]) {
    if (paths.length === 0) return;
    setBusy(true);
    setProblems([]);
    const result = await importFiles(config, { paths, mode: copy ? "copy" : "reference" });
    setBusy(false);
    if (!result.ok) {
      setProblems([result.message]);
      return;
    }
    onProject(result.data.project);
    setProblems(result.data.failed.map((f) => `${f.path.split(/[\\/]/).pop()}: ${f.message}`));
  }

  async function pick() {
    const paths = (await bridge?.pickMedia?.("Import media")) ?? [];
    await runImport(paths);
  }

  return (
    <section className="pane" aria-label="Assets">
      <h2>Assets</h2>
      {bridge?.pickMedia ? (
        <button onClick={() => void pick()} disabled={busy}>
          {busy ? "Importing…" : "Import media"}
        </button>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void runImport([typedPath.trim()]).then(() => setTypedPath(""));
          }}
        >
          <input
            aria-label="File path"
            placeholder="Full file path (browser only)"
            value={typedPath}
            onChange={(e) => setTypedPath(e.target.value)}
          />
          <button type="submit" disabled={busy || !typedPath.trim()}>Import</button>
        </form>
      )}
      <label className="check">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        Copy files into the project
      </label>
      {problems.map((p) => (
        <p key={p} role="alert" className="error">{p}</p>
      ))}
      {project.assets.length === 0 ? (
        <p className="placeholder">No media yet. Import a video to begin.</p>
      ) : (
        <ul className="assets">
          {project.assets.map((asset) => {
            const badge = proxyBadge(asset, proxyStates.get(asset.id));
            return (
              <li key={asset.id}>
                <strong title={asset.sourcePath}>{asset.name}</strong>
                <span className="muted">
                  {asset.kind === "video" ? `${asset.width}×${asset.height} · ${formatFps(asset.fps)} · ` : "Audio · "}
                  {formatDuration(assetSeconds(asset))}
                  {asset.mediaMode === "copy" ? " · copied" : ""}
                </span>
                {badge.tone !== "none" && <span className={`badge ${badge.tone}`}>{badge.label}</span>}
                {asset.kind === "video" && (
                  <button onClick={() => onAddToTimeline(asset)} aria-label={`Add ${asset.name} to timeline`}>
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
