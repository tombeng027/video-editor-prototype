import { constants } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Asset, Command, ImportRequest, ImportResponse, Project } from "@ve/schema";
import type { EngineConfig } from "./config.js";
import { MediaError, probeFile, quickHash, type MediaInfo } from "./media.js";
import { ProxyManager } from "./proxy.js";
import { SessionError, type ProjectSession } from "./session.js";

export type ProbeFn = (file: string) => Promise<MediaInfo>;

export class ImportError extends Error {
  constructor(
    readonly code: "IMPORT_FAILED" | "IMPORT_CLEANUP_FAILED",
    message: string,
    cause: unknown,
  ) {
    super(message, { cause });
  }
}

/** Absolute path of an asset's original media (copies are stored relative to the project). */
export function resolveAssetPath(folder: string, asset: Pick<Asset, "sourcePath">): string {
  return path.isAbsolute(asset.sourcePath) ? asset.sourcePath : path.join(folder, asset.sourcePath);
}

export const proxyRelativePath = (assetId: string) => `proxies/${assetId}.mp4`;

async function copyToUniqueTarget(source: string, mediaDir: string, fileName: string): Promise<string> {
  const { name, ext } = path.parse(fileName);
  for (let i = 0; ; i++) {
    const candidate = path.join(mediaDir, i === 0 ? fileName : `${name}-${i}${ext}`);
    try {
      await copyFile(source, candidate, constants.COPYFILE_EXCL);
      return candidate;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
}

export class Importer {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly session: ProjectSession,
    private readonly proxies: ProxyManager,
    private readonly config: EngineConfig,
    private readonly probe: ProbeFn = (file) => probeFile(config.ffprobePath, file),
  ) {}

  importFiles(req: ImportRequest): Promise<ImportResponse> {
    const version = this.session.version;
    const task = this.queue.then(() => this.performImport(req, version), () => this.performImport(req, version));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async performImport(req: ImportRequest, version: number): Promise<ImportResponse> {
    const open = this.session.open;
    if (!open) throw new SessionError("NO_PROJECT", "No project is open.");
    this.session.assertVersion(version);
    const { folder } = open;
    const known = new Set(open.project.assets.map((a) => a.contentHash));
    const imported: ImportResponse["imported"] = [];
    const failed: ImportResponse["failed"] = [];
    const added: { asset: Asset; info: MediaInfo }[] = [];
    const copies: string[] = [];

    try {
      for (const file of req.paths) {
        try {
          if (!path.isAbsolute(file)) throw new MediaError("UNSUPPORTED", "The file path must be absolute.");
          const stats = await stat(file);
          if (!stats.isFile()) throw new MediaError("PROBE_FAILED", "The path is not a file.");
          const info = await this.probe(file);
          const contentHash = await quickHash(file);
          this.session.assertVersion(version);
          if (known.has(contentHash)) throw new MediaError("UNSUPPORTED", "This file is already imported.");

          const asset: Asset = {
            id: `asset_${crypto.randomUUID()}`,
            kind: info.kind,
            name: path.basename(file),
            mediaMode: req.mode,
            sourcePath: file,
            contentHash,
            durationFrames: info.durationFrames,
            fps: info.fps,
            width: info.width,
            height: info.height,
            hasAudio: info.hasAudio,
            proxyPath: null,
          };
          if (req.mode === "copy") {
            const mediaDir = path.join(folder, "media");
            await mkdir(mediaDir, { recursive: true });
            const target = await copyToUniqueTarget(file, mediaDir, path.basename(file));
            copies.push(target);
            asset.sourcePath = path.relative(folder, target).split(path.sep).join("/");
          }
          known.add(contentHash);
          added.push({ asset, info });
          imported.push({ assetId: asset.id, name: asset.name });
        } catch (e) {
          if (e instanceof SessionError) throw e;
          if (e instanceof MediaError) failed.push({ path: file, code: e.code, message: e.message });
          else failed.push({ path: file, code: "IMPORT_FAILED", message: e instanceof Error ? e.message : "Import failed." });
        }
      }

      this.session.assertVersion(version);
      const current = this.session.open;
      if (!current) throw new SessionError("NO_PROJECT", "No project is open.");
      if (added.length === 0) return { project: current.project, imported, failed };

      const outcome = await this.session.apply((project) => {
        const commands: Command[] = [];
        const firstVideo = added.find((a) => a.info.kind === "video");
        if (firstVideo?.info.fps && this.shouldAdoptFps(project)) {
          commands.push({ type: "SetProjectFps", fps: firstVideo.info.fps });
        }
        for (const { asset } of added) commands.push({ type: "AddAsset", asset });
        return commands;
      }, version);
      if (!outcome.ok) throw new Error(outcome.error.message);
      copies.length = 0;

      this.session.assertVersion(version);
      for (const { asset, info } of added) if (asset.kind === "video") this.enqueueProxy(folder, asset, info.durationSeconds, version);
      return { project: outcome.project, imported, failed };
    } catch (error) {
      const cleanupErrors: string[] = [];
      for (const file of copies) {
        try { await rm(file, { force: true }); }
        catch (cleanupError) { cleanupErrors.push(`${file}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`); }
      }
      if (cleanupErrors.length) throw new ImportError("IMPORT_CLEANUP_FAILED", `Import failed: ${error instanceof Error ? error.message : String(error)}. Copied-media cleanup failed: ${cleanupErrors.join("; ")}`, error);
      if (error instanceof SessionError) throw error;
      throw new ImportError("IMPORT_FAILED", error instanceof Error ? error.message : "Import failed.", error);
    }
  }

  /** Re-queues proxies that are missing, e.g. after reopening a project mid-generation. */
  async resumeProxies(): Promise<void> {
    const open = this.session.open;
    if (!open) return;
    const version = this.session.version;
    for (const asset of open.project.assets) {
      if (asset.kind !== "video") continue;
      const proxy = path.join(open.folder, proxyRelativePath(asset.id));
      const exists = asset.proxyPath !== null && (await stat(proxy).then((s) => s.isFile(), () => false));
      if (!exists) {
        const source = resolveAssetPath(open.folder, asset);
        if (await stat(source).then((s) => s.isFile(), () => false)) {
          this.session.assertVersion(version);
          this.enqueueProxy(open.folder, asset, asset.durationFrames * (asset.fps ? asset.fps.den / asset.fps.num : 0), version);
        }
      }
    }
  }

  private shouldAdoptFps(project: Project): boolean {
    return (
      project.settings.fpsFromFirstImport &&
      !project.assets.some((asset) => asset.kind === "video") &&
      project.tracks.every((t) => t.clips.length === 0)
    );
  }

  private enqueueProxy(folder: string, asset: Asset, durationSeconds: number, version: number) {
    if (!asset.fps) return;
    const rel = proxyRelativePath(asset.id);
    this.proxies.enqueue({
      assetId: asset.id,
      source: resolveAssetPath(folder, asset),
      outFile: path.join(folder, rel),
      fps: asset.fps,
      durationSeconds,
      hasAudio: asset.hasAudio,
      onDone: async () => {
        const outcome = await this.session.apply([{ type: "SetAssetProxy", assetId: asset.id, proxyPath: rel }], version);
        if (!outcome.ok) throw new Error(outcome.error.message);
      },
    });
  }
}
