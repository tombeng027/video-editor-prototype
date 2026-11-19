import { framesToSeconds, type RenderPlan } from "@ve/timeline-core";
import { resolveExportSettings, type ResolvedExportSettings } from "@ve/schema";
import { animationExpressions } from "./animationExpressions.js";

export type ExportAsset = { path: string; hasAudio: boolean; kind?: "video" | "image"; durationFrames?: number };

export class ExportPlanError extends Error {
  constructor(
    readonly code: "TOO_MANY_CUTS" | "MISSING_ASSET",
    message: string,
  ) {
    super(message);
  }
}

// Windows limits a command line to about 32k characters; stay well below it.
const MAX_ARG_CHARS = 28_000;
const AUDIO_RATE = 48_000;

const sec = (frames: number, plan: RenderPlan) => framesToSeconds(frames, plan.fps).toFixed(6);
const even = (n: number) => Math.max(2, n - (n % 2));

function tempo(speed: number): string {
  if (speed === 1) return "";
  if (speed < 0.5) return `atempo=0.5,atempo=${speed / 0.5},`;
  if (speed > 2) return `atempo=2,atempo=${speed / 2},`;
  return `atempo=${speed},`;
}

const gain = (volume: number | undefined) => volume === undefined || volume === 1 ? "" : `volume=${volume},`;

/**
 * Builds an FFmpeg command that composites visual layers and mixes independent audio clips.
 * Gaps are black and silent. Every visual layer's own sound is mixed unless split away or its track is muted.
 */
export function buildExportArgs(plan: RenderPlan, assets: ReadonlyMap<string, ExportAsset>, outFile: string,
  settings: ResolvedExportSettings = resolveExportSettings(plan)): string[] {
  const width = even(plan.width);
  const height = even(plan.height);
  const rate = `${plan.fps.num}/${plan.fps.den}`;
  const inputs: string[] = [];
  const chains: string[] = [];
  const labels: string[] = [];
  let inputIndex = 0;

  plan.segments.forEach((segment, i) => {
    const length = sec(segment.durationFrames, plan);
    let audio: string;
    if (segment.kind === "gap") {
      chains.push(`color=c=black:s=${width}x${height}:r=${rate},format=yuv420p,trim=end_frame=${segment.durationFrames},setpts=PTS-STARTPTS[v${i}]`);
      audio = `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=end=${length},asetpts=PTS-STARTPTS`;
    } else {
      chains.push(`color=c=black:s=${width}x${height}:r=${rate},format=rgba,trim=end_frame=${segment.durationFrames},setpts=PTS-STARTPTS[base${i}]`);
      let background = `base${i}`;
      const inputIndexes: number[] = [];
      segment.layers.forEach((layer, layerIndex) => {
        const asset = assets.get(layer.assetId);
        if (!asset) throw new ExportPlanError("MISSING_ASSET", "A clip refers to an asset that is not in the project.");
        const index = inputIndex++;
        inputIndexes.push(index);
        if (asset.kind === "image") {
          inputs.push("-i", asset.path);
        } else {
          const sourceLength = Math.min(segment.durationFrames * (layer.speed ?? 1),
            layer.sourceOutFrame === undefined ? Infinity : layer.sourceOutFrame - layer.sourceInFrame);
          inputs.push("-ss", sec(layer.sourceInFrame, plan), "-t", sec(sourceLength, plan), "-i", asset.path);
        }
        const foreground = `layer${i}_${layerIndex}`;
        const crop = layer.crop;
        let visualInput = `${index}:v:0`;
        if (asset.kind === "image") {
          // Repeat the first frame in the filter graph; GIF does not support image2 input options.
          const still = `still${i}_${layerIndex}`;
          chains.push(`[${visualInput}]trim=end_frame=1,loop=loop=${Math.max(1, segment.durationFrames - 1)}:size=1:start=0,` +
            `settb=expr=${plan.fps.den}/${plan.fps.num},setpts=N[${still}]`);
          visualInput = still;
        }
        if (crop) {
          const prefix = `crop${i}_${layerIndex}`;
          // Restore the original transparent footprint so fit, position and motion never depend on crop.
          chains.push(`[${visualInput}]format=rgba,split[${prefix}Source][${prefix}Window]`);
          chains.push(`[${prefix}Source]colorchannelmixer=aa=0[${prefix}Canvas]`);
          chains.push(`[${prefix}Window]crop=w='max(1,floor(iw*${1 - crop.left - crop.right}))':h='max(1,floor(ih*${1 - crop.top - crop.bottom}))':x='floor(iw*${crop.left})':y='floor(ih*${crop.top})':exact=1[${prefix}Region]`);
          chains.push(`[${prefix}Canvas][${prefix}Region]overlay=x='floor(main_w*${crop.left})':y='floor(main_h*${crop.top})':format=auto[${prefix}Result]`);
          visualInput = `${prefix}Result`;
        }
        const transform = layer.transform;
        const animated = layer.clipDurationFrames !== undefined
          ? {
            size: animationExpressions(layer.animations, layer.clipDurationFrames, layer.clipOffsetFrames, "n", transform, layer.zoom),
            alpha: animationExpressions(layer.animations, layer.clipDurationFrames, layer.clipOffsetFrames, "N", transform, layer.zoom),
            position: animationExpressions(layer.animations, layer.clipDurationFrames, layer.clipOffsetFrames, "n-1", transform, layer.zoom),
          } : undefined;
        const opacityFilter = animated && animated.alpha.opacity !== String(transform?.opacity ?? 1)
          ? `format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${animated.alpha.opacity}',`
          : `colorchannelmixer=aa=${transform?.opacity ?? 1},`;
        const visualTransform = animated
          ? opacityFilter +
            `scale=w='max(2,round(${width}*${animated.size.scale}))':h='max(2,round(${height}*${animated.size.scale}))':eval=frame,format=rgba,`
          : transform
          ? `scale=${Math.max(2, Math.round(width * transform.scale))}:${Math.max(2, Math.round(height * transform.scale))},colorchannelmixer=aa=${transform.opacity},`
          : "";
        chains.push(
          `[${visualInput}]${layer.speed ? `setpts=(PTS-STARTPTS)/${layer.speed},` : ""}scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `format=rgba,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black@0,setsar=1,fps=${rate},` +
          (animated
            ? `tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${segment.durationFrames},setpts=PTS-STARTPTS,${visualTransform}`
            : `${visualTransform}tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${segment.durationFrames},setpts=PTS-STARTPTS,`) +
          `null[${foreground}]`,
        );
        const composite = `comp${i}_${layerIndex}`;
        const position = animated ? `x='${width}*${animated.position.x}-overlay_w/2':y='${height}*${animated.position.y}-overlay_h/2':eval=frame:`
          : transform ? `x=${width * transform.x}-overlay_w/2:y=${height * transform.y}-overlay_h/2:` : "";
        chains.push(`[${background}][${foreground}]overlay=${position}eof_action=pass:shortest=1:format=auto[${composite}]`);
        background = composite;
      });
      chains.push(`[${background}]format=yuv420p[v${i}]`);
      const silence = `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=end=${length},asetpts=PTS-STARTPTS`;
      const sounds = segment.layers.flatMap((layer, layerIndex) => {
        if (layer.audioMuted || !assets.get(layer.assetId)!.hasAudio) return [];
        const label = `layerAudio${i}_${layerIndex}`;
        chains.push(`[${inputIndexes[layerIndex]!}:a:0]asetpts=PTS-STARTPTS,${tempo(layer.speed ?? 1)}${gain(layer.volume)}aresample=${AUDIO_RATE},` +
          `aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end=${length},asetpts=PTS-STARTPTS[${label}]`);
        return [`[${label}]`];
      });
      // Stacked clips are summed (not averaged) so a segment's volume does not drop just because layers overlap.
      audio = sounds.length === 0 ? silence
        : sounds.length === 1 ? `${sounds[0]}anull`
        : `${sounds.join("")}amix=inputs=${sounds.length}:duration=first:dropout_transition=0:normalize=0`;
    }
    chains.push(`${audio}[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });

  chains.push(`${labels.join("")}concat=n=${plan.segments.length}:v=1:a=1[vout][aout]`);
  let audioOutput = "aout";
  if (plan.audioClips.length > 0) {
    const externalAudio: string[] = [];
    plan.audioClips.forEach((clip, i) => {
      const asset = assets.get(clip.assetId);
      if (!asset || !asset.hasAudio) {
        throw new ExportPlanError("MISSING_ASSET", "An audio clip refers to a missing asset or one without an audio stream.");
      }
      const index = inputIndex++;
      const length = sec(clip.durationFrames, plan);
      const delay = Math.round(framesToSeconds(clip.startFrame, plan.fps) * 1000);
      const sourceIn = asset.durationFrames
        ? clip.sourceInFrame % asset.durationFrames
        : clip.sourceInFrame;
      const sourceLength = Math.min(clip.durationFrames * (clip.speed ?? 1),
        clip.sourceOutFrame === undefined ? Infinity : clip.sourceOutFrame - clip.sourceInFrame);
      // Loop only clips that run past their file; looping one that ends at the file end replays trimmed-away audio.
      // Up to a frame of rounding short is padded with silence instead.
      const loops = Boolean(asset.durationFrames) && sourceIn + sourceLength > asset.durationFrames! + 1;
      inputs.push(...(loops ? ["-stream_loop", "-1"] : []), "-ss", sec(sourceIn, plan), "-t", sec(sourceLength, plan), "-i", asset.path);
      const label = `timelineAudio${i}`;
      // Sample-count timestamps keep atrim exact even across a loop's timestamp jump.
      chains.push(
        `[${index}:a:0]asetpts=N/SR/TB,${tempo(clip.speed ?? 1)}${gain(clip.volume)}aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `apad,atrim=duration=${length},asetpts=PTS-STARTPTS,adelay=${delay}:all=1[${label}]`,
      );
      externalAudio.push(`[${label}]`);
    });
    audioOutput = "mixedAudio";
    // Summed like stacked layers; amix's default normalization would divide every input by the clip count.
    chains.push(`[aout]${externalAudio.join("")}amix=inputs=${externalAudio.length + 1}:duration=first:dropout_transition=0:normalize=0[${audioOutput}]`);
  }

  let videoOutput = "vout";
  if (settings.width !== width || settings.height !== height ||
    settings.fps.num * plan.fps.den !== plan.fps.num * settings.fps.den) {
    const outputFrames = Math.max(1, Math.round(framesToSeconds(plan.totalFrames, plan.fps) * settings.fps.num / settings.fps.den));
    chains.push(`[vout]scale=${settings.width}:${settings.height},setsar=1,` +
      `tpad=stop_mode=clone:stop_duration=${settings.fps.den / settings.fps.num},` +
      `fps=${settings.fps.num}/${settings.fps.den},trim=end_frame=${outputFrames},setpts=PTS-STARTPTS[exportVideo]`);
    videoOutput = "exportVideo";
  }
  const graph = chains.join(";");
  const args = [
    "-y",
    ...inputs,
    "-filter_complex", graph,
    "-map", `[${videoOutput}]`,
    "-map", `[${audioOutput}]`,
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", String(settings.crf),
    "-pix_fmt", "yuv420p",
    "-r", `${settings.fps.num}/${settings.fps.den}`,
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-f", "mp4",
    "-progress", "pipe:1",
    "-nostats",
    outFile,
  ];
  if (args.join(" ").length > MAX_ARG_CHARS) {
    throw new ExportPlanError(
      "TOO_MANY_CUTS",
      `This timeline has ${plan.segments.length} segments, which is more than the prototype exporter can handle in one pass.`,
    );
  }
  return args;
}
