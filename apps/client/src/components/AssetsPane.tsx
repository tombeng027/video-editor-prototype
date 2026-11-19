import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { findErrorDefinition, type ErrorContext, type ImportResponse, type Asset, type Project, type ProxyState } from "@ve/schema";
import { ASSET_DRAG_TYPE, assetSeconds, formatDuration, formatFps, proxyBadge } from "../assets.js";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { diagnosticMessage, getImportOperation, getProject, importFiles, recordUnknownEditError } from "../projectApi.js";
import { safeErrorContext } from "../editErrors.js";
import { EditErrorNotice } from "./EditErrorNotice.js";
import { RecoveryErrorNotice } from "./RecoveryErrorNotice.js";
import { previewProblem } from "../previewErrors.js";
import { imageUrl, proxyUrl } from "../playback.js";

function AssetThumbnail({ asset, config, offline }: { asset: Asset; config: EngineConfig; offline: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (offline || asset.kind === "audio" || loaded || failed) return;
    const timer = setTimeout(() => setFailed(true), 5000);
    return () => clearTimeout(timer);
  }, [asset.kind, failed, loaded, offline]);
  return (
    <div className="asset-thumbnail">
      {offline ? <span>Offline media</span> : failed ? (
        <span role="status" title="Right-click to retry the thumbnail, or prepare an optimized preview for unsupported video.">Thumbnail unavailable</span>
      ) : asset.kind === "image" ? (
        <img src={imageUrl(config, asset.id)} alt={`${asset.name} thumbnail`} loading="lazy" draggable={false}
          onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
      ) : asset.kind === "video" ? (
        <video src={asset.proxyPath ? proxyUrl(config, asset.id) : imageUrl(config, asset.id)}
          aria-label={`${asset.name} thumbnail`} muted playsInline preload="metadata"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2);
          }}
          onLoadedData={() => setLoaded(true)}
          onError={() => setFailed(true)} />
      ) : asset.kind === "audio" ? (
        <span className="asset-audio-icon" aria-label="Audio file">
          <svg viewBox="0 0 64 40" aria-hidden="true">
            <path d="M8 17v6m8-13v20m8-26v32m8-22v12m8-18v24m8-28v32m8-19v6" />
          </svg>
          Audio
        </span>
      ) : null}
    </div>
  );
}

type Props = {
  config: EngineConfig;
  project: Project;
  projectFolder?: string;
  proxyStates: Map<string, ProxyState>;
  offline: ReadonlySet<string>;
  onProject: (project: Project) => void;
  onAddToTimeline: (asset: Asset) => void;
  onRemoveAsset: (assetId: string) => void;
  onAssetDragStart?: () => void;
  onRelinkAsset?: (assetId: string, sourcePath: string) => void;
  onSaveStatusChange?: (status: "saving" | "unknown" | null) => void;
  onImportSaved?: () => void;
  enabled?: boolean;
  mutationsDisabled?: boolean;
  disabledReason?: string;
  onPreviewJob?: (assetId: string, action: "prepare" | "cancel") => void;
  previewJobBusy?: boolean;
};

export function AssetsPane({
  config, project, projectFolder, proxyStates, offline, onProject, onAddToTimeline, onRemoveAsset, onAssetDragStart, onRelinkAsset, onSaveStatusChange, onImportSaved,
  enabled = true, mutationsDisabled = false, disabledReason, onPreviewJob, previewJobBusy = false,
}: Props) {
  const bridge = getBridge();
  const [copy, setCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [operationPhase, setOperationPhase] = useState<"idle" | "pending" | "unknown" | "checking" | "refreshing" | "reconciled">("idle");
  const pending = useRef(false);
  const attempt = useRef<string | null>(null);
  const generation = useRef(0);
  const [typedPath, setTypedPath] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  type ImportProblem = { context: ErrorContext; detail: string; fileName?: string };
  const [importProblems, setImportProblems] = useState<ImportProblem[]>([]);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [relinkPaths, setRelinkPaths] = useState<Record<string, string>>({});
  const [relinkPicking, setRelinkPicking] = useState(false);
  const [thumbnailRetries, setThumbnailRetries] = useState<Record<string, number>>({});
  const [context, setContext] = useState<{ assetId: string; x: number; y: number } | null>(null);
  const [relinkAssetId, setRelinkAssetId] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const contextOwner = useRef<HTMLLIElement | null>(null);
  const contextAsset = context && project.assets.find((asset) => asset.id === context.assetId);
  const contextAssetUsed = contextAsset && project.tracks.some((track) => track.clips.some((clip) => clip.assetId === contextAsset.id));

  function importProblem(code: string, detail: string, stage: ErrorContext["stage"],
    outcome: ErrorContext["outcome"], diagnosticId?: string, fileName?: string): ImportProblem {
    const context = safeErrorContext(code, stage, outcome, "import", diagnosticId);
    if (!findErrorDefinition(context)) {
      const owner = generation.current;
      void recordUnknownEditError(config, context).then((result) => {
        if (owner === generation.current && !result.ok) setRecordingError(
          "This unknown import problem could not be recorded for development. Check the engine connection, inbox capacity and diagnostic storage. Import safety is unchanged.");
      });
    }
    return { context, detail, ...(fileName ? { fileName } : {}) };
  }

  function showImportProblem(code: string, detail: string, stage: ErrorContext["stage"],
    outcome: ErrorContext["outcome"], diagnosticId?: string) {
    setImportProblems([importProblem(code, detail, stage, outcome, diagnosticId)]);
  }

  function acceptImport(response: ImportResponse) {
    if (response.project.id !== project.id) {
      setOperationPhase("unknown");
      onSaveStatusChange?.("unknown");
      showImportProblem("PROJECT_CHANGED", "The import response belongs to a different project.", "status", "unconfirmed");
      return false;
    }
    pending.current = false;
    attempt.current = null;
    setOperationPhase("idle");
    onSaveStatusChange?.(null);
    onProject(response.project);
    if (response.imported.length > 0) onImportSaved?.();
    setImportSummary(`${response.imported.length} file(s) added to Assets; ${response.failed.length} file(s) not added.${response.failed.length ? " Review the failures below and retry only those files." : ""}`);
    setImportProblems(response.failed.map((failure) => importProblem(failure.code,
      diagnosticMessage(failure), "file", "not-applied", failure.diagnosticId, failure.path.split(/[\\/]/).pop())));
    return response.failed.length === 0;
  }

  function closeContext(restoreFocus = false) {
    setContext(null);
    if (restoreFocus) contextOwner.current?.focus();
  }

  useEffect(() => {
    if (!context) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setContext(null);
    };
    const close = () => setContext(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setContext(null);
        contextOwner.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [context]);

  async function pickRelink(assetId: string) {
    if (!enabled || mutationsDisabled || relinkPicking || !bridge?.pickMedia || !onRelinkAsset) return;
    const owner = generation.current;
    setRelinkPicking(true);
    setProblems([]);
    try {
      const files = await bridge.pickMedia("Locate original media");
      if (owner !== generation.current) return;
      if (files.length > 1) {
        setProblems(["Choose one replacement file for this asset."]);
      } else if (files[0]) onRelinkAsset(assetId, files[0]);
    } catch (error) {
      if (owner === generation.current) {
        setProblems([`[MEDIA_PICK_FAILED] ${error instanceof Error ? error.message : "Could not locate media."}`]);
      }
    } finally {
      if (owner === generation.current) setRelinkPicking(false);
    }
  }

  useEffect(() => {
    pending.current = false;
    attempt.current = null;
    setOperationPhase("idle");
    setBusy(false);
    setPicking(false);
    setProblems([]);
    setImportProblems([]);
    setImportSummary(null);
    setRecordingError(null);
    setTypedPath("");
    setRelinkPaths({});
    setRelinkPicking(false);
    setThumbnailRetries({});
    setContext(null);
    setRelinkAssetId(null);
    return () => { generation.current++; };
  }, [project.id, config.url, config.token]);

  useEffect(() => {
    if (enabled) return;
    setContext(null);
    setRelinkAssetId(null);
    generation.current++;
    setPicking(false);
    setRelinkPicking(false);
    if (!attempt.current) {
      pending.current = false;
      setBusy(false);
      setOperationPhase("idle");
      setProblems([]);
      setTypedPath("");
    } else {
      setBusy(false);
      setOperationPhase("unknown");
      onSaveStatusChange?.("unknown");
      setImportSummary("The editor is closing while an import may still be running. Closing does not prove it was cancelled. Check import result before retrying.");
    }
  }, [enabled]);

  async function runImport(paths: string[], mode: "copy" | "reference", owner: number): Promise<boolean> {
    if (paths.length === 0 || owner !== generation.current) return false;
    const attemptId = crypto.randomUUID();
    attempt.current = attemptId;
    onSaveStatusChange?.("saving");
    setOperationPhase("pending");
    setPicking(false);
    setBusy(true);
    setProblems([]);
    setImportProblems([]);
    setImportSummary(null);
    const result = await importFiles(config, { attemptId, paths, mode });
    if (owner !== generation.current) return false;
    setBusy(false);
    if (!result.ok) {
      if (["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN_ORIGIN", "IMPORT_OPERATION_BUSY"].includes(result.code)) {
        pending.current = false;
        attempt.current = null;
        setOperationPhase("idle");
        onSaveStatusChange?.(null);
        showImportProblem(result.code, result.message, "submit", "not-applied", result.diagnosticId);
      } else {
        setOperationPhase("unknown");
        onSaveStatusChange?.("unknown");
        showImportProblem(result.code, result.message, "submit", "unconfirmed", result.diagnosticId);
      }
      return false;
    }
    return acceptImport(result.data);
  }

  async function checkImportStatus() {
    const attemptId = attempt.current;
    if (!enabled || !attemptId || operationPhase === "checking" || operationPhase === "refreshing") return;
    const owner = generation.current;
    setOperationPhase("checking");
    const result = await getImportOperation(config, attemptId);
    if (owner !== generation.current || attempt.current !== attemptId) return;
    if (!result.ok) {
      setOperationPhase("unknown");
      onSaveStatusChange?.("unknown");
      showImportProblem(result.code, result.message, "status", "unconfirmed", result.diagnosticId);
      return;
    }
    if (result.data.state === "pending") {
      onSaveStatusChange?.("saving");
      setOperationPhase("pending");
      setImportProblems([]);
      setImportSummary("The engine is still reading or copying your files. No new import was sent. Check import result again before selecting the files another time.");
    } else if (result.data.state === "done") {
      if (acceptImport(result.data.response)) setTypedPath("");
    } else if (result.data.state === "failed") {
      pending.current = false;
      attempt.current = null;
      setOperationPhase("idle");
      onSaveStatusChange?.(null);
      showImportProblem(result.data.error.code, diagnosticMessage(result.data.error), "status", "not-applied", result.data.error.diagnosticId);
    } else {
      setOperationPhase("unknown");
      onSaveStatusChange?.("unknown");
      showImportProblem(result.data.error.code, diagnosticMessage(result.data.error), "status", "unconfirmed", result.data.error.diagnosticId);
    }
  }

  async function refreshProjectForReconciliation() {
    if (!enabled || operationPhase !== "unknown" || !attempt.current) return;
    const owner = generation.current;
    const attemptId = attempt.current;
    setOperationPhase("refreshing");
    const result = await getProject(config);
    if (owner !== generation.current || !attemptId || attempt.current !== attemptId) return;
    if (!result.ok) {
      setOperationPhase("unknown");
      showImportProblem(result.code, result.message, "refresh", "unconfirmed", result.diagnosticId);
      return;
    }
    if (result.data.project.id !== project.id || (projectFolder !== undefined && result.data.folder !== projectFolder)) {
      setOperationPhase("unknown");
      showImportProblem("PROJECT_CHANGED", "A different project is open; this asset list was not replaced.", "refresh", "unconfirmed");
      return;
    }
    onProject(result.data.project);
    setOperationPhase("reconciled");
    setImportProblems([]);
    setImportSummary("The saved asset list is now displayed. Check which selected files are already present before continuing. Continuing does not retry the import; choose only missing files afterward.");
  }

  function allowRetryAfterReconciliation() {
    if (!enabled || operationPhase !== "reconciled") return;
    pending.current = false;
    attempt.current = null;
    setOperationPhase("idle");
    onSaveStatusChange?.(null);
    setProblems([]);
    setImportProblems([]);
    setImportSummary(null);
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
    setImportProblems([]);
    setImportSummary(null);
    let paths: string[];
    try { paths = await bridge.pickMedia("Import media"); }
    catch (error) {
      if (owner !== generation.current) return;
      pending.current = false;
      setPicking(false);
      showImportProblem("MEDIA_PICK_FAILED", error instanceof Error ? error.message : "Could not choose media.", "picker", "not-applied");
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
    <section className="pane" aria-label="Assets" aria-busy={busy || picking || operationPhase === "checking" || operationPhase === "refreshing"}>
      <h2>Assets</h2>
      {disabledReason && (!enabled || mutationsDisabled) && <p className="muted">{disabledReason}</p>}
      {bridge?.pickMedia ? (
        <button onClick={() => void pick()} disabled={!enabled || pending.current || picking}
          title={!enabled ? disabledReason : pending.current ? "Wait for import completion or check its status before another import" : undefined}>
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
      {!busy && ["pending", "unknown", "checking"].includes(operationPhase) && (
        <div>
          <p role="status">{operationPhase === "pending"
            ? "Your import is still running. Another import is paused until it finishes."
            : "We cannot yet confirm which files were added. Another import is paused to avoid duplicates."}</p>
          <button onClick={() => void checkImportStatus()} disabled={!enabled || operationPhase === "checking"}>
            {operationPhase === "checking" ? "Checking import result..." : "Check import result"}
          </button>
        </div>
      )}
      {operationPhase === "unknown" && (
        <div>
          <p>If the receipt cannot be recovered, load the saved asset list and check for files already imported. No files will be imported again by this action.</p>
          <button onClick={() => void refreshProjectForReconciliation()} disabled={!enabled}>Load Assets for review</button>
        </div>
      )}
      {operationPhase === "refreshing" && <p role="status">Loading the saved asset list for review. No import is being resent.</p>}
      {operationPhase === "reconciled" && (
        <button onClick={allowRetryAfterReconciliation} disabled={!enabled}>I reviewed Assets - continue importing</button>
      )}
      {importSummary && <p role="status">{importSummary}</p>}
      {importProblems.map((problem, index) => <EditErrorNotice key={`${index}:${problem.context.code}`} {...problem} />)}
      {recordingError && <p role="alert" className="error">{recordingError}</p>}
      {problems.map((p) => (
        <p key={p} role="alert" className="error">{p}</p>
      ))}
      {project.assets.length === 0 ? (
        <p className="placeholder">No media yet. Import videos, images, or audio.</p>
      ) : (
        <ul className="assets">
          {project.assets.map((asset) => {
            const badge = proxyBadge(asset, proxyStates.get(asset.id));
            const proxyState = proxyStates.get(asset.id);
            const isOffline = offline.has(asset.id);
            return (
              <li
                key={asset.id}
                tabIndex={0}
                aria-label={asset.name}
                aria-haspopup="menu"
                onContextMenu={(event) => {
                  event.preventDefault();
                  contextOwner.current = event.currentTarget;
                  setContext({ assetId: asset.id, x: Math.max(0, Math.min(event.clientX, window.innerWidth - 220)),
                    y: Math.max(0, Math.min(event.clientY, window.innerHeight - 160)) });
                }}
                onKeyDown={(event) => {
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    contextOwner.current = event.currentTarget;
                    setContext({ assetId: asset.id, x: Math.max(0, Math.min(rect.left, window.innerWidth - 220)),
                      y: Math.max(0, Math.min(rect.top, window.innerHeight - 160)) });
                  }
                }}
                draggable={enabled && !mutationsDisabled && !isOffline}
                onDragStart={(event) => {
                  closeContext();
                  if (!enabled || mutationsDisabled || isOffline) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                  event.dataTransfer.effectAllowed = "copy";
                  onAssetDragStart?.();
                }}
              >
                <AssetThumbnail key={`${project.id}:${config.url}:${config.token}:${asset.sourcePath}:${asset.proxyPath}:${isOffline}:${thumbnailRetries[asset.id] ?? 0}`}
                  asset={asset} config={config} offline={isOffline} />
                <strong title={asset.sourcePath}>{asset.name}</strong>
                <span className="muted">
                  {asset.kind === "video"
                    ? `${asset.width}×${asset.height} · ${formatFps(asset.fps)} · `
                    : asset.kind === "image" ? `Image · ${asset.width}×${asset.height} · ` : "Audio · "}
                  {formatDuration(assetSeconds(asset, project.settings.fps))}
                  {asset.mediaMode === "copy" ? " · copied" : ""}
                </span>
                {isOffline && <span className="badge offline" title="The source file cannot be found">Offline</span>}
                {isOffline && onRelinkAsset && relinkAssetId === asset.id && !bridge?.pickMedia && (
                    <form onSubmit={(event) => {
                      event.preventDefault();
                      const sourcePath = relinkPaths[asset.id]?.trim();
                      if (enabled && !mutationsDisabled && sourcePath) {
                        onRelinkAsset(asset.id, sourcePath);
                        setRelinkAssetId(null);
                      }
                    }}>
                      <input
                        aria-label={`Replacement path for ${asset.name}`}
                        placeholder="Full path to original media"
                        value={relinkPaths[asset.id] ?? ""}
                        disabled={!enabled || mutationsDisabled}
                        onChange={(event) => setRelinkPaths((paths) => ({ ...paths, [asset.id]: event.target.value }))}
                      />
                      <button
                        aria-label={`Relink ${asset.name}`}
                        disabled={!enabled || mutationsDisabled || !relinkPaths[asset.id]?.trim()}
                      >Relink</button>
                      <button type="button" onClick={() => setRelinkAssetId(null)}>Cancel</button>
                    </form>
                )}
                {badge.tone !== "none" && <span className={`badge ${badge.tone}`}>{badge.label}</span>}
                {badge.tone === "error" && (
                  <div className="asset-preparation-error">
                    <p>Original playback is still available for supported files. Right-click to retry optimization after checking status.</p>
                    <RecoveryErrorNotice config={config} problem={previewProblem("PREVIEW_JOB_FAILED",
                      proxyState?.message ?? "Preview optimization failed without details.",
                      "preview-prepare", "job", proxyState?.diagnosticId)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {context && contextAsset && createPortal(
        <div ref={menu} className="asset-context-menu" role="menu" aria-label={`Actions for ${contextAsset.name}`}
          style={{ left: context.x, top: context.y }}
          onContextMenu={(event) => event.preventDefault()}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) closeContext();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
            items[next]?.focus();
          }}>
          <button role="menuitem" disabled={!enabled || mutationsDisabled || offline.has(contextAsset.id)}
            aria-label={`Add ${contextAsset.name} to timeline`}
            onClick={() => { closeContext(true); onAddToTimeline(contextAsset); }}>Add to timeline</button>
          {contextAsset.kind !== "audio" && (
            <button role="menuitem" aria-label={`Retry thumbnail for ${contextAsset.name}`}
              disabled={!enabled || offline.has(contextAsset.id)}
              onClick={() => {
                setThumbnailRetries((retries) => ({ ...retries, [contextAsset.id]: (retries[contextAsset.id] ?? 0) + 1 }));
                closeContext(true);
              }}>Retry thumbnail</button>
          )}
          {contextAsset.kind === "video" && onPreviewJob && (!contextAsset.proxyPath || ["queued", "running"].includes(proxyStates.get(contextAsset.id)?.state ?? "")) && (
            <button role="menuitem" disabled={!enabled || mutationsDisabled || previewJobBusy ||
              (offline.has(contextAsset.id) && !["queued", "running"].includes(proxyStates.get(contextAsset.id)?.state ?? ""))}
              onClick={() => {
                const state = proxyStates.get(contextAsset.id)?.state;
                onPreviewJob(contextAsset.id, state === "queued" || state === "running" ? "cancel" : "prepare");
                closeContext(true);
              }}>
              {["queued", "running"].includes(proxyStates.get(contextAsset.id)?.state ?? "")
                ? "Cancel preparation" : proxyStates.get(contextAsset.id)?.state === "failed"
                  ? "Retry optimized preview" : "Prepare optimized preview"}
            </button>
          )}
          {offline.has(contextAsset.id) && onRelinkAsset && (
            <button role="menuitem" aria-label={`Relink ${contextAsset.name}`}
              disabled={!enabled || mutationsDisabled || relinkPicking}
              onClick={() => {
                closeContext(true);
                if (bridge?.pickMedia) void pickRelink(contextAsset.id);
                else setRelinkAssetId(contextAsset.id);
              }}>Relink</button>
          )}
          <button role="menuitem" aria-label={`Remove ${contextAsset.name}`}
            disabled={!enabled || mutationsDisabled || !!contextAssetUsed}
            title={contextAssetUsed
              ? "Remove the clips using this asset before removing it" : "Remove this asset from the project"}
            onClick={() => { closeContext(true); onRemoveAsset(contextAsset.id); }}>Remove asset</button>
        </div>, document.body,
      )}
    </section>
  );
}
