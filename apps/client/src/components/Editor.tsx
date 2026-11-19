import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CANVAS_ASPECT_PRESETS, canvasSizeForAspect, findErrorDefinition, type ClipAnimations, type ClipZoom, type ErrorContext, type EditOperation, type Asset, type Command, type Project, type ProjectResponse, type Transform } from "@ve/schema";
import { PlayheadClock } from "../clock.js";
import { CommandHistory, type HistoryAction } from "../commandHistory.js";
import type { EngineConfig } from "../engine.js";
import { diagnosticMessage, getCommandOperation, getMediaStatus, getProject, recordUnknownEditError, sendCommands, updatePreviewJob } from "../projectApi.js";
import { editOperation, safeErrorContext } from "../editErrors.js";
import { EditErrorNotice } from "./EditErrorNotice.js";
import { UnknownErrorInbox } from "./UnknownErrorInbox.js";
import {
  planAddAudioTrack, planAddToTimeline, planAddVisualTrack, planDelete, planLayerClip, planSplitAudio, planMove, planReorderAudioTrack,
  planRemoveAsset, planRemoveTrack, planReorderVisualTrack, planSetTrackMuted, planSplit, planTrim, type LayerAction, type Plan,
} from "../timelineOps.js";
import { resolveShortcut } from "../shortcuts.js";
import { Preview } from "./Preview.js";
import { Timeline } from "./Timeline.js";
import { useProxyStatus } from "../useProxyStatus.js";
import { AssetsPane } from "./AssetsPane.js";
import { DEFAULT_SIZES, clampSize, fitPaneWidths, loadSizes, saveSizes, type PaneSizes } from "../layout.js";
import type { HealthResult } from "../engine.js";
import { ExportDialog } from "./ExportDialog.js";
import { exportDisabledReason, saveLabel, type SaveStatus } from "../exportStatus.js";
import { Splitter } from "./Splitter.js";
import { StatusArea } from "./StatusArea.js";
import { ClipProperties } from "./ClipProperties.js";
import { HelpDialog } from "./HelpDialog.js";
import { RecoveryErrorNotice } from "./RecoveryErrorNotice.js";
import { previewProblem, type PreviewProblem } from "../previewErrors.js";
import { type CropMode } from "../cropEdit.js";
import type { ClipCrop } from "@ve/schema";

type Props = { config: EngineConfig; project: Project; folder: string; health: HealthResult | null; warnings?: ProjectResponse["warnings"]; recoveredFromBackup?: boolean; onClose: () => void; importEnabled?: boolean };

export function Editor({ config, project: initialProject, folder, health, warnings, recoveredFromBackup = false, onClose, importEnabled = true }: Props) {
  const [project, setProject] = useState(initialProject);
  const [offline, setOffline] = useState<ReadonlySet<string>>(new Set());
  const [mediaStatusError, setMediaStatusError] = useState<PreviewProblem | null>(null);
  const [refreshingMedia, setRefreshingMedia] = useState(false);
  const [projectRefreshError, setProjectRefreshError] = useState<string | null>(null);
  const [refreshingProject, setRefreshingProject] = useState(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const mediaRequestId = useRef(0);
  const projectRequestId = useRef(0);

  const refreshProject = useCallback(async () => {
    const requestId = ++projectRequestId.current;
    const projectAtStart = projectRef.current;
    setRefreshingProject(true);
    const result = await getProject(config);
    if (requestId !== projectRequestId.current) return;
    setRefreshingProject(false);
    if (!result.ok) {
      setProjectRefreshError(`[${result.code}] ${result.message}`);
      return;
    }
    if (result.data.project.id !== projectAtStart.id || result.data.folder !== folder) {
      setProjectRefreshError("The engine now has a different project open. This editor was not replaced.");
      return;
    }
    if (projectRef.current.updatedAt !== projectAtStart.updatedAt) return;
    setProject(result.data.project);
    setProjectRefreshError(null);
  }, [config, folder]);

  const proxyStatus = useProxyStatus(config, () => { void refreshProject(); });
  const proxyStates = proxyStatus.states;
  const [previewJobBusy, setPreviewJobBusy] = useState(false);
  const [previewJobError, setPreviewJobError] = useState<PreviewProblem | null>(null);
  const [previewJobUnconfirmed, setPreviewJobUnconfirmed] = useState(false);
  const previewJobUnconfirmedRef = useRef(false);
  const previewJobPending = useRef(false);
  const previewJobGeneration = useRef(0);
  useEffect(() => () => { previewJobGeneration.current++; }, [config.url, config.token, folder]);
  const previewJob = useCallback(async (assetId: string, action: "prepare" | "cancel") => {
    if (previewJobPending.current || previewJobUnconfirmedRef.current) return;
    previewJobPending.current = true;
    setPreviewJobBusy(true);
    setPreviewJobError(null);
    const owner = previewJobGeneration.current;
    const result = await updatePreviewJob(config, { assetId, action,
      expectedProject: { id: projectRef.current.id, folder } });
    if (owner !== previewJobGeneration.current) return;
    previewJobPending.current = false;
    setPreviewJobBusy(false);
    if (!result.ok) {
      previewJobUnconfirmedRef.current = true;
      setPreviewJobUnconfirmed(true);
      setPreviewJobError(previewProblem(result.code, `[${result.code}] ${result.message}`,
        action === "prepare" ? "preview-prepare" : "preview-cancel", "submit", result.diagnosticId));
    }
    const confirmed = await proxyStatus.refresh();
    if (owner !== previewJobGeneration.current) return;
    if (confirmed) {
      previewJobUnconfirmedRef.current = false;
      setPreviewJobUnconfirmed(false);
    }
    if (owner === previewJobGeneration.current) await refreshProject();
  }, [config, folder, proxyStatus.refresh, refreshProject]);
  const clock = useMemo(() => new PlayheadClock(), []);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [appearanceDraft, setAppearanceDraft] = useState<{ clipId: string; transform: Transform } | null>(null);
  // True while a canvas drag owns the appearance draft, so Properties can mirror it live.
  const [canvasLive, setCanvasLive] = useState(false);
  const [cropActive, setCropActive] = useState(false);
  const [cropMode, setCropMode] = useState<CropMode>("free");
  const [cropDraft, setCropDraft] = useState<{ clipId: string; crop: ClipCrop } | null>(null);
  useEffect(() => { setCropDraft(null); setCropActive(false); }, [selectedClipId]);
  useEffect(() => { setCropDraft(null); }, [project]);
  // An unsaved zoom shown in Preview; `zoom: null` previews the clip without its zoom.
  const [zoomDraft, setZoomDraft] = useState<{ clipId: string; zoom: ClipZoom | null } | null>(null);
  // Only Preview sees the unsaved slider value; the saved project, history and export stay unchanged until commit.
  const previewProject = useMemo(() => !appearanceDraft && !zoomDraft && !cropDraft ? project : {
    ...project,
    tracks: project.tracks.map((track) => track.clips.some((clip) => clip.id === appearanceDraft?.clipId || clip.id === zoomDraft?.clipId || clip.id === cropDraft?.clipId) ? {
      ...track, clips: track.clips.map((clip) => {
        let next = clip.id === appearanceDraft?.clipId ? { ...clip, transform: appearanceDraft.transform } : clip;
        if (clip.id === cropDraft?.clipId) next = { ...next, crop: cropDraft.crop };
        if (clip.id === zoomDraft?.clipId) {
          next = { ...next };
          delete next.zoom;
          if (zoomDraft.zoom) next.zoom = zoomDraft.zoom;
        }
        return next;
      }),
    } : track),
  }, [appearanceDraft, zoomDraft, cropDraft, project]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [editProblem, setEditProblem] = useState<{ context: ErrorContext; detail: string } | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const operation = useRef<EditOperation>("edit");
  const showEditProblem = useCallback((code: string, detail: string, stage: ErrorContext["stage"],
    outcome: ErrorContext["outcome"], diagnosticId?: string) => {
    const context = safeErrorContext(code, stage, outcome, operation.current, diagnosticId);
    setEditMessage(null);
    setEditProblem({ context, detail });
    if (!findErrorDefinition(context)) {
      void recordUnknownEditError(config, context).then((result) => {
        if (!result.ok) setInboxError("This unknown error could not be recorded for development. Editing safety is unchanged. Check the engine connection, inbox capacity and local diagnostic storage.");
      });
    }
  }, [config]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(recoveredFromBackup ? "recovered" : "saved");
  const [backupNeedsSave, setBackupNeedsSave] = useState(recoveredFromBackup);
  const [importSaveStatus, setImportSaveStatus] = useState<"saving" | "unknown" | null>(null);
  const [failedSave, setFailedSave] = useState<{ plan: Plan; action: HistoryAction; project: Project } | null>(null);
  const pendingEdit = useRef<{ plan: Plan; action: HistoryAction; project: Project; previousStatus: SaveStatus } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandPhase, setCommandPhase] = useState<"idle" | "pending" | "checking" | "refreshing" | "unknown" | "reconciled">("idle");
  const commandAttempt = useRef<string | null>(null);
  const commandHistory = useRef(new CommandHistory());
  const historyAction = useRef<HistoryAction | null>(null);
  const [, setHistoryRevision] = useState(0);

  const completeCommand = useCallback((nextProject: Project, inverse: Command[]) => {
    pendingEdit.current = null;
    setFailedSave(null);
    setBackupNeedsSave(false);
    if (historyAction.current) commandHistory.current.complete(historyAction.current, inverse);
    historyAction.current = null;
    setHistoryRevision((revision) => revision + 1);
    setSelectedTrackId((trackId) => trackId && nextProject.tracks.some((track) => track.id === trackId) ? trackId : null);
    setProject(nextProject);
  }, []);

  const failCommand = useCallback((code: string, message: string, stage: ErrorContext["stage"] = "status", diagnosticId?: string) => {
    const pending = pendingEdit.current;
    commandAttempt.current = null;
    historyAction.current = null;
    pendingEdit.current = null;
    setCommandPhase("idle");
    if (code === "SAVE_FAILED" || code === "SAVE_CLEANUP_FAILED") {
      setSaveStatus("error");
      setFailedSave(pending);
    } else {
      setSaveStatus(pending?.previousStatus ?? "unknown");
    }
    showEditProblem(code, message, stage, "not-applied", diagnosticId);
  }, [showEditProblem]);

  useEffect(() => () => {
    clock.dispose();
    projectRequestId.current++;
  }, [clock]);

  // Re-check for missing source files when assets change and when the window regains focus.
  const mediaAssetsKey = JSON.stringify(project.assets.map((asset) =>
    [asset.id, asset.mediaMode, asset.sourcePath, asset.contentHash]));
  const refreshOffline = useCallback(async () => {
    const requestId = ++mediaRequestId.current;
    const projectId = projectRef.current.id;
    setRefreshingMedia(true);
    const result = await getMediaStatus(config);
    if (requestId !== mediaRequestId.current) return;
    setRefreshingMedia(false);
    if (!result.ok) {
      setMediaStatusError(previewProblem(result.code, `[${result.code}] ${result.message}`, "preview-status", "refresh", result.diagnosticId));
      return;
    }
    if (result.data.projectId !== projectId || projectRef.current.id !== projectId) {
      setMediaStatusError(previewProblem("PROJECT_CHANGED",
        "Media status belongs to a different project. Refresh after confirming the active project.", "preview-status", "refresh"));
      return;
    }
    setOffline(new Set(result.data.offline.map((o) => o.assetId)));
    setMediaStatusError(null);
  }, [config]);
  const refreshMediaAndProxies = useCallback(() => {
    void refreshOffline();
    const owner = previewJobGeneration.current;
    void proxyStatus.refresh().then((confirmed) => {
      if (confirmed && owner === previewJobGeneration.current) {
        previewJobUnconfirmedRef.current = false;
        setPreviewJobUnconfirmed(false);
      }
    });
  }, [proxyStatus.refresh, refreshOffline]);
  useEffect(() => {
    void refreshOffline();
    window.addEventListener("focus", refreshOffline);
    return () => {
      mediaRequestId.current++;
      window.removeEventListener("focus", refreshOffline);
    };
  }, [refreshOffline, mediaAssetsKey]);

  // The engine stays the single source of truth: send the batch, then adopt its project.
  const run = useCallback(
    async function execute(plan: Plan, action: HistoryAction = "record", retryDuplicateOrder = true): Promise<boolean> {
      if (!plan.ok) {
        setEditMessage(plan.message);
        return false;
      }
      if (commandAttempt.current) {
        setEditMessage("A previous edit is unresolved. Check its status before making another change.");
        return false;
      }
      clock.pause();
      operation.current = editOperation(plan.commands, action);
      setEditProblem(null);
      setEditMessage(null);
      historyAction.current = action;
      pendingEdit.current = { plan, action, project: projectRef.current, previousStatus: saveStatus };
      setFailedSave(null);
      const attemptId = crypto.randomUUID();
      commandAttempt.current = attemptId;
      setCommandPhase("pending");
      setSaveStatus("saving");
      const result = await sendCommands(config, plan.commands, undefined, attemptId);
      if (!result.ok) {
        if (result.outcome === "not-applied" && result.code !== "DUPLICATE_ORDER") {
          failCommand(result.code, result.message, "submit", result.diagnosticId);
          return false;
        }
        setSaveStatus("unknown");
        showEditProblem(result.code, result.message, "submit", result.outcome ?? "unconfirmed", result.diagnosticId);
        const status = await getCommandOperation(config, attemptId);
        if (!status.ok) {
          setCommandPhase("unknown");
          showEditProblem(status.code, status.message, "status", "unconfirmed", status.diagnosticId);
          return false;
        }
        if (status.data.state === "failed") {
          if (retryDuplicateOrder && status.data.error.code === "DUPLICATE_ORDER" &&
            plan.commands.some((command) => command.type === "AddTrack")) {
            const refreshed = await getProject(config);
            if (!refreshed.ok) {
              failCommand("DUPLICATE_ORDER", `${diagnosticMessage(status.data.error)} Project refresh failed: [${refreshed.code}] ${refreshed.message}`);
              return false;
            }
            if (refreshed.data.project.id !== projectRef.current.id || refreshed.data.folder !== folder) {
              failCommand("DUPLICATE_ORDER", "The project changed while adding a track. Open or refresh the active project, then retry.");
              return false;
            }
            let nextOrder = refreshed.data.project.tracks.reduce((max, track) => Math.max(max, track.order + 1), 0);
            const commands = plan.commands.map((command) => {
              if (command.type !== "AddTrack") return command;
              return { ...command, track: { ...command.track, order: nextOrder++ } };
            });
            projectRef.current = refreshed.data.project;
            setProject(refreshed.data.project);
            commandAttempt.current = null;
            historyAction.current = null;
            setCommandPhase("idle");
            return execute({ ok: true, commands }, action, false);
          }
          failCommand(status.data.error.code, diagnosticMessage(status.data.error), "status", status.data.error.diagnosticId);
        } else if (status.data.state === "done") {
          if (status.data.response.project.id !== projectRef.current.id) {
            setCommandPhase("unknown");
            showEditProblem("PROJECT_CHANGED", "The completed edit belongs to a different project.", "status", "unconfirmed");
            return false;
          }
          commandAttempt.current = null;
          setCommandPhase("idle");
          setSaveStatus("saved");
          setEditMessage(null);
          setEditProblem(null);
          completeCommand(status.data.response.project, status.data.response.inverse);
          return true;
        } else if (status.data.state === "pending") {
          setSaveStatus("saving");
          setCommandPhase("pending");
          setEditProblem(null);
          setEditMessage(null);
        } else {
          setCommandPhase("unknown");
          showEditProblem(status.data.error.code, diagnosticMessage(status.data.error), "status", "unconfirmed", status.data.error.diagnosticId);
        }
        return false;
      }
      commandAttempt.current = null;
      setCommandPhase("idle");
      setSaveStatus("saved");
      setEditMessage(null);
      setEditProblem(null);
      completeCommand(result.data.project, result.data.inverse);
      return true;
    },
    [clock, completeCommand, config, failCommand, folder, saveStatus, showEditProblem],
  );

  const checkCommandStatus = useCallback(async () => {
    const attemptId = commandAttempt.current;
    if (!attemptId || commandPhase === "checking") return;
    const previousPhase = commandPhase;
    setCommandPhase("checking");
    const result = await getCommandOperation(config, attemptId);
    if (commandAttempt.current !== attemptId) return;
    if (!result.ok) {
      setSaveStatus("unknown");
      if (result.code === "OPERATION_UNKNOWN" || result.code === "PROJECT_CHANGED" || result.code === "NO_PROJECT") {
        setCommandPhase("unknown");
      } else {
        setCommandPhase(previousPhase === "pending" ? "unknown" : previousPhase);
      }
      showEditProblem(result.code, result.message, "status", "unconfirmed", result.diagnosticId);
      return;
    }
    if (result.data.state === "pending") {
      setSaveStatus("saving");
      setCommandPhase("pending");
      setEditProblem(null);
      setEditMessage(null);
    } else if (result.data.state === "done") {
      if (result.data.response.project.id !== projectRef.current.id) {
        setSaveStatus("unknown");
        setCommandPhase("unknown");
        showEditProblem("PROJECT_CHANGED", "The completed edit belongs to a different project.", "status", "unconfirmed");
        return;
      }
      commandAttempt.current = null;
      setCommandPhase("idle");
      setSaveStatus("saved");
      setEditMessage(null);
      setEditProblem(null);
      completeCommand(result.data.response.project, result.data.response.inverse);
    } else if (result.data.state === "failed") {
      failCommand(result.data.error.code, diagnosticMessage(result.data.error), "status", result.data.error.diagnosticId);
    } else {
      setSaveStatus("unknown");
      setCommandPhase("unknown");
      showEditProblem(result.data.error.code, diagnosticMessage(result.data.error), "status", "unconfirmed", result.data.error.diagnosticId);
    }
  }, [commandPhase, completeCommand, config, failCommand, showEditProblem]);

  const reconcileCommand = useCallback(async () => {
    if (commandPhase !== "unknown" || !commandAttempt.current) return;
    const attemptId = commandAttempt.current;
    setCommandPhase("refreshing");
    const result = await getProject(config);
    if (commandAttempt.current !== attemptId) return;
    if (!result.ok) {
      setCommandPhase("unknown");
      showEditProblem(result.code, result.message, "refresh", "unconfirmed", result.diagnosticId);
      return;
    }
    if (result.data.project.id !== projectRef.current.id || result.data.folder !== folder) {
      setCommandPhase("unknown");
      showEditProblem("PROJECT_CHANGED", "A different project is open. This editor was not replaced.", "refresh", "unconfirmed");
      return;
    }
    commandHistory.current.clear();
    historyAction.current = null;
    setHistoryRevision((revision) => revision + 1);
    setProject(result.data.project);
    setBackupNeedsSave(result.data.recoveredFromBackup);
    pendingEdit.current = null;
    setFailedSave(null);
    setCommandPhase("reconciled");
    setEditMessage(null);
    setEditProblem(null);
  }, [commandPhase, config, folder, showEditProblem]);

  const allowCommandsAfterReconciliation = useCallback(() => {
    if (commandPhase !== "reconciled") return;
    commandAttempt.current = null;
    historyAction.current = null;
    setCommandPhase("idle");
    setSaveStatus(backupNeedsSave ? "recovered" : "saved");
    setEditMessage(null);
    setEditProblem(null);
  }, [backupNeedsSave, commandPhase]);

  const placeAsset = useCallback((asset: Asset, timelineStart: number, trackId: string | null) => {
    const plan = planAddToTimeline(projectRef.current, asset, undefined, timelineStart, trackId);
    if (!plan.ok) {
      void run(plan);
      return;
    }
    const destinationTrackId = plan.commands.find((command) => command.type === "AddClip")?.trackId;
    void run(plan).then((ok) => {
      if (ok && destinationTrackId) setSelectedTrackId(destinationTrackId);
    });
  }, [run]);
  const addToTimeline = useCallback((asset: Asset) => {
    placeAsset(asset, clock.frame, selectedTrackId);
  }, [clock, placeAsset, selectedTrackId]);
  const dropAsset = useCallback((assetId: string, timelineStart: number, trackId: string | null) => {
    const asset = projectRef.current.assets.find((candidate) => candidate.id === assetId);
    if (!asset || offline.has(assetId)) {
      setEditMessage(asset ? "This asset is offline. Restore its source before adding it." : "The dragged asset is no longer in this project.");
      return;
    }
    placeAsset(asset, timelineStart, trackId);
  }, [offline, placeAsset]);
  const addVisualTrack = useCallback(() => void run(planAddVisualTrack(projectRef.current)), [run]);
  const addAudioTrack = useCallback(() => void run(planAddAudioTrack(projectRef.current)), [run]);
  const removeAsset = useCallback((assetId: string) => void run(planRemoveAsset(projectRef.current, assetId)), [run]);
  const relinkAsset = useCallback((assetId: string, sourcePath: string) => {
    void run({ ok: true, commands: [{ type: "RelinkAsset", assetId, sourcePath }] }).then((ok) => {
      if (ok) refreshMediaAndProxies();
    });
  }, [run, refreshMediaAndProxies]);
  const removeTrack = useCallback((trackId: string) => void run(planRemoveTrack(projectRef.current, trackId)), [run]);
  const renameTrack = useCallback((trackId: string, name: string) =>
    void run({ ok: true, commands: [{ type: "SetTrackName", trackId, name }] }), [run]);
  const lockTrack = useCallback((trackId: string, locked: boolean) =>
    void run({ ok: true, commands: [{ type: "SetTrackLocked", trackId, locked }] }), [run]);
  const reorderVisualTrack = useCallback((trackId: string, direction: -1 | 1) =>
    void run(planReorderVisualTrack(projectRef.current, trackId, direction)), [run]);
  const reorderAudioTrack = useCallback((trackId: string, direction: -1 | 1) =>
    void run(planReorderAudioTrack(projectRef.current, trackId, direction)), [run]);
  const toggleTrackMuted = useCallback((trackId: string, muted: boolean) =>
    void run(planSetTrackMuted(projectRef.current, trackId, muted)), [run]);
  const trimClip = useCallback((clipId: string, sourceIn: number, sourceOut: number) =>
    void run(planTrim(projectRef.current, clipId, sourceIn, sourceOut)), [run]);
  const transformClip = useCallback((clipId: string, transform?: Transform) =>
    void run({ ok: true, commands: [{ type: "SetClipTransform", clipId, ...(transform ? { transform } : {}) }] })
      .finally(() => setAppearanceDraft((draft) => draft?.clipId === clipId ? null : draft)), [run]);
  const previewAppearance = useCallback((clipId: string, transform: Transform | null) =>
    setAppearanceDraft(transform ? { clipId, transform } : (draft) => draft?.clipId === clipId ? null : draft), []);
  const canvasDraft = useCallback((clipId: string, transform: Transform | null) => {
    setCanvasLive(Boolean(transform));
    previewAppearance(clipId, transform);
  }, [previewAppearance]);
  const canvasCommit = useCallback((clipId: string, transform: Transform) =>
    void run({ ok: true, commands: [{ type: "SetClipTransform", clipId, transform }] }).finally(() => {
      setAppearanceDraft((draft) => draft?.clipId === clipId ? null : draft);
      setCanvasLive(false);
    }), [run]);
  const cropControls = {
    active: cropActive, mode: cropMode, draft: cropDraft, offline,
    onActive: (active: boolean) => {
      clock.pause();
      if (active) { setAppearanceDraft(null); setCanvasLive(false); }
      setCropActive(active);
    },
    onMode: (mode: CropMode) => { clock.pause(); setCropMode(mode); },
    onDraft: (clipId: string, crop: ClipCrop | null) => {
      clock.pause();
      setCropDraft(crop ? { clipId, crop } : (draft) => draft?.clipId === clipId ? null : draft);
    },
    onCommit: (clipId: string, crop?: ClipCrop) => {
      const saved = projectRef.current.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)?.crop;
      const sides = ["left", "top", "right", "bottom"] as const;
      if (sides.every((side) => Math.abs((saved?.[side] ?? 0) - (crop?.[side] ?? 0)) < 1e-8) && Boolean(saved) === Boolean(crop)) {
        setCropDraft((draft) => draft?.clipId === clipId ? null : draft); return;
      }
      void run({ ok: true, commands: [{ type: "SetClipCrop", clipId, ...(crop ? { crop } : {}) }] })
        .finally(() => setCropDraft((draft) => draft?.clipId === clipId ? null : draft));
    },
  };
  const layerClip = useCallback((clipId: string, action: LayerAction) =>
    void run(planLayerClip(projectRef.current, clipId, action)), [run]);
  const speedClip = useCallback((clipId: string, speed: number) =>
    void run({ ok: true, commands: [{ type: "SetClipSpeed", clipId, speed }] }), [run]);
  const volumeClip = useCallback((clipId: string, volume?: number) =>
    void run({ ok: true, commands: [{ type: "SetClipVolume", clipId, ...(volume !== undefined ? { volume } : {}) }] }), [run]);
  const animateClip = useCallback((clipId: string, animations?: ClipAnimations) =>
    void run({ ok: true, commands: [{ type: "SetClipAnimations", clipId, ...(animations ? { animations } : {}) }] }), [run]);
  const zoomClip = useCallback((clipId: string, zoom?: ClipZoom) =>
    void run({ ok: true, commands: [{ type: "SetClipZoom", clipId, ...(zoom ? { zoom } : {}) }] })
      .finally(() => setZoomDraft((draft) => draft?.clipId === clipId ? null : draft)), [run]);
  const previewZoom = useCallback((clipId: string, zoom: ClipZoom | null | undefined) =>
    setZoomDraft(zoom !== undefined ? { clipId, zoom } : (draft) => draft?.clipId === clipId ? null : draft), []);
  const moveClip = useCallback((clipId: string, timelineStart: number, trackId: string) =>
    void run(planMove(projectRef.current, clipId, timelineStart, trackId)), [run]);
  const undo = useCallback(() => {
    const commands = commandHistory.current.peekUndo();
    if (commands) void run({ ok: true, commands }, "undo");
  }, [run]);
  const redo = useCallback(() => {
    const commands = commandHistory.current.peekRedo();
    if (commands) void run({ ok: true, commands }, "redo");
  }, [run]);
  const split = useCallback(
    () => void run(planSplit(projectRef.current, clock.frame, selectedClipId)),
    [run, clock, selectedClipId],
  );
  const remove = useCallback(() => {
    const plan = planDelete(projectRef.current, selectedClipId);
    void run(plan).then((ok) => ok && setSelectedClipId(null));
  }, [run, selectedClipId]);
  const splitAudio = useCallback(
    () => void run(planSplitAudio(projectRef.current, selectedClipId)),
    [run, selectedClipId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exportOpen || helpOpen || e.defaultPrevented) return;
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      const action = resolveShortcut(e, (e.target as HTMLElement).tagName);
      if (action === "toggle-play") {
        e.preventDefault();
        clock.toggle();
      } else if (action === "previous-frame" || action === "next-frame") {
        e.preventDefault();
        clock.stepFrame(action === "previous-frame" ? -1 : 1);
      } else if (action === "undo") {
        e.preventDefault();
        undo();
      } else if (action === "redo") {
        e.preventDefault();
        redo();
      } else if (action === "split") split();
      else if (action === "delete") remove();
      else if (action === "deselect") setSelectedClipId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, split, remove, undo, redo, exportOpen, helpOpen]);

  const [sizes, setSizes] = useState<PaneSizes>(() => loadSizes(localStorage));
  const upper = useRef<HTMLDivElement>(null);
  const [upperWidth, setUpperWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!upper.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setUpperWidth(entry.contentRect.width);
    });
    observer.observe(upper.current);
    return () => observer.disconnect();
  }, []);
  const fitted = upperWidth === null ? sizes : fitPaneWidths(sizes, upperWidth);
  const dragStart = useRef<PaneSizes>(sizes);

  useEffect(() => saveSizes(localStorage, sizes), [sizes]);

  const beginDrag = useCallback(() => {
    dragStart.current = { ...sizes, ...fitted };
  }, [sizes, fitted]);

  const setNumeric = (key: "assetsWidth" | "assistantWidth" | "propertiesWidth" | "timelineHeight", value: number) =>
    setSizes((s) => ({ ...s, [key]: clampSize(key, value) }));

  const { assetsWidth, assistantWidth, propertiesWidth } = fitted;
  const { timelineHeight, assistantOpen } = sizes;
  const canUndo = commandHistory.current.canUndo;
  const canRedo = commandHistory.current.canRedo;
  const exportReason = exportDisabledReason(project, offline);
  const commandLocked = commandPhase !== "idle";

  return (
    <div className="editor">
      <header className="topbar">
        <button onClick={onClose} disabled={commandLocked} title={commandLocked ? "Resolve the pending edit before leaving this project" : undefined}>← Projects</button>
        <strong>{project.name}</strong>
        <span className={saveStatus === "error" ? "error" : "muted"} title={folder} role="status">{saveLabel(importSaveStatus ?? saveStatus)}</span>
        <span className="spacer" />
        <button onClick={undo} disabled={!canUndo || commandLocked} title={commandLocked ? "Resolve the pending edit before using Undo" : !canUndo ? "No confirmed edit to undo" : "Undo the last timeline edit (Ctrl+Z)"}>Undo</button>
        <button onClick={redo} disabled={!canRedo || commandLocked} title={commandLocked ? "Resolve the pending edit before using Redo" : !canRedo ? "No undone edit to redo" : "Redo the last undone edit (Ctrl+Y)"}>Redo</button>
        <button onClick={() => setExportOpen(true)} disabled={exportReason !== null || commandLocked} title={commandLocked ? "Resolve the pending edit before exporting" : exportReason ?? "Export the timeline to MP4"}>
          Export
        </button>
        <button title="Refresh offline media and proxy status from the engine" onClick={refreshMediaAndProxies} disabled={refreshingMedia || proxyStatus.refreshing}>
          {refreshingMedia || proxyStatus.refreshing ? "Refreshing status..." : "Refresh status"}
        </button>
        <button onClick={() => setSizes((s) => ({ ...s, assistantOpen: !s.assistantOpen }))}>
          {assistantOpen ? "Hide assistant" : "Show assistant"}
        </button>
        <button onClick={() => setSizes({ ...DEFAULT_SIZES, assistantOpen })}>Reset layout</button>
        <button onClick={() => setHelpOpen(true)}>Help</button>
      </header>
      {warnings?.map((warning) => <p key={warning.code} role="status" className="error">[{warning.code}] {warning.message}</p>)}
      {recoveredFromBackup && (
        <div className="recovery-notice" role="status">
          <strong>Recovered from backup</strong>
          <p>The main project file was missing or invalid. The last usable backup was loaded; some recent edits may be absent. Review the timeline before continuing.</p>
          <p>{backupNeedsSave
            ? "The recovered project has not been saved to the main file yet. Your next successful edit or import will autosave it; closing now leaves the existing files unchanged."
            : "The recovered project has now been autosaved to the main file."}</p>
        </div>
      )}
      {failedSave && failedSave.project === project && (
        <div className="recovery-notice">
          <button disabled={commandLocked || !importEnabled || importSaveStatus !== null} onClick={() => void run(failedSave.plan, failedSave.action)}>Retry edit</button>
          <p>Retry submits the same edit once more. It is only available after the engine confirms that the save failed without applying it.</p>
        </div>
      )}
      {editProblem && <EditErrorNotice {...editProblem} />}
      {commandLocked && (
        <div role="status" className={commandPhase === "pending" ? "muted" : "error"}>
          <p>{commandPhase === "reconciled"
            ? "The saved project is now displayed. Check whether your last edit appears as expected. Undo/Redo history was cleared because the original edit result could not be confirmed."
            : commandPhase === "pending"
              ? "Saving your edit. Please wait; editing is briefly paused to avoid sending it twice."
              : "Editing is paused while we verify your last edit. Do not apply it again."}</p>
          {(commandPhase === "pending" || commandPhase === "unknown" || commandPhase === "checking") && (
            <button onClick={() => void checkCommandStatus()} disabled={commandPhase === "checking"}>
              {commandPhase === "checking" ? "Checking whether edit saved..." : "Check whether edit saved"}
            </button>
          )}
          {commandPhase === "refreshing" && <p>Loading the saved project for you to review. No edit is being sent again.</p>}
          {commandPhase === "unknown" && (
            <>
              <p>If the receipt cannot be recovered, load the saved project and inspect the timeline. This clears Undo/Redo and requires your review before editing can resume.</p>
              <button onClick={() => void reconcileCommand()}>Load saved project for review</button>
            </>
          )}
          {commandPhase === "reconciled" && (
            <button onClick={allowCommandsAfterReconciliation}>I reviewed my last edit - continue editing</button>
          )}
        </div>
      )}
      {inboxError && <p role="alert" className="error">{inboxError}</p>}
      <UnknownErrorInbox config={config} recordingError={inboxError} />
      {proxyStatus.error && (
        <div>
          <RecoveryErrorNotice config={config} problem={proxyStatus.problem ??
            previewProblem("PREVIEW_STATUS_FAILED", proxyStatus.error, "preview-status", "status")} />
          <button onClick={() => void proxyStatus.refresh()} disabled={proxyStatus.refreshing}>
            {proxyStatus.refreshing ? "Refreshing proxy status..." : "Refresh proxy status"}
          </button>
        </div>
      )}
      {previewJobError && <div>
        <RecoveryErrorNotice config={config} problem={previewJobError} />
        <button onClick={refreshMediaAndProxies} disabled={refreshingMedia || proxyStatus.refreshing}>Refresh preview status</button>
      </div>}
      {previewJobBusy && <p role="status">Updating preview preparation... Original-source editing remains available.</p>}
      {previewJobUnconfirmed && <p role="status">New preview preparation and cancellation requests are paused until preview status can be refreshed. Timeline editing is not paused by this check.</p>}
      {projectRefreshError && (
        <p role="alert" className="error">
          Project refresh: {projectRefreshError}{" "}
          <button onClick={() => void refreshProject()} disabled={refreshingProject}>
            {refreshingProject ? "Refreshing project..." : "Refresh project"}
          </button>
        </p>
      )}
      {mediaStatusError && (
        <div>
          <RecoveryErrorNotice config={config} problem={mediaStatusError} />
          <button onClick={() => void refreshOffline()} disabled={refreshingMedia}>
            {refreshingMedia ? "Refreshing media status..." : "Refresh media status"}
          </button>
        </div>
      )}

      <div className="workspace">
        <div className="upper" ref={upper} style={{ gridTemplateColumns: `${assetsWidth}px 6px minmax(200px, 1fr) 6px ${propertiesWidth}px ${assistantOpen ? `6px ${assistantWidth}px` : ""}` }}>
          <AssetsPane
            config={config}
            project={project}
            projectFolder={folder}
            proxyStates={proxyStates}
            offline={offline}
            onProject={setProject}
            onImportSaved={() => {
              setBackupNeedsSave(false);
              setFailedSave(null);
              if (!commandAttempt.current) setSaveStatus("saved");
            }}
            onSaveStatusChange={setImportSaveStatus}
            onPreviewJob={(assetId, action) => void previewJob(assetId, action)}
            previewJobBusy={previewJobBusy || previewJobUnconfirmed}
            onAddToTimeline={addToTimeline}
            onRemoveAsset={removeAsset}
            onRelinkAsset={relinkAsset}
            onAssetDragStart={() => clock.pause()}
            enabled={importEnabled && !commandLocked}
            mutationsDisabled={commandLocked}
            disabledReason={commandLocked ? "Resolve the pending edit using the recovery controls before importing or changing assets."
              : !importEnabled ? "Asset changes are paused while this project is closing." : undefined}
          />
          <Splitter
            orientation="vertical"
            label="Resize assets pane"
            onDragStart={beginDrag}
            onDrag={(d) => setNumeric("assetsWidth", dragStart.current.assetsWidth + d)}
            onNudge={(d) => setNumeric("assetsWidth", assetsWidth + d)}
          />
          <section className="pane" aria-label="Preview">
            <h2>Preview</h2>
            <label className="canvas-aspect">Canvas aspect ratio
              <select aria-label="Canvas aspect ratio" disabled={commandLocked || !importEnabled || canvasLive}
                title="Changes the project canvas and export shape. Existing clips refit without changing their saved edits."
                value={CANVAS_ASPECT_PRESETS.find((preset) =>
                  project.settings.width * preset.height === project.settings.height * preset.width)?.label ?? "custom"}
                onChange={(event) => {
                  const preset = CANVAS_ASPECT_PRESETS.find((item) => item.label === event.target.value);
                  if (!preset) return;
                  const size = canvasSizeForAspect(project.settings, preset);
                  if (size.width === project.settings.width && size.height === project.settings.height) return;
                  void run({ ok: true, commands: [{ type: "SetProjectCanvas", ...size }] });
                }}>
                <option value="custom" disabled>Custom</option>
                {CANVAS_ASPECT_PRESETS.map((preset) => <option key={preset.label} value={preset.label}>{preset.label}</option>)}
              </select>
              <span>{project.settings.width} x {project.settings.height}</span>
            </label>
            <Preview config={config} project={previewProject} clock={clock} proxyStates={proxyStates} offline={offline}
              onRefreshStatus={refreshMediaAndProxies} refreshingStatus={refreshingMedia || proxyStatus.refreshing}
              onPreviewJob={(assetId, action) => void previewJob(assetId, action)} previewJobBusy={previewJobBusy || previewJobUnconfirmed || commandLocked}
              canvas={{
                cropControls,
                selectedClipId, onSelect: setSelectedClipId, onDraft: canvasDraft, onCommit: canvasCommit, onLayer: layerClip,
                disabledReason: commandLocked ? "Resolve the pending edit before changing the canvas."
                  : !importEnabled ? "Canvas editing is disabled while this project is closing." : undefined,
              }} />
          </section>
          <Splitter
            orientation="vertical" label="Resize properties pane" onDragStart={beginDrag}
            onDrag={(d) => setNumeric("propertiesWidth", dragStart.current.propertiesWidth - d)}
            onNudge={(d) => setNumeric("propertiesWidth", propertiesWidth - d)}
          />
          <ClipProperties project={project} selectedClipId={selectedClipId}
            disabledReason={commandLocked ? "Resolve the pending edit before changing clip properties."
              : !importEnabled ? "Clip properties are disabled while this project is closing." : undefined}
            onTransform={transformClip} onAppearancePreview={previewAppearance} onSpeed={speedClip} onVolume={volumeClip} onAnimations={animateClip}
            onZoom={zoomClip} onZoomPreview={previewZoom} playheadFrame={() => clock.frame}
            cropControls={cropControls}
            liveTransform={canvasLive && appearanceDraft?.clipId === selectedClipId ? appearanceDraft.transform : null} />
          {assistantOpen && (
            <>
              <Splitter
                orientation="vertical"
                label="Resize assistant pane"
                onDragStart={beginDrag}
                onDrag={(d) => setNumeric("assistantWidth", dragStart.current.assistantWidth - d)}
                onNudge={(d) => setNumeric("assistantWidth", assistantWidth - d)}
              />
              <section className="pane" aria-label="AI Assistant">
                <h2>AI Assistant</h2>
                <p className="placeholder">Chat and quick actions arrive in M4-M6.</p>
              </section>
            </>
          )}
        </div>

        <Splitter
          orientation="horizontal"
          label="Resize timeline"
          onDragStart={beginDrag}
          onDrag={(d) => setNumeric("timelineHeight", dragStart.current.timelineHeight - d)}
          onNudge={(d) => setNumeric("timelineHeight", timelineHeight - d)}
        />
        <section className="pane timeline" style={{ height: timelineHeight }} aria-label="Timeline">
          <Timeline
            project={project}
            clock={clock}
            selectedClipId={selectedClipId}
            selectedTrackId={selectedTrackId}
            offline={offline}
            message={editMessage}
            onSelect={setSelectedClipId}
            onSelectTrack={setSelectedTrackId}
            zoomDraft={zoomDraft}
            onDropAsset={dropAsset}
            onSplit={split}
            onDelete={remove}
            onSplitAudio={splitAudio}
            onTrim={trimClip}
            onMoveClip={moveClip}
            onAddVisualTrack={addVisualTrack}
            onAddAudioTrack={addAudioTrack}
            onRemoveTrack={removeTrack}
            onRenameTrack={renameTrack}
            onLockTrack={lockTrack}
            onReorderVisualTrack={reorderVisualTrack}
            onReorderAudioTrack={reorderAudioTrack}
            onToggleTrackMuted={toggleTrackMuted}
            mutationsDisabled={commandLocked || !importEnabled}
            onCaptionCommands={(commands) => run({ ok: true, commands })}
            onCaptionExpand={() => setSizes((s) => ({ ...s, timelineHeight: Math.max(s.timelineHeight, 440) }))}
          />
        </section>
      </div>

      {exportOpen && <ExportDialog config={config} projectSettings={project.settings} captionCount={project.captionCues.length} onClose={() => setExportOpen(false)} />}
      {helpOpen && <HelpDialog health={health} onClose={() => setHelpOpen(false)} />}

      <footer className="statusbar">
        <StatusArea result={health} />
      </footer>
    </div>
  );
}
