import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_EXPORT_SETTINGS, EXPORT_FRAME_RATES, ExportSettingsSchema, exportFrameRateLabel, resolveExportSettings,
  type ErrorContext, type ExportState, type ExportSettings, type ExportProjectSettings } from "@ve/schema";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { cancelExport, getExport, startExport } from "../projectApi.js";
import { Modal } from "./Modal.js";
import { RecoveryErrorNotice } from "./RecoveryErrorNotice.js";
import { exportProblem } from "../exportErrors.js";

type Props = { config: EngineConfig; projectSettings: ExportProjectSettings; captionCount?: number; onClose: () => void };
type ExportProblem = { context: ErrorContext; detail: string };
const rejectedStartCodes = new Set(["EMPTY_TIMELINE", "OFFLINE_MEDIA", "TOO_MANY_CUTS", "MISSING_ASSET",
  "EXPORT_BUSY", "EXPORT_CANCELLED", "NO_PROJECT", "PROJECT_CHANGED", "INVALID_REQUEST", "INVALID_EXPORT_SETTINGS"]);

export function ExportDialog({ config, projectSettings, captionCount = 0, onClose }: Props) {
  const [settings, setSettings] = useState<ExportSettings>({ ...DEFAULT_EXPORT_SETTINGS });
  const [state, setState] = useState<ExportState>({ state: "idle", percent: 0 });
  const [error, setError] = useState<ExportProblem | null>(null);
  const [starting, setStarting] = useState(false);
  const [unknownStart, setUnknownStart] = useState(false);
  const [checkingStart, setCheckingStart] = useState(false);
  const [activeExportAvailable, setActiveExportAvailable] = useState(false);
  const attempt = useRef<string | null>(null);
  const pendingCheck = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelUnconfirmed, setCancelUnconfirmed] = useState(false);
  const [pollError, setPollError] = useState<ExportProblem | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);
  const pendingStart = useRef(false);
  const pendingCancel = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  const bridge = getBridge();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current++; };
  }, []);

  const start = useCallback(async () => {
    if (pendingStart.current || unknownStart || pendingCheck.current) return;
    pendingStart.current = true;
    const request = ++revision.current;
    setStarting(true);
    setState({ state: "idle", percent: 0 });
    setError(null);
    setActiveExportAvailable(false);
    setPollError(null);
    setCancelRequested(false);
    setCancelUnconfirmed(false);
    attempt.current = crypto.randomUUID();
    const result = await startExport(config, attempt.current, undefined, settings);
    if (!mounted.current || request !== revision.current) return;
    if (result.ok && result.data.state !== "idle" && result.data.attemptId === attempt.current) setState(result.data);
    else if (result.ok) {
      setError(exportProblem("BAD_RESPONSE", "[BAD_RESPONSE] Export start did not identify this attempt with a non-idle state.", "export-start", "unconfirmed"));
      setUnknownStart(true);
    }
    else {
      setError(exportProblem(result.code, `[${result.code}] ${result.message}`, "export-start",
        rejectedStartCodes.has(result.code) ? "not-applied" : "unconfirmed", result.diagnosticId));
      setUnknownStart(!rejectedStartCodes.has(result.code));
      setActiveExportAvailable(result.code === "EXPORT_BUSY");
    }
    pendingStart.current = false;
    setStarting(false);
  }, [config, unknownStart, settings]);

  const checkStart = async (checkActive = false) => {
    if (pendingCheck.current || (!unknownStart && !checkActive)) return;
    pendingCheck.current = true;
    const request = ++revision.current;
    setCheckingStart(true);
    const result = await getExport(config);
    if (!mounted.current || request !== revision.current) return;
    if (!result.ok) setError(exportProblem(result.code, `[${result.code}] ${result.message}`, "export-status", "unconfirmed", result.diagnosticId));
    else if ((!checkActive && result.data.attemptId !== attempt.current) || !result.data.attemptId || result.data.state === "idle") {
      setError(exportProblem("EXPORT_START_UNCONFIRMED", "[EXPORT_START_UNCONFIRMED] Status does not identify this export attempt. A late request may still arrive.", "export-status", "unconfirmed"));
    } else {
      if (checkActive) attempt.current = result.data.attemptId;
      setState(result.data);
      setUnknownStart(false);
      setActiveExportAvailable(false);
      setError(null);
    }
    pendingCheck.current = false;
    setCheckingStart(false);
  };

  useEffect(() => {
    if (state.state !== "running" || cancelling || pollError) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const request = revision.current;
      const result = await getExport(config);
      if (!active || request !== revision.current || pendingCancel.current) return;
      if (!result.ok) {
        setPollError(exportProblem(result.code, `[${result.code}] ${result.message}`, "export-status", "unconfirmed", result.diagnosticId));
        return;
      }
      if (result.data.attemptId !== attempt.current || result.data.state === "idle") {
        setPollError(exportProblem("EXPORT_START_UNCONFIRMED",
          "[EXPORT_START_UNCONFIRMED] Status no longer identifies the running attempt; no result was adopted.", "export-status", "unconfirmed"));
        return;
      }
      setState(result.data);
      setCancelUnconfirmed(false);
      setError(null);
      if (result.data.state === "running") timer = setTimeout(() => void poll(), 500);
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { active = false; clearTimeout(timer); };
  }, [config, state.state, cancelling, pollError, pollAttempt]);

  const cancel = async () => {
    if (pendingCancel.current || cancelRequested || cancelUnconfirmed || pollError) return;
    pendingCancel.current = true;
    const request = ++revision.current;
    setCancelling(true);
    setError(null);
    setPollError(null);
    const result = await cancelExport(config);
    if (!mounted.current || request !== revision.current) return;
    if (result.ok && result.data.attemptId === attempt.current && result.data.state !== "idle") {
      setState(result.data);
      setCancelRequested(result.data.state === "running");
    }
    else {
      setCancelUnconfirmed(true);
      setError(result.ok
        ? exportProblem("EXPORT_START_UNCONFIRMED", "[EXPORT_START_UNCONFIRMED] Cancellation response does not identify this attempt.", "export-cancel", "unconfirmed")
        : exportProblem(result.code, `[${result.code}] ${result.message}`, "export-cancel", "unconfirmed", result.diagnosticId));
    }
    pendingCancel.current = false;
    setCancelling(false);
    setPollAttempt((attempt) => attempt + 1);
  };

  const running = state.state === "running";
  const settingsLocked = running || starting || unknownStart || checkingStart || cancelling;
  const resolved = resolveExportSettings(projectSettings, settings);
  const summary = state.state !== "idle" ? state.settings : resolved;
  const updateSetting = (key: "frameRate" | "resolution" | "quality", value: string) => {
    const parsed = ExportSettingsSchema.safeParse({ ...settings, [key]: value });
    if (!parsed.success) {
      setError(exportProblem("INVALID_EXPORT_SETTINGS", "The selected export setting is not supported.", "export-start", "not-applied"));
      return;
    }
    setSettings(parsed.data);
  };
  const close = () => {
    if (!pendingStart.current && !pendingCancel.current && !running && !unknownStart && !pendingCheck.current) onClose();
  };

  return (
    <Modal label="Export video" dismissible={!running && !starting && !unknownStart && !checkingStart} onClose={close}>
        <h2>Export video</h2>
        <p className="muted">Renders the whole timeline from original media. Output settings do not change your project or clip speed.</p>
        {captionCount > 0 && <p role="status">Captions are Preview-only in this build. This export will not include subtitles
          or extend past the last media clip to include later cues. SRT and burned-in captions are not available yet.</p>}
        {summary
          ? <p aria-label="Export settings summary">{state.state === "idle" ? "Selected output" : "This attempt"}: MP4 / H.264, {summary.width} x {summary.height}, {exportFrameRateLabel(summary.fps)} fps, {summary.quality} quality (CRF {summary.crf}).</p>
          : <p>Output settings for this attempt are unavailable. Do not infer them from the form.</p>}
        <details open={!settingsLocked}>
          <summary>Export options{settingsLocked ? " (locked while export is active or unconfirmed)" : ""}</summary>
          <fieldset disabled={settingsLocked}>
            <legend>{state.state === "idle" ? "Output settings" : "Next export settings"}</legend>
            <p>Format: MP4 / H.264 video + AAC audio (192 kbps stereo)</p>
            <label>Frame rate
              <select data-modal-initial-focus value={settings.frameRate} onChange={(event) => updateSetting("frameRate", event.target.value)}>
                <option value="project">Project rate ({exportFrameRateLabel(projectSettings.fps)} fps)</option>
                {EXPORT_FRAME_RATES.map((rate) => <option key={rate.value} value={rate.value}>{rate.label} fps</option>)}
              </select>
            </label>
            <p className="muted">Higher fps repeats frames; it does not interpolate smoother motion or restore frames excluded by the project rate.</p>
            <label>Resolution
              <select value={settings.resolution} onChange={(event) => updateSetting("resolution", event.target.value)}>
                <option value="project">Project size</option>
                <option value="720p">720p (1280 longest edge)</option>
                <option value="1080p">1080p (1920 longest edge)</option>
                <option value="4k">4K (3840 longest edge)</option>
              </select>
            </label>
            <p className="muted">Keeps the canvas aspect ratio, including portrait. Even-pixel rounding may slightly adjust dimensions.</p>
            {(resolved.width > projectSettings.width || resolved.height > projectSettings.height) &&
              <p>Upscaling increases output pixels, not source detail.</p>}
            <label>Quality
              <select value={settings.quality} onChange={(event) => updateSetting("quality", event.target.value)}>
                <option value="smaller">Smaller file</option>
                <option value="standard">Standard</option>
                <option value="high">High</option>
              </select>
            </label>
            <p className="muted">Higher quality usually produces larger files. File size is not guaranteed.</p>
          </fieldset>
        </details>
        {state.state !== "idle" && !settingsLocked && <p>The form above applies only to your next explicit export.</p>}

        {starting && <p role="status">Starting export... Please wait.</p>}
        {unknownStart && <p role="status">Export start is unconfirmed. Check this attempt's status before retrying or closing.</p>}
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
        {state.state === "cancelled" && <p role="status">Export cancelled. The engine finished cleanup; no completed file was produced by this attempt. Project edits and original media were not changed.</p>}
        {state.state === "failed" && (
          <RecoveryErrorNotice config={config} problem={exportProblem(state.code ?? "EXPORT_FAILED",
            state.message ?? "Export failed without details.", "export", "failed", state.diagnosticId)} />
        )}
        {error && <RecoveryErrorNotice config={config} problem={error} />}
        {pollError && <RecoveryErrorNotice config={config} problem={pollError} />}
        {running && pollError && <p>Progress above is the last confirmed value, not proof the export stopped. Check this attempt again; starting another export and closing remain unavailable.</p>}
        {cancelUnconfirmed && <p role="status">Cancellation was not confirmed. Another cancellation request is paused until a matching export status is received.</p>}
        {cancelling && <p role="status">Requesting cancellation... Waiting for the engine.</p>}
        {running && cancelRequested && <p role="status">Cancellation requested. Waiting for export cleanup to finish.</p>}

        <div className="row modal-actions">
          {unknownStart ? (
            <button disabled={checkingStart} onClick={() => void checkStart()}>{checkingStart ? "Checking export status..." : "Check export status"}</button>
          ) : running ? (
            <>
              <button disabled={cancelling || cancelRequested || cancelUnconfirmed || Boolean(pollError)} onClick={() => void cancel()}>{cancelling ? "Requesting cancellation..." : "Cancel export"}</button>
              {pollError && <button onClick={() => {
                setPollError(null);
                setPollAttempt((attempt) => attempt + 1);
              }}>Retry status check</button>}
            </>
          ) : (
            <>
              {state.state === "done" && state.outputPath && bridge?.revealInFolder && (
                <button onClick={() => void bridge.revealInFolder?.(state.outputPath!)}>Show in folder</button>
              )}
              {activeExportAvailable && <button disabled={checkingStart} onClick={() => void checkStart(true)}>Check active export</button>}
              <button disabled={starting || checkingStart} onClick={() => void start()}>{state.state === "idle" && !error ? "Start export" : "Export again"}</button>
              <button disabled={starting || checkingStart} onClick={close}>Close</button>
            </>
          )}
        </div>
    </Modal>
  );
}