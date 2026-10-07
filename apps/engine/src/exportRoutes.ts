import type { FastifyInstance } from "fastify";
import type { ApiError } from "@ve/schema";
import { ExportError, findOfflineAssets, type Exporter } from "./exporter.js";
import { SessionError, type ProjectSession } from "./session.js";

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

const EXPORT_STATUS = {
  EMPTY_TIMELINE: 422,
  OFFLINE_MEDIA: 422,
  TOO_MANY_CUTS: 422,
  MISSING_ASSET: 422,
  EXPORT_BUSY: 409,
} as const;

export function registerExportRoutes(app: FastifyInstance, session: ProjectSession, exporter: Exporter) {
  // K7: report source files that are gone so the UI can flag them and export can refuse.
  app.get("/project/media-status", async (_req, reply) => {
    const open = session.open;
    if (!open) return reply.code(409).send(apiError("NO_PROJECT", "No project is open."));
    return { offline: await findOfflineAssets(open.folder, open.project) };
  });

  app.get("/project/export", async () => exporter.state);

  app.post("/project/export", async (_req, reply) => {
    try {
      return reply.code(202).send(await exporter.start());
    } catch (e) {
      if (e instanceof ExportError) return reply.code(EXPORT_STATUS[e.code]).send(apiError(e.code, e.message));
      if (e instanceof SessionError) return reply.code(409).send(apiError(e.code, e.message));
      throw e;
    }
  });

  app.post("/project/export/cancel", async () => exporter.cancel());
}
