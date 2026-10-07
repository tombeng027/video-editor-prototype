import { rename, rm } from "node:fs/promises";
import type { ProxyState, Rational } from "@ve/schema";
import { runFfmpeg } from "./ffmpegRun.js";

export type ProxyJob = {
  assetId: string;
  source: string;
  outFile: string;
  fps: Rational;
  durationSeconds: number;
  hasAudio: boolean;
  /** Called after the proxy file is in place; failures here are reported as a failed job. */
  onDone: () => Promise<void>;
};

export type ProxyRunInput = ProxyJob & {
  ffmpegPath: string;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
};
export type ProxyRunner = (input: ProxyRunInput) => Promise<void>;

export const PROXY_HEIGHT = 540;

export function proxyArgs(job: Pick<ProxyJob, "source" | "fps" | "hasAudio">, outFile: string): string[] {
  return [
    "-y",
    "-i", job.source,
    "-map", "0:v:0",
    ...(job.hasAudio ? ["-map", "0:a:0"] : []),
    "-vf", `scale=-2:'min(${PROXY_HEIGHT},ih)'`,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-g", "15",
    "-r", `${job.fps.num}/${job.fps.den}`,
    "-fps_mode", "cfr",
    ...(job.hasAudio ? ["-c:a", "aac", "-b:a", "96k", "-ac", "2"] : []),
    "-movflags", "+faststart",
    "-f", "mp4",
    "-progress", "pipe:1",
    "-nostats",
    outFile,
  ];
}

export const runFfmpegProxy: ProxyRunner = (input) =>
  runFfmpeg({
    ffmpegPath: input.ffmpegPath,
    args: proxyArgs(input, input.outFile),
    durationSeconds: input.durationSeconds,
    signal: input.signal,
    onProgress: input.onProgress,
  });

/** Generates proxies one at a time and reports progress to subscribers. */
export class ProxyManager {
  private states = new Map<string, ProxyState>();
  private queue: ProxyJob[] = [];
  private active: AbortController | null = null;
  private generation = 0;
  private listeners = new Set<(state: ProxyState) => void>();

  constructor(
    private readonly ffmpegPath: string,
    private readonly runner: ProxyRunner = runFfmpegProxy,
  ) {}

  list(): ProxyState[] {
    return [...this.states.values()];
  }

  subscribe(listener: (state: ProxyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(state: ProxyState) {
    this.states.set(state.assetId, state);
    for (const l of this.listeners) l(state);
  }

  enqueue(job: ProxyJob) {
    const existing = this.states.get(job.assetId);
    if (existing && (existing.state === "queued" || existing.state === "running")) return;
    this.queue.push(job);
    this.set({ assetId: job.assetId, state: "queued", percent: 0 });
    void this.pump();
  }

  /** Cancels running work and forgets all state; used when the project changes. */
  reset() {
    this.generation++;
    this.queue = [];
    this.states.clear();
    this.active?.abort();
  }

  /** Resolves once nothing is queued or running (used by tests and shutdown). */
  async idle(): Promise<void> {
    while (this.queue.length > 0 || this.active) await new Promise((r) => setTimeout(r, 10));
  }

  private async pump() {
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.active = controller;
    const part = `${job.outFile}.part`;
    this.set({ assetId: job.assetId, state: "running", percent: 0 });
    let last = -1;
    try {
      await this.runner({
        ...job,
        outFile: part,
        ffmpegPath: this.ffmpegPath,
        signal: controller.signal,
        onProgress: (fraction) => {
          const percent = Math.floor(fraction * 100);
          if (percent !== last && generation === this.generation) {
            last = percent;
            this.set({ assetId: job.assetId, state: "running", percent });
          }
        },
      });
      if (generation !== this.generation) throw new Error("cancelled");
      await rename(part, job.outFile);
      await job.onDone();
      this.set({ assetId: job.assetId, state: "done", percent: 100 });
    } catch (e) {
      await rm(part, { force: true });
      if (generation === this.generation) {
        this.set({
          assetId: job.assetId,
          state: "failed",
          percent: 0,
          message: e instanceof Error ? e.message : "Proxy generation failed.",
        });
      }
    } finally {
      this.active = null;
      void this.pump();
    }
  }
}
