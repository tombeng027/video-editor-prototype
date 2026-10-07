import os from "node:os";
import path from "node:path";

export type EngineConfig = {
  dataDir: string;
  exitWhenParentGone: boolean;
  host: string;
  port: number;
  token: string;
  allowedOrigins: string[];
  ffmpegPath: string;
  ffprobePath: string;
  ollamaUrl: string;
  visionUrl: string;
  version: string;
};

/** Finds ffprobe next to a configured ffmpeg binary, else relies on PATH. */
function siblingTool(ffmpegPath: string | undefined, tool: string): string {
  if (!ffmpegPath) return tool;
  const ext = path.extname(ffmpegPath);
  return path.join(path.dirname(ffmpegPath), tool + ext);
}

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  const port = Number(env.ENGINE_PORT ?? 7878);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid ENGINE_PORT: ${env.ENGINE_PORT}`);
  }
  return {
    // Loopback only; LAN access is a future opt-in.
    host: "127.0.0.1",
    port,
    dataDir: env.ENGINE_DATA_DIR || path.join(os.homedir(), ".video-editor-prototype"),
    exitWhenParentGone: env.ENGINE_EXIT_WHEN_PARENT_GONE === "1",
    token: env.ENGINE_TOKEN || "dev-token",
    allowedOrigins: env.ENGINE_ALLOWED_ORIGINS
      ? env.ENGINE_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
      : DEFAULT_ORIGINS,
    ffmpegPath: env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: env.FFPROBE_PATH || siblingTool(env.FFMPEG_PATH, "ffprobe"),
    ollamaUrl: env.OLLAMA_URL || "http://127.0.0.1:11434",
    visionUrl: env.VISION_URL || "http://127.0.0.1:7879",
    version: "0.1.0",
  };
}
