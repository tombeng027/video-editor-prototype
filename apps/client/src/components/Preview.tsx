import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { animatedTransform, cropWindow, fittedSize, type Project, type ProxyState, type Transform } from "@ve/schema";
import { clipDuration, clipEnd } from "@ve/timeline-core";
import type { PlayheadClock } from "../clock.js";
import type { EngineConfig } from "../engine.js";
import {
  activeAudioClipsAt, activeVisualClipsAt, audioSourceSeconds, audioUrl, clampToProxy, imageUrl,
  needsSeek, proxyUrl, sourceSeconds, timelineDuration, type ActiveClip,
} from "../playback.js";
import { useClockState, useClockTick } from "../useClock.js";
import { mediaProblem, playbackProblem, previewProblem, type PreviewProblem } from "../previewErrors.js";
import { RecoveryErrorNotice } from "./RecoveryErrorNotice.js";
import { CanvasEditLayer } from "./CanvasEditLayer.js";
import type { LayerAction } from "../timelineOps.js";
import { fitToCanvasTransform } from "../canvasEdit.js";
import type { CropControls } from "../cropEdit.js";
import { PreviewCaptions } from "./PreviewCaptions.js";

type Props = {
  config: EngineConfig; project: Project; clock: PlayheadClock;
  proxyStates?: ReadonlyMap<string, ProxyState>;
  offline?: ReadonlySet<string>;
  onRefreshStatus?: () => void;
  refreshingStatus?: boolean;
  onPreviewJob?: (assetId: string, action: "prepare" | "cancel") => void;
  previewJobBusy?: boolean;
  /** Enables canvas editing (select, move, resize, layer order) when provided. */
  canvas?: {
    cropControls?: CropControls;
    selectedClipId: string | null;
    disabledReason?: string;
    onSelect: (clipId: string) => void;
    onDraft: (clipId: string, transform: Transform | null) => void;
    onCommit: (clipId: string, transform: Transform) => void;
    onLayer: (clipId: string, action: LayerAction) => void;
  };
};
type Overlay = "none" | "empty" | "gap" | "audio" | "error";

const activeKey = (layers: ActiveClip[]) => layers.map(({ clip, asset, track }) =>
  `${track.id}:${clip.id}:${clip.timelineStart}:${clip.sourceIn}:${clip.sourceOut}:${clip.speed}:${track.muted}:${clip.audioLinked}:${clip.volume ?? 1}:${asset.proxyPath ?? asset.sourcePath}:${JSON.stringify([clip.transform, clip.crop, clip.animations, clip.zoom])}`).join("|");

function PreviewLayer({
  config, project, clock, active, visible, retryToken, onError,
}: {
  config: EngineConfig;
  project: Project;
  clock: PlayheadClock;
  active: ActiveClip;
  visible: boolean;
  retryToken: number;
  onError: (problem: PreviewProblem) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const cropFrame = useRef<HTMLDivElement>(null);
  const loadedKey = useRef<string | null>(null);
  const continuity = useRef<{ key: string; sourceOffset: number; speed: number; holding: boolean } | null>(null);
  const playFailed = useRef(false);
  const playPending = useRef(false);
  const playRequest = useRef(0);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loading, setLoading] = useState(false);
  const clearReadyTimer = useCallback(() => {
    if (readyTimer.current !== null) clearTimeout(readyTimer.current);
    readyTimer.current = null;
  }, []);

  const sync = useCallback(() => {
    const frame = Math.min(clock.frame, Math.max(0, timelineDuration(project) - 1));
    const current = activeVisualClipsAt(project, frame).find(({ track }) => track.id === active.track.id);
    if (!current) {
      clearReadyTimer();
      video.current?.pause();
      return;
    }
    const mediaElement = current.asset.kind === "image" ? image.current : video.current;
    if (current.clip.crop && mediaElement) {
      mediaElement.style.transform = "";
      mediaElement.style.opacity = "";
    } else if (cropFrame.current) {
      cropFrame.current.style.transform = "";
      cropFrame.current.style.opacity = "";
    }
    const element = current.clip.crop ? cropFrame.current : mediaElement;
    if (element) {
      const transform = animatedTransform(current.clip.animations, clipDuration(current.clip),
        frame - current.clip.timelineStart, current.clip.transform, current.clip.zoom);
      element.style.transform = `translate(${(transform.x - 0.5) * 100}%, ${(transform.y - 0.5) * 100}%) scale(${transform.scale})`;
      element.style.opacity = String(transform.opacity);
    }

    if (current.asset.kind === "image") {
      clearReadyTimer();
      setLoading(false);
      const el = image.current;
      if (!el) return;
      const key = `${current.asset.id}|${current.asset.sourcePath}`;
      if (loadedKey.current !== key) {
        loadedKey.current = key;
        el.src = imageUrl(config, current.asset.id);
      }
      return;
    }

    const el = video.current;
    if (!el) return;
    el.muted = !current.clip.audioLinked || current.track.muted;
    el.volume = current.clip.volume ?? 1;
    const key = `${current.asset.id}|${current.asset.proxyPath ?? current.asset.sourcePath}`;
    const changed = loadedKey.current !== key;
    if (changed) {
      loadedKey.current = key;
      playFailed.current = false;
      playRequest.current++;
      playPending.current = false;
      el.pause();
      clearReadyTimer();
      el.src = current.asset.proxyPath ? proxyUrl(config, current.asset.id) : imageUrl(config, current.asset.id);
      setLoading(el.readyState < 2);
      if (el.readyState < 2) {
        readyTimer.current = setTimeout(() => {
          playFailed.current = true;
          playRequest.current++;
          playPending.current = false;
          el.pause();
          setLoading(false);
          onError(previewProblem("PREVIEW_READY_TIMEOUT", "No decoded video frame was ready within 5 seconds."));
        }, 5000);
      }
    }
    if (playFailed.current) return;

    const fps = project.settings.fps;
    const sourceOffset = current.clip.sourceIn - current.clip.timelineStart * current.clip.speed;
    const discontinuous = continuity.current?.key !== key || continuity.current.sourceOffset !== sourceOffset ||
      continuity.current.speed !== current.clip.speed;
    const currentFrame = Math.min(frame, Math.max(0, clipEnd(current.clip) - 1));
    const next = current.track.clips.find((clip) => frame + 1 >= clip.timelineStart && frame + 1 < clipEnd(clip));
    const nextAsset = next && project.assets.find((asset) => asset.id === next.assetId);
    const contiguous = next && next.id !== current.clip.id && next.assetId === current.clip.assetId &&
      next.sourceIn === current.clip.sourceOut && next.speed === current.clip.speed;
    const holdBoundary = !next || !nextAsset || (next.id !== current.clip.id && !contiguous);
    const enteringHold = holdBoundary && !continuity.current?.holding;
    continuity.current = { key, sourceOffset, speed: current.clip.speed, holding: holdBoundary };
    const wanted = clampToProxy(sourceSeconds(current.clip, holdBoundary ? currentFrame : clock.position, fps), el.duration, fps);
    el.playbackRate = clock.rate * current.clip.speed;
    el.preservesPitch = true;
    if (!clock.playing || holdBoundary) {
      playRequest.current++;
      playPending.current = false;
      el.pause();
    }
    if (changed || discontinuous || enteringHold || needsSeek(el.currentTime, wanted, clock.playing && !holdBoundary, fps)) {
      el.currentTime = wanted;
    }
    if (clock.playing && !holdBoundary && el.paused && !playPending.current) {
      playPending.current = true;
      const request = ++playRequest.current;
      void el.play().then(() => {
        if (request !== playRequest.current) return;
        playPending.current = false;
        if (!clock.playing) el.pause();
      }).catch((error: unknown) => {
        if (request !== playRequest.current) return;
        clearReadyTimer();
        setLoading(false);
        playPending.current = false;
        playFailed.current = true;
        onError(playbackProblem(error));
      });
    }
  }, [active, clearReadyTimer, clock, config, onError, project]);

  useEffect(() => {
    loadedKey.current = null;
    continuity.current = null;
    playFailed.current = false;
    playRequest.current++;
    playPending.current = false;
  }, [retryToken]);
  useEffect(() => sync(), [retryToken, sync]);
  useEffect(() => () => {
    clearReadyTimer();
    playRequest.current++;
    playPending.current = false;
    video.current?.pause();
  }, [clearReadyTimer]);
  useClockTick(clock, sync);
  useEffect(() => clock.onState(sync), [clock, sync]);

  const mediaError = useCallback(() => {
    const code = video.current?.error?.code;
    clearReadyTimer();
    setLoading(false);
    playFailed.current = true;
    playPending.current = false;
    video.current?.pause();
    onError(mediaProblem(code));
  }, [clearReadyTimer, onError]);

  const transform = active.clip.transform;
  const style = transform ? {
    transform: `translate(${(transform.x - 0.5) * 100}%, ${(transform.y - 0.5) * 100}%) scale(${transform.scale})`,
    opacity: transform.opacity,
  } : undefined;
  const crop = active.clip.crop;
  const window = crop ? cropWindow(crop, active.asset) : undefined;
  const fitted = crop ? fittedSize(project.settings, active.asset, crop) : undefined;
  const sourceFit = fittedSize(project.settings, active.asset);
  const mediaStyle = window ? {
    left: `${-window.left / window.width * 100}%`, top: `${-window.top / window.height * 100}%`,
    width: `${100 / window.width}%`, height: `${100 / window.height}%`,
  } : style;
  const media = active.asset.kind === "image" ? (
    <img
      ref={image}
      style={mediaStyle}
      className={visible ? "" : "hidden"}
      alt={`${active.asset.name} preview`}
      onError={() => onError(previewProblem("PREVIEW_IMAGE_FAILED", "The preview image load failed."))}
    />
  ) : (
    <>
    <video
      ref={video}
      style={mediaStyle}
      className={visible ? "" : "hidden"}
      playsInline
      preload="auto"
      onLoadedMetadata={sync}
      onLoadedData={() => { clearReadyTimer(); setLoading(false); sync(); }}
      onError={mediaError}
    />
    {loading && <span role="status" className="preview-loading">Loading {active.asset.proxyPath ? "optimized preview" : "original"}...</span>}
    </>
  );
  return (
    <div ref={cropFrame} className="preview-media-frame" style={crop ? style : undefined}>
      <div className={crop ? "preview-picture preview-crop-window" : "preview-picture"} style={fitted ? {
        left: `${((1 - sourceFit.width) / 2 + sourceFit.width * (window?.left ?? 0)) * 100}%`,
        top: `${((1 - sourceFit.height) / 2 + sourceFit.height * (window?.top ?? 0)) * 100}%`,
        width: `${fitted.width * 100}%`, height: `${fitted.height * 100}%`,
      } : undefined}>{media}</div>
    </div>
  );
}

function AudioPreviewLayer({
  config, project, clock, active, retryToken, onError,
}: {
  config: EngineConfig;
  project: Project;
  clock: PlayheadClock;
  active: ActiveClip;
  retryToken: number;
  onError: (problem: PreviewProblem) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const loadedKey = useRef<string | null>(null);
  const playFailed = useRef(false);
  const playPending = useRef(false);
  const playRequest = useRef(0);

  const sync = useCallback(() => {
    const frame = Math.min(clock.frame, Math.max(0, timelineDuration(project) - 1));
    const current = activeAudioClipsAt(project, frame).find(({ track }) => track.id === active.track.id);
    const el = audio.current;
    if (!el || !current) {
      el?.pause();
      return;
    }
    const key = `${current.asset.id}|${current.asset.sourcePath}`;
    if (loadedKey.current !== key) {
      loadedKey.current = key;
      playFailed.current = false;
      playRequest.current++;
      playPending.current = false;
      el.pause();
      el.src = audioUrl(config, current.asset.id);
    }
    el.muted = current.track.muted;
    el.volume = current.clip.volume ?? 1;
    const sourceDuration = current.asset.durationFrames * (current.asset.fps?.den ?? 1) /
      (current.asset.fps?.num ?? 1000) * (project.settings.fps.num / project.settings.fps.den);
    el.loop = current.clip.sourceOut > sourceDuration;
    if (playFailed.current || current.track.muted) {
      el.pause();
      return;
    }

    const wanted = audioSourceSeconds(current, clock.position, project.settings.fps);
    el.playbackRate = clock.rate * current.clip.speed;
    el.preservesPitch = true;
    if (!clock.playing) {
      playRequest.current++;
      playPending.current = false;
      el.pause();
    }
    if (el.readyState >= 1 && (loadedKey.current === key || needsSeek(el.currentTime, wanted, clock.playing, project.settings.fps))) {
      if (needsSeek(el.currentTime, wanted, clock.playing, project.settings.fps)) el.currentTime = wanted;
    }
    if (clock.playing && el.paused && !playPending.current) {
      playPending.current = true;
      const request = ++playRequest.current;
      void el.play().then(() => {
        if (request !== playRequest.current) return;
        playPending.current = false;
        if (!clock.playing) el.pause();
      }).catch((error: unknown) => {
        if (request !== playRequest.current) return;
        playPending.current = false;
        playFailed.current = true;
        onError(playbackProblem(error));
      });
    }
  }, [active, clock, config, onError, project]);

  useEffect(() => {
    loadedKey.current = null;
    playFailed.current = false;
    playRequest.current++;
    playPending.current = false;
    audio.current?.pause();
    audio.current?.removeAttribute("src");
  }, [retryToken]);
  useEffect(() => sync(), [retryToken, sync]);
  useEffect(() => () => {
    playRequest.current++;
    playPending.current = false;
    audio.current?.pause();
  }, []);
  useClockTick(clock, sync);
  useEffect(() => clock.onState(sync), [clock, sync]);

  const mediaError = useCallback(() => {
    playFailed.current = true;
    playPending.current = false;
    audio.current?.pause();
    onError(mediaProblem(audio.current?.error?.code));
  }, [onError]);

  return <audio ref={audio} preload="auto" onLoadedMetadata={sync} onError={mediaError} aria-label={`Audio preview ${active.asset.name}`} />;
}

const sourceIdentity = (asset: Project["assets"][number]) => `${asset.id}|${asset.sourcePath}|${asset.contentHash}`;

export function Preview({ config, project: currentProject, clock, proxyStates, offline, onRefreshStatus, refreshingStatus = false,
  onPreviewJob, previewJobBusy = false, canvas }: Props) {
  const { playing } = useClockState(clock);
  const [snapping, setSnapping] = useState(true);
  const [playbackSources, setPlaybackSources] = useState(() => new Map(
    currentProject.assets.map((asset) => [sourceIdentity(asset), asset.proxyPath])));
  useEffect(() => {
    if (!playing) setPlaybackSources(new Map(currentProject.assets.map((asset) => [sourceIdentity(asset), asset.proxyPath])));
  }, [currentProject.assets, playing]);
  const project = useMemo(() => !playing ? currentProject : ({
    ...currentProject,
    assets: currentProject.assets.map((asset) => ({
      ...asset, proxyPath: playbackSources.has(sourceIdentity(asset)) ? playbackSources.get(sourceIdentity(asset))! : asset.proxyPath,
    })),
  }), [currentProject, playbackSources, playing]);
  const [layers, setLayers] = useState<ActiveClip[]>([]);
  const [audioLayers, setAudioLayers] = useState<ActiveClip[]>([]);
  const layersKey = useRef("");
  const audioLayersKey = useRef("");
  const [overlay, setOverlay] = useState<Overlay>("empty");
  const [previewError, setPreviewError] = useState<PreviewProblem | null>(null);
  const [audioError, setAudioError] = useState<PreviewProblem | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const sync = useCallback(() => {
    const end = timelineDuration(project);
    const frame = Math.min(clock.frame, Math.max(0, end - 1));
    const active = activeVisualClipsAt(project, frame);
    const nextKey = activeKey(active);
    if (nextKey !== layersKey.current) {
      layersKey.current = nextKey;
      setLayers(active);
      setPreviewError(null);
    }
    const activeAudio = activeAudioClipsAt(project, frame);
    const nextAudioKey = activeKey(activeAudio);
    if (nextAudioKey !== audioLayersKey.current) {
      audioLayersKey.current = nextAudioKey;
      setAudioLayers(activeAudio);
      setAudioError(null);
    }
    if (active.length === 0) {
      setOverlay(activeAudio.length > 0 ? "audio" : end === 0 ? "empty" : "gap");
    } else {
      setOverlay("none");
    }
  }, [clock, project]);

  useClockTick(clock, sync);
  useEffect(() => clock.onState(sync), [clock, sync]);
  useEffect(() => {
    sync();
  }, [sync]);

  const reportError = useCallback((problem: PreviewProblem) => {
    clock.pause();
    setPreviewError(problem);
    setOverlay("error");
  }, [clock]);

  const retry = useCallback(() => {
    setPreviewError(null);
    setOverlay("none");
    setRetryToken((token) => token + 1);
  }, []);

  const offlineLayers = [...layers, ...audioLayers].filter(({ asset }) => offline?.has(asset.id));
  const mediaUnavailable = offlineLayers.length > 0;
  const visibleOverlay = previewError ? "error" : overlay;
  const fitTarget = activeVisualClipsAt(project, Math.min(clock.frame, Math.max(0, timelineDuration(project) - 1)))
    .find(({ clip }) => clip.id === canvas?.selectedClipId);
  const fitDisabledReason = canvas?.disabledReason ?? (!fitTarget ? "Select a picture at the playhead to fit it to the canvas."
    : fitTarget.track.locked ? "Unlock the track before fitting this clip."
    : mediaUnavailable || visibleOverlay !== "none" ? "The selected picture is unavailable." : undefined);
  const refreshControl = onRefreshStatus && (
    <button onClick={onRefreshStatus} disabled={refreshingStatus}>
      {refreshingStatus ? "Refreshing preview status..." : "Refresh preview status"}
    </button>
  );

  return (
    <div className="preview-content">
    <div className="preview-frame" style={{ aspectRatio: `${project.settings.width} / ${project.settings.height}` }}>
      <div className="preview-canvas">
      {layers.filter(({ asset }) => !offline?.has(asset.id)).map((active) => (
        <PreviewLayer
          key={active.track.id}
          config={config}
          project={project}
          clock={clock}
          active={active}
          visible={!mediaUnavailable && visibleOverlay === "none"}
          retryToken={retryToken}
          onError={reportError}
        />
      ))}
      {audioLayers.filter(({ asset }) => !offline?.has(asset.id)).map((active) => (
        <AudioPreviewLayer
          key={active.track.id}
          config={config}
          project={project}
          clock={clock}
          active={active}
          retryToken={retryToken}
          onError={setAudioError}
        />
      ))}
      {canvas && !mediaUnavailable && visibleOverlay === "none" && (
        <CanvasEditLayer project={project} clock={clock} offline={offline} snapping={snapping} {...canvas} />
      )}
      </div>
      {!mediaUnavailable && overlay === "empty" && <span className="placeholder">{project.assets.length ? "Add a clip to the timeline" : "Import media to begin"}</span>}
      {!mediaUnavailable && overlay === "gap" && <span className="placeholder">No clip here</span>}
      {!mediaUnavailable && overlay === "audio" && <span className="placeholder">No video at playhead; audio track is active</span>}
      {(mediaUnavailable || visibleOverlay === "error") && <span className="placeholder">Preview unavailable - see guidance below</span>}
      <PreviewCaptions project={project} clock={clock} />
    </div>
      {canvas && (
        <div className="preview-tools">
          {canvas.cropControls && <button aria-pressed={canvas.cropControls.active} disabled={Boolean(fitDisabledReason)}
            title={fitDisabledReason ?? "Toggle crop edge and corner handles. Choose the crop constraint in Properties or the right-click menu."}
            onClick={() => { clock.pause(); canvas.cropControls?.onActive(!canvas.cropControls.active); }}>Crop</button>}
          <button disabled={Boolean(fitDisabledReason) || canvas.cropControls?.active}
            title={fitDisabledReason ?? (canvas.cropControls?.active ? "Exit Crop mode before resizing or fitting the picture." : "Center the clip and reset its base scale to 100%. Crop, opacity and animations stay unchanged.")}
            onClick={() => {
              if (!fitTarget || fitDisabledReason || canvas.cropControls?.active) return;
              clock.pause();
              canvas.onCommit(fitTarget.clip.id, fitToCanvasTransform(fitTarget.clip));
            }}>Fit to canvas</button>
          <button aria-pressed={snapping} onClick={() => setSnapping((on) => !on)}
            title="Snap pictures to the canvas center, edges and other pictures while dragging. Hold Alt to move freely.">
            Snap {snapping ? "on" : "off"}
          </button>
        </div>
      )}
      {audioError && !mediaUnavailable && (
        <div className="audio-preview-error">
          <RecoveryErrorNotice config={config} problem={audioError} />
          <button onClick={() => { setAudioError(null); setRetryToken((token) => token + 1); }}>Retry audio</button>
          {refreshControl}
        </div>
      )}
      {offlineLayers.length > 0 ? (
        <div className="preview-error">
          <RecoveryErrorNotice config={config} problem={previewProblem("PREVIEW_OFFLINE",
            "The latest media-status check reported offline originals.")} />
          <p>Unavailable: {[...new Set(offlineLayers.map(({ asset }) => asset.name))].join(", ")}</p>
          {refreshControl}
        </div>
      ) : null}
      {!mediaUnavailable && layers.some(({ asset }) => asset.kind === "video") && (
        <div className="preview-source-status">
          {layers.filter(({ asset }) => asset.kind === "video").map(({ track, asset }) => {
            const state = proxyStates?.get(asset.id);
            const pending = state?.state === "queued" || state?.state === "running";
            return <div key={track.id}>
              <span>{asset.name}: {asset.proxyPath ? "Optimized preview" : "Editing original"}
                {pending ? ` · Optimizing preview: ${state.state === "queued" ? "queued" : `${state.percent}%`}` : ""}
                {state?.state === "cancelled" ? " · Optimization cancelled" : ""}
                {!asset.proxyPath && currentProject.assets.find((candidate) => candidate.id === asset.id)?.proxyPath ? " · Optimized preview ready; pause to switch" : ""}
              </span>
              {state?.state === "failed" && <RecoveryErrorNotice config={config} recordUnknown={false}
                problem={previewProblem("PREVIEW_JOB_FAILED", state.message ?? "Optimization failed without details.",
                  "preview-prepare", "job", state.diagnosticId)} />}
              {onPreviewJob && (!asset.proxyPath || pending) && (
                <button disabled={previewJobBusy} onClick={() => onPreviewJob(asset.id, pending ? "cancel" : "prepare")}>
                  {pending ? "Cancel preparation" : state?.state === "failed" ? "Retry optimized preview" : "Prepare optimized preview"}
                </button>
              )}
            </div>;
          })}
        </div>
      )}
      {!mediaUnavailable && visibleOverlay === "error" && (
        <div className="preview-error">
          {previewError && <RecoveryErrorNotice config={config} problem={previewError} />}
          <button onClick={retry}>Retry preview</button>
          {refreshControl}
        </div>
      )}
    </div>
  );
}
