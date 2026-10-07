import { spawn } from "node:child_process";

export type FfmpegRun = {
  ffmpegPath: string;
  args: string[];
  /** Expected output length, used to turn FFmpeg's `out_time` into a 0..1 fraction. */
  durationSeconds: number;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
};

/** Runs FFmpeg with `-progress pipe:1` already in `args`; rejects with the last stderr line on failure. */
export function runFfmpeg(input: FfmpegRun): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.ffmpegPath, input.args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      signal: input.signal,
    });
    let buffer = "";
    let errorTail = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
        // Both keys are reported in microseconds by ffmpeg.
        if (m && input.durationSeconds > 0) {
          input.onProgress(Math.min(1, Number(m[1]) / 1e6 / input.durationSeconds));
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorTail = (errorTail + chunk.toString()).slice(-600);
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(errorTail.trim().split("\n").pop() || `ffmpeg exited with ${code}`)),
    );
  });
}
