import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Asset, Command, ImportRequest, ImportResponse, Project } from "@ve/schema";
import type { EngineConfig } from "./config.js";
import { MediaError, probeFile, quickHash, type MediaInfo } from "./media.js";
import { ProxyManager } from "./proxy.js";
import { SessionError, type ProjectSession } from "./session.js";

export type ProbeFn = (file: string) => Promise<MediaInfo>;

/** Absolute path of an asset's original media (copies are stored relative to the project). */
export function resolveAssetPath(folder: string, asset: Pick<Asset, "sourcePath">): string {
  return path.isAbsolute(asset.sourcePath) ? asset.sourcePath : path.join(folder, asset.sourcePath);
}

export const proxyRelativePath = (assetId: string) => `proxies/${assetId}.mp4`;

async function uniqueCopyTarget(mediaDir: string, fileName: string): Promise<string> {
  const { name, ext } = path.parse(fileName);
  for (let i = 0; ; i++) {
    const candidate = path.join(mediaDir, i === 0 ? fileName : `${name}-${i}${ext}`);
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
  }
}

export class Importer {
  constructor(
    private readonly session: ProjectSession,
    private readonly proxies: ProxyManager,
    private readonly config: EngineConfig,
    private readonly probe: ProbeFn = (file) => probeFile(config.ffprobePath, file),
  ) {}

  async importFiles(req: ImportRequest): Promise<ImportResponse> {
    const open = this.session.open;
    if (!open) throw new SessionError("NO_PROJECT", "No project is open.");
    const { folder } = open;
    const known = new Set(open.project.assets.map((a) => a.contentHash));
    const imported: ImportResponse["imported"] = [];
    const failed: ImportResponse["failed"] = [];
    const added: { asset: Asset; info: MediaInfo }[] = [];

    for (const file of req.paths) {
      try {
        if (!path.isAbsolute(file)) throw new MediaError("UNSUPPORTED", "The file path must be absolute.");
        const stats = await stat(file).catch(() => null);
        if (!stats?.isFile()) throw new MediaError("PROBE_FAILED", "The file was not found.");
        const info = await this.probe(file);
        const contentHash = await quickHash(file);
        if (known.has(contentHash)) throw new MediaError("UNSUPPORTED", "This file is already imported.");

        let sourcePath = file;
        if (req.mode === "copy") {
          const mediaDir = path.join(folder, "media");
          await mkdir(mediaDir, { recursive: true });
          const target = await uniqueCopyTarget(mediaDir, path.basename(file));
          await copyFile(file, target);
          sourcePath = path.relative(folder, target).split(path.sep).join("/");
        }
        known.add(contentHash);
        const asset: Asset = {
          id: `asset_${crypto.randomUUID()}`,
          kind: info.kind,
          name: path.basename(file),
          mediaMode: req.mode,
          sourcePath,
          contentHash,
          durationFrames: info.durationFrames,
          fps: info.fps,
          width: info.width,
          height: info.height,
          hasAudio: info.hasAudio,
          proxyPath: null,
        };
        added.push({ asset, info });
        imported.push({ assetId: asset.id, name: asset.name });
      } catch (e) {
        if (e instanceof MediaError) failed.push({ path: file, code: e.code, message: e.message });
        else failed.push({ path: file, code: "IMPORT_FAILED", message: e instanceof Error ? e.message : "Import failed." });
      }
    }

    if (added.length === 0) return { project: open.project, imported, failed };

    const commands: Command[] = [];
    const firstVideo = added.find((a) => a.info.kind === "video");
    if (firstVideo && this.shouldAdoptFps(open.project)) {
      commands.push({ type: "SetProjectFps", fps: firstVideo.info.fps! });
    }
    for (const { asset } of added) commands.push({ type: "AddAsset", asset });

    const outcome = await this.session.apply(commands);
    if (!outcome.ok) throw new Error(outcome.error.message);

    for (const { asset, info } of added) if (asset.kind === "video") this.enqueueProxy(folder, asset, info.durationSeconds);
    return { project: outcome.project, imported, failed };
  }

  /** Re-queues proxies that are missing, e.g. after reopening a project mid-generation. */
  async resumeProxies(): Promise<void> {
    const open = this.session.open;
    if (!open) return;
    for (const asset of open.project.assets) {
      if (asset.kind !== "video") continue;
      const proxy = path.join(open.folder, proxyRelativePath(asset.id));
      const exists = asset.proxyPath !== null && (await stat(proxy).then((s) => s.isFile(), () => false));
      if (!exists) {
        const source = resolveAssetPath(open.folder, asset);
        if (await stat(source).then((s) => s.isFile(), () => false)) {
          this.enqueueProxy(open.folder, asset, asset.durationFrames * (asset.fps ? asset.fps.den / asset.fps.num : 0));
        }
      }
    }
  }

  private shouldAdoptFps(project: Project): boolean {
    return (
      project.settings.fpsFromFirstImport &&
      project.assets.length === 0 &&
      project.tracks.every((t) => t.clips.length === 0)
    );
  }

  private enqueueProxy(folder: string, asset: Asset, durationSeconds: number) {
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
        // The user may have switched projects while the proxy was rendering.
        if (this.session.open?.folder !== folder) return;
        const outcome = await this.session.apply([{ type: "SetAssetProxy", assetId: asset.id, proxyPath: rel }]);
        if (!outcome.ok) throw new Error(outcome.error.message);
      },
    });
  }
}
