import { constants } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Asset, Command, ImportRequest, ImportResponse, Project } from "@ve/schema";
import type { EngineConfig } from "./config.js";
import { MediaError, probeFile, quickHash, type MediaInfo } from "./media.js";
import { ProxyManager } from "./proxy.js";
import { SessionError, type ProjectSession } from "./session.js";
import { reportDiagnostic } from "./diagnostics.js";

export type ProbeFn = (file: string) => Promise<MediaInfo>;
export type ImportOutcomeKnown = (response: ImportResponse) => void;

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

async function proxyFileExists(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); }
  catch (error) {
    if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR"].includes(String(error.code))) return false;
    throw error;
  }
}

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

  importFiles(req: ImportRequest, onOutcomeKnown?: ImportOutcomeKnown): Promise<ImportResponse> {
    const version = this.session.version;
    const task = this.queue.then(() => this.performImport(req, version, onOutcomeKnown), () => this.performImport(req, version, onOutcomeKnown));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async performImport(req: ImportRequest, version: number, onOutcomeKnown?: ImportOutcomeKnown): Promise<ImportResponse> {
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
          if (!path.isAbsolute(file)) throw new MediaError("INVALID_MEDIA_PATH", "The file path must be absolute.");
          const stats = await stat(file);
          if (!stats.isFile()) throw new MediaError("INVALID_MEDIA_PATH", "The path is not a file.");
          const info = await this.probe(file);
          const contentHash = await quickHash(file);
          this.session.assertVersion(version);
          if (known.has(contentHash)) throw new MediaError("ALREADY_IMPORTED", "This file is already imported.");

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
          else if (e instanceof Error && "code" in e && ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(e.code))) {
            const missing = e.code === "ENOENT" || e.code === "ENOTDIR";
            failed.push({ path: file, code: missing ? "FILE_NOT_FOUND" : "FILE_ACCESS_DENIED",
              message: missing ? "The source file or containing folder is unavailable." : "The source or copy destination could not be accessed." });
          }
          else {
            const diagnosticId = reportDiagnostic("IMPORT_FILE_FAILED", e, { method: "POST", route: "/project/import" });
            failed.push({
              path: file,
              code: "IMPORT_FAILED",
              message: "The file could not be imported. Check engine diagnostics using the diagnostic ID.",
              diagnosticId,
            });
          }
        }
      }

      this.session.assertVersion(version);
      const current = this.session.open;
      if (!current) throw new SessionError("NO_PROJECT", "No project is open.");
      if (added.length === 0) {
        const response = { project: current.project, imported, failed };
        onOutcomeKnown?.(response);
        return response;
      }

      const outcome = await this.session.apply((project) => {
        const commands: Command[] = [];
        const firstVideo = added.find((a) => a.info.kind === "video");
        const adoptFps = Boolean(firstVideo?.info.fps && this.shouldAdoptFps(project));
        if (adoptFps && firstVideo?.info.fps) {
          commands.push({ type: "SetProjectFps", fps: firstVideo.info.fps });
        }
        const imageFps = adoptFps && firstVideo?.info.fps ? firstVideo.info.fps : project.settings.fps;
        for (const { asset, info } of added) {
          if (info.kind === "image") {
            asset.durationFrames = Math.max(1, Math.round((info.durationSeconds * imageFps.num) / imageFps.den));
          }
          commands.push({ type: "AddAsset", asset });
        }
        return commands;
      }, version);
      if (!outcome.ok) throw new Error(outcome.error.message);
      copies.length = 0;
      const response = { project: outcome.project, imported, failed };
      onOutcomeKnown?.(response);

      return response;
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

  /** Drops stale proxy references without automatically starting expensive conversion. */
  async reconcileProxies(): Promise<void> {
    const open = this.session.open;
    if (!open) return;
    const version = this.session.version;
    for (const asset of open.project.assets) {
      if (asset.kind !== "video") continue;
      const proxy = path.join(open.folder, proxyRelativePath(asset.id));
      const exists = asset.proxyPath !== null && await proxyFileExists(proxy);
      if (!exists && asset.proxyPath) {
        const outcome = await this.session.apply([{ type: "SetAssetProxy", assetId: asset.id, proxyPath: null }], version);
        if (!outcome.ok) throw new ImportError("IMPORT_FAILED", outcome.error.message, outcome.error);
      }
    }
  }

  async prepareProxy(assetId: string, version: number): Promise<void> {
    this.session.assertVersion(version);
    const open = this.session.open!;
    const asset = open.project.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.kind !== "video" || !asset.fps) {
      throw new MediaError("UNSUPPORTED", "Choose a video asset to prepare an optimized preview.");
    }
    const file = resolveAssetPath(open.folder, asset);
    let sourceExists: boolean;
    try { sourceExists = (await stat(file)).isFile(); }
    catch (error) {
      if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(error.code))) {
        throw new MediaError("PROBE_FAILED", "The original media cannot be read. Check its location and permissions, or relink it.");
      }
      throw error;
    }
    if (!sourceExists) throw new MediaError("PROBE_FAILED", "The original media path is not a file.");
    this.session.assertVersion(version);
    if (asset.proxyPath && await proxyFileExists(path.join(open.folder, asset.proxyPath))) return;
    this.session.assertVersion(version);
    this.enqueueProxy(open.folder, asset, asset.durationFrames * asset.fps.den / asset.fps.num, version);
  }

  private shouldAdoptFps(project: Project): boolean {
    return (
      project.settings.fpsFromFirstImport &&
      project.captionCues.length === 0 &&
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
