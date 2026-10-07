import { execFile } from "node:child_process";
import type { ComponentStatus } from "@ve/schema";
import type { EngineConfig } from "./config.js";

export type Probes = {
  ffmpeg: (config: EngineConfig) => Promise<ComponentStatus>;
  ollama: (config: EngineConfig) => Promise<ComponentStatus>;
  vision: (config: EngineConfig) => Promise<ComponentStatus>;
};

const TIMEOUT_MS = 1500;

async function probeHttp(
  name: "ollama" | "vision",
  url: string,
  hint: string,
): Promise<ComponentStatus> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { name, status: "unavailable", detail: `HTTP ${res.status}`, hint };
    return { name, status: "ok" };
  } catch {
    return { name, status: "unavailable", detail: "Not reachable", hint };
  }
}

export const defaultProbes: Probes = {
  ffmpeg: (config) =>
    new Promise((resolve) => {
      execFile(config.ffmpegPath, ["-version"], { timeout: TIMEOUT_MS * 2 }, (error, stdout) => {
        if (error) {
          resolve({
            name: "ffmpeg",
            status: "unavailable",
            detail: "FFmpeg was not found",
            hint: "Install FFmpeg or set FFMPEG_PATH.",
          });
          return;
        }
        resolve({ name: "ffmpeg", status: "ok", detail: stdout.split("\n")[0]?.trim() });
      });
    }),
  ollama: (config) =>
    probeHttp("ollama", `${config.ollamaUrl}/api/tags`, "Start Ollama and pull the model (see docs)."),
  vision: (config) =>
    probeHttp("vision", `${config.visionUrl}/health`, "The vision service starts on demand in a later milestone."),
};
