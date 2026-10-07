import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import type { EngineInfo } from "./engineArg.js";

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("Could not determine a free port."));
      });
    });
  });
}

export function clientOrigin(clientUrl: string): string {
  return new URL(clientUrl).origin;
}

export function buildEngineLaunch(opts: {
  engineDir: string;
  execPath: string;
  port: number;
  token: string;
  clientUrl: string;
  baseEnv: NodeJS.ProcessEnv;
}) {
  return {
    command: opts.execPath,
    args: ["--import", "tsx", path.join(opts.engineDir, "src", "main.ts")],
    cwd: opts.engineDir,
    env: {
      ...opts.baseEnv,
      ELECTRON_RUN_AS_NODE: "1",
      ENGINE_PORT: String(opts.port),
      ENGINE_TOKEN: opts.token,
      ENGINE_EXIT_WHEN_PARENT_GONE: "1",
      ENGINE_ALLOWED_ORIGINS: clientOrigin(opts.clientUrl),
    },
  };
}

export async function waitForEngine(info: EngineInfo, timeoutMs = 20000, fetchImpl: typeof fetch = fetch) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`${info.url}/health`, {
        headers: { "x-engine-token": info.token },
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return;
    } catch {
      // engine not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The engine did not start in time.");
}
