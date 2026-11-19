import { rename, rm } from "node:fs/promises";
import type { ProxyState, Rational } from "@ve/schema";
import { runFfmpeg } from "./ffmpegRun.js";
import { reportDiagnostic } from "./diagnostics.js";

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
  private activeJob: ProxyJob | null = null;
  private committing = false;
  private cancellation: Promise<void> | null = null;
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

  /** Cancellation is settled before callers may retry the same output path. */
  async cancel(assetId: string): Promise<void> {
    const queued = this.queue.find((job) => job.assetId === assetId);
    if (queued) {
      this.queue = this.queue.filter((job) => job !== queued);
      this.set({ assetId, state: "cancelled", percent: 0 });
    }
    if (this.activeJob?.assetId !== assetId) return;
    if (!this.committing) this.active?.abort();
    const settled = this.cancellation;
    if (settled) await settled;
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
    this.activeJob = job;
    this.committing = false;
    let settle!: () => void;
    this.cancellation = new Promise<void>((resolve) => { settle = resolve; });
    const part = `${job.outFile}.part`;
    this.set({ assetId: job.assetId, state: "running", percent: 0 });
    let published = false;
    let last = -1;
    try {
      await this.runner({
        ...job,
        outFile: part,
        ffmpegPath: this.ffmpegPath,
        signal: controller.signal,
        onProgress: (fraction) => {
          const percent = Math.floor(fraction * 100);
          if (percent !== last && generation === this.generation && !controller.signal.aborted) {
            last = percent;
            this.set({ assetId: job.assetId, state: "running", percent });
          }
        },
      });
      if (generation !== this.generation || controller.signal.aborted) throw new Error("cancelled");
      this.committing = true;
      await rename(part, job.outFile);
      published = true;
      if (generation !== this.generation) throw new Error("cancelled");
      await job.onDone();
      if (generation !== this.generation) throw new Error("cancelled");
      this.set({ assetId: job.assetId, state: "done", percent: 100 });
    } catch (e) {
      let message = e instanceof Error ? e.message : "Proxy generation failed.";
      let diagnosticId: string | undefined;
      for (const file of published ? [part, job.outFile] : [part]) {
        try { await rm(file, { force: true }); }
        catch (cleanupError) {
          message += ` Proxy cleanup failed (${file}): ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
          diagnosticId = reportDiagnostic("BACKGROUND_JOB_FAILED", cleanupError, { route: "proxy cleanup" });
        }
      }
      if (generation === this.generation && controller.signal.aborted && !diagnosticId) {
        this.set({ assetId: job.assetId, state: "cancelled", percent: 0 });
      } else if (generation === this.generation) {
        diagnosticId ??= reportDiagnostic("BACKGROUND_JOB_FAILED", e, { route: "proxy generation" });
        this.set({
          assetId: job.assetId,
          state: "failed",
          percent: 0,
          message,
          diagnosticId,
        });
      }
    } finally {
      this.active = null;
      this.activeJob = null;
      this.cancellation = null;
      this.committing = false;
      settle();
      void this.pump();
    }
  }
}
