import { link, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ExportState, OfflineAsset, Project } from "@ve/schema";
import { buildRenderPlan, framesToSeconds, planAssetIds } from "@ve/timeline-core";
import type { EngineConfig } from "./config.js";
import { buildExportArgs, ExportPlanError, type ExportAsset } from "./exportArgs.js";
import { runFfmpeg, type FfmpegRun } from "./ffmpegRun.js";
import { resolveAssetPath } from "./importer.js";
import { probeFile } from "./media.js";
import { SessionError, type ProjectSession } from "./session.js";

export type ExportRunner = (input: FfmpegRun) => Promise<void>;
/** Returns the real duration in seconds of a finished file. */
export type DurationProbe = (file: string) => Promise<number>;

export class ExportError extends Error {
  constructor(
    readonly code: "EMPTY_TIMELINE" | "OFFLINE_MEDIA" | "EXPORT_BUSY" | "TOO_MANY_CUTS" | "MISSING_ASSET" | "EXPORT_CANCELLED",
    message: string,
  ) {
    super(message);
  }
}

const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false);

/** Assets whose original file can no longer be found (K7). */
export async function findOfflineAssets(folder: string, project: Project): Promise<OfflineAsset[]> {
  const offline: OfflineAsset[] = [];
  for (const asset of project.assets) {
    const file = resolveAssetPath(folder, asset);
    if (!(await isFile(file))) offline.push({ assetId: asset.id, name: asset.name, path: file });
  }
  return offline;
}

export function exportFileName(projectName: string, now: Date): string {
  const safe = projectName.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "export";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${safe}-${stamp}.mp4`;
}

/** A finished file may differ from the plan by a couple of frames (container rounding) but not more. */
export function durationMatches(actualSeconds: number, expectedSeconds: number, frameSeconds: number): boolean {
  return Math.abs(actualSeconds - expectedSeconds) <= Math.max(0.1, frameSeconds * 2);
}

/** Runs one export at a time for the open project. */
export class Exporter {
  private current: ExportState = { state: "idle", percent: 0 };
  private active: AbortController | null = null;
  private done: Promise<void> = Promise.resolve();
  private epoch = 0;

  constructor(
    private readonly session: ProjectSession,
    private readonly config: EngineConfig,
    private readonly runner: ExportRunner = runFfmpeg,
    private readonly probeDuration: DurationProbe = async (file) => (await probeFile(config.ffprobePath, file)).durationSeconds,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get state(): ExportState {
    return this.current;
  }

  /** Resolves when the running export (if any) has settled. */
  settled(): Promise<void> {
    return this.done;
  }

  /** Validates, then starts in the background; throws `ExportError` when export cannot begin. */
  start(): Promise<ExportState> {
    const open = this.session.open;
    if (!open) return Promise.reject(new SessionError("NO_PROJECT", "No project is open."));
    if (this.active) return Promise.reject(new ExportError("EXPORT_BUSY", "An export is already running or settling."));

    const plan = buildRenderPlan(open.project);
    if (plan.segments.length === 0) return Promise.reject(new ExportError("EMPTY_TIMELINE", "The timeline is empty. Add a clip before exporting."));

    const outFile = path.join(open.folder, "exports", exportFileName(open.project.name, this.now()).replace(/\.mp4$/, `-${randomUUID()}.mp4`));
    const part = `${outFile}.part`;
    const controller = new AbortController();
    const epoch = this.epoch;
    const version = this.session.version;
    this.active = controller;
    this.current = { state: "running", percent: 0 };
    const assertCurrent = () => {
      if (controller.signal.aborted || epoch !== this.epoch) {
        throw new ExportError("EXPORT_CANCELLED", "Export was cancelled before completion.");
      }
      this.session.assertVersion(version);
    };
    return new Promise<ExportState>((resolve, reject) => {
      this.done = (async () => {
        try {
          const used = new Set(planAssetIds(plan));
          const offline = (await findOfflineAssets(open.folder, open.project)).filter((a) => used.has(a.assetId));
          assertCurrent();
          if (offline.length) {
            throw new ExportError("OFFLINE_MEDIA", `These source files are missing: ${offline.map((a) => `${a.name} (${a.path})`).join("; ")}. Restore them and try again.`);
          }
          const assets = new Map<string, ExportAsset>(
            open.project.assets.map((a) => [a.id, { path: resolveAssetPath(open.folder, a), hasAudio: a.hasAudio }]),
          );
          const args = buildExportArgs(plan, assets, part);
          resolve(this.current);
          await this.execute({
            args, part, outFile, controller, epoch, assertCurrent,
            expectedSeconds: framesToSeconds(plan.totalFrames, plan.fps),
            frameSeconds: framesToSeconds(1, plan.fps),
          });
        } catch (error) {
          const failure = error instanceof ExportPlanError ? new ExportError(error.code, error.message) : error;
          if (epoch === this.epoch) {
            this.current = controller.signal.aborted
              ? { state: "cancelled", percent: 0 }
              : { state: "failed", percent: 0, code: "EXPORT_FAILED", message: failure instanceof Error ? failure.message : "Export failed." };
          }
          reject(failure);
        } finally {
          if (this.active === controller) this.active = null;
        }
      })();
    });
  }

  cancel(): ExportState {
    this.active?.abort();
    return this.current;
  }

  private async execute(job: {
    args: string[];
    part: string;
    outFile: string;
    controller: AbortController;
    epoch: number;
    assertCurrent: () => void;
    expectedSeconds: number;
    frameSeconds: number;
  }): Promise<void> {
    const epoch = job.epoch;
    let published = false;
    let last = -1;
    try {
      await this.runner({
        ffmpegPath: this.config.ffmpegPath,
        args: job.args,
        durationSeconds: job.expectedSeconds,
        signal: job.controller.signal,
        onProgress: (fraction) => {
          const percent = Math.min(99, Math.floor(fraction * 100));
          if (percent !== last && epoch === this.epoch && !job.controller.signal.aborted) {
            last = percent;
            this.current = { state: "running", percent };
          }
        },
      });
      job.assertCurrent();
      const actual = await this.probeDuration(job.part);
      job.assertCurrent();
      if (!durationMatches(actual, job.expectedSeconds, job.frameSeconds)) {
        throw new Error(
          `The exported file is ${actual.toFixed(2)}s long but the timeline is ${job.expectedSeconds.toFixed(2)}s. The file was discarded.`,
        );
      }
      // Linking publishes without replacing an existing output; both paths are on the same volume.
      await link(job.part, job.outFile);
      published = true;
      job.assertCurrent();
      await rm(job.part);
      job.assertCurrent();
      this.current = { state: "done", percent: 100, outputPath: job.outFile };
    } catch (e) {
      const cleanupErrors: string[] = [];
      for (const file of published ? [job.part, job.outFile] : [job.part]) {
        try { await rm(file, { force: true }); }
        catch (error) { cleanupErrors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (cleanupErrors.length) {
        const message = `Export did not complete. Cleanup failed: ${cleanupErrors.join("; ")}`;
        if (epoch === this.epoch) this.current = { state: "failed", percent: 0, code: "EXPORT_CLEANUP_FAILED", message };
        else console.error(`EXPORT_CLEANUP_FAILED: ${message}`);
      } else if (epoch === this.epoch) this.current = job.controller.signal.aborted
        ? { state: "cancelled", percent: 0 }
        : { state: "failed", percent: 0, code: "EXPORT_FAILED", message: e instanceof Error ? e.message : "Export failed." };
    }
  }

  /** Cancels any export and forgets its result; used when the project changes. */
  reset() {
    this.epoch++;
    this.active?.abort();
    this.current = { state: "idle", percent: 0 };
  }
}
