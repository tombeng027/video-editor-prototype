import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { TOKEN_HEADER, TOKEN_QUERY, type ApiError, type HealthResponse } from "@ve/schema";
import type { EngineConfig } from "./config.js";
import { defaultProbes, type Probes } from "./probes.js";
import { registerProjectRoutes } from "./projectRoutes.js";
import { RecentProjects } from "./recent.js";
import { ProjectSession } from "./session.js";

function tokensMatch(expected: string, provided: unknown): boolean {
  if (typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

export async function buildApp(
  config: EngineConfig,
  probes: Probes = defaultProbes,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.allowedOrigins.includes(origin)),
    allowedHeaders: ["content-type", TOKEN_HEADER],
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      return reply.code(403).send(apiError("FORBIDDEN_ORIGIN", "Origin is not allowed."));
    }
    const query = request.query as Record<string, unknown>;
    const provided = request.headers[TOKEN_HEADER] ?? query[TOKEN_QUERY];
    if (!tokensMatch(config.token, provided)) {
      return reply.code(401).send(apiError("UNAUTHORIZED", "Missing or invalid engine token."));
    }
  });

  app.get("/health", async (): Promise<HealthResponse> => {
    const components = await Promise.all([
      probes.ffmpeg(config),
      probes.ollama(config),
      probes.vision(config),
    ]);
    return {
      ok: true,
      version: config.version,
      components: [{ name: "engine", status: "ok" }, ...components],
    };
  });

  const recent = new RecentProjects(path.join(config.dataDir, "recent.json"));
  registerProjectRoutes(app, new ProjectSession(recent), recent);

  return app;
}
