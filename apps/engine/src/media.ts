import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { Rational } from "@ve/schema";

export type MediaInfo = {
  kind: "video" | "audio";
  /** Native frames in `fps`; audio uses a 1000/1 (millisecond) timebase. */
  durationFrames: number;
  fps: Rational | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  durationSeconds: number;
};

export class MediaError extends Error {
  constructor(
    readonly code: "UNSUPPORTED" | "PROBE_FAILED",
    message: string,
  ) {
    super(message);
  }
}

type ProbeStream = {
  codec_type?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  width?: number;
  height?: number;
  duration?: string;
  disposition?: { attached_pic?: number };
};
export type ProbeJson = { streams?: ProbeStream[]; format?: { duration?: string; format_name?: string } };

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function parseRational(text: string | undefined): Rational | null {
  const m = /^(\d+)\/(\d+)$/.exec(text ?? "");
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (num === 0 || den === 0) return null;
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

const IMAGE_FORMATS = new Set(["image2", "png_pipe", "jpeg_pipe", "webp_pipe", "gif", "bmp_pipe", "tiff_pipe"]);

/** Turns raw ffprobe JSON into the facts the project needs. */
export function interpretProbe(json: ProbeJson): MediaInfo {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audio = streams.find((s) => s.codec_type === "audio");
  const formatName = json.format?.format_name ?? "";
  if (video && formatName.split(",").some((f) => IMAGE_FORMATS.has(f))) {
    throw new MediaError("UNSUPPORTED", "Images are not supported yet.");
  }
  const seconds = Number(video?.duration ?? json.format?.duration ?? audio?.duration);
  if (!video && !audio) throw new MediaError("UNSUPPORTED", "No audio or video stream was found.");
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new MediaError("PROBE_FAILED", "Could not read the media duration.");
  }
  if (video) {
    const fps = parseRational(video.avg_frame_rate) ?? parseRational(video.r_frame_rate);
    if (!fps || !video.width || !video.height) {
      throw new MediaError("PROBE_FAILED", "Could not read the video frame rate or size.");
    }
    return {
      kind: "video",
      durationFrames: Math.max(1, Math.round((seconds * fps.num) / fps.den)),
      fps,
      width: video.width,
      height: video.height,
      hasAudio: Boolean(audio),
      durationSeconds: seconds,
    };
  }
  return {
    kind: "audio",
    durationFrames: Math.max(1, Math.round(seconds * 1000)),
    fps: { num: 1000, den: 1 },
    width: null,
    height: null,
    hasAudio: true,
    durationSeconds: seconds,
  };
}

export function probeFile(ffprobePath: string, file: string): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new MediaError("PROBE_FAILED", "ffprobe could not read this file (is it a valid media file?)."));
          return;
        }
        try {
          resolve(interpretProbe(JSON.parse(stdout) as ProbeJson));
        } catch (e) {
          reject(e instanceof MediaError ? e : new MediaError("PROBE_FAILED", "Unreadable ffprobe output."));
        }
      },
    );
  });
}

const SAMPLE_BYTES = 1024 * 1024;

/** Fast identity hash: size plus the first and last megabyte. Enough to spot re-imports. */
export async function quickHash(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const hash = createHash("sha1").update(String(size));
    const head = Buffer.alloc(Math.min(SAMPLE_BYTES, size));
    await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > SAMPLE_BYTES) {
      const tailLen = Math.min(SAMPLE_BYTES, size - SAMPLE_BYTES);
      const tail = Buffer.alloc(tailLen);
      await handle.read(tail, 0, tailLen, size - tailLen);
      hash.update(tail);
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}
