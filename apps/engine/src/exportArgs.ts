import { framesToSeconds, type RenderPlan } from "@ve/timeline-core";

export type ExportAsset = { path: string; hasAudio: boolean };

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

/**
 * Builds the FFmpeg command for a render plan: every segment is trimmed from the original media,
 * normalised to the project size, frame rate and audio format, then concatenated. Gaps are black
 * and silent. Clips whose asset has no audio get silence of the same length.
 */
export function buildExportArgs(plan: RenderPlan, assets: ReadonlyMap<string, ExportAsset>, outFile: string): string[] {
  const width = even(plan.width);
  const height = even(plan.height);
  const rate = `${plan.fps.num}/${plan.fps.den}`;
  const inputs: string[] = [];
  const chains: string[] = [];
  const labels: string[] = [];

  plan.segments.forEach((segment, i) => {
    const length = sec(segment.durationFrames, plan);
    let video: string;
    let audio: string;
    if (segment.kind === "gap") {
      video = `color=c=black:s=${width}x${height}:r=${rate},format=yuv420p,trim=end_frame=${segment.durationFrames},setpts=PTS-STARTPTS`;
      audio = `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=end=${length},asetpts=PTS-STARTPTS`;
    } else {
      const asset = assets.get(segment.assetId);
      if (!asset) throw new ExportPlanError("MISSING_ASSET", "A clip refers to an asset that is not in the project.");
      const index = inputs.length / 6;
      inputs.push("-ss", sec(segment.sourceInFrame, plan), "-t", length, "-i", asset.path);
      // tpad + trim pin each segment to its exact frame count even if the source ends a frame early.
      video =
        `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${rate},format=yuv420p,` +
        `tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${segment.durationFrames},setpts=PTS-STARTPTS`;
      audio = asset.hasAudio
        ? `[${index}:a:0]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=end=${length},asetpts=PTS-STARTPTS`
        : `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=end=${length},asetpts=PTS-STARTPTS`;
    }
    chains.push(`${video}[v${i}]`, `${audio}[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });

  const graph = [...chains, `${labels.join("")}concat=n=${plan.segments.length}:v=1:a=1[vout][aout]`].join(";");
  const args = [
    "-y",
    ...inputs,
    "-filter_complex", graph,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-r", rate,
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
