import type { FastifyInstance } from "fastify";
import { StartExportRequestSchema, type ApiError } from "@ve/schema";
import { ExportError, findOfflineAssets, type Exporter } from "./exporter.js";
import { SessionError, type ProjectSession } from "./session.js";

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

const EXPORT_STATUS = {
  EMPTY_TIMELINE: 422,
  OFFLINE_MEDIA: 422,
  TOO_MANY_CUTS: 422,
  MISSING_ASSET: 422,
  EXPORT_BUSY: 409,
  EXPORT_CANCELLED: 409,
  INVALID_EXPORT_SETTINGS: 422,
} as const;

export function registerExportRoutes(
  app: FastifyInstance,
  session: ProjectSession,
  exporter: Exporter,
  checkOfflineAssets: typeof findOfflineAssets = findOfflineAssets,
) {
  // K7: report source files that are gone so the UI can flag them and export can refuse.
  app.get("/project/media-status", async (_req, reply) => {
    const open = session.open;
    if (!open) return reply.code(409).send(apiError("NO_PROJECT", "No project is open."));
    const version = session.version;
    const offline = await checkOfflineAssets(open.folder, open.project);
    try {
      session.assertVersion(version);
    } catch (error) {
      if (error instanceof SessionError) return reply.code(409).send(apiError(error.code, error.message));
      throw error;
    }
    const current = session.open;
    if (!current || current.project.id !== open.project.id || current.folder !== open.folder ||
      current.project.updatedAt !== open.project.updatedAt) {
      return reply.code(409).send(apiError("PROJECT_CHANGED", "Project media changed while its status was being checked. Refresh media status."));
    }
    return { projectId: open.project.id, offline };
  });

  app.get("/project/export", async () => exporter.state);

  app.post("/project/export", async (req, reply) => {
    const parsed = StartExportRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const settingsInvalid = parsed.error.issues.some((issue) => issue.path[0] === "settings");
      return reply.code(400).send(apiError(settingsInvalid ? "INVALID_EXPORT_SETTINGS" : "INVALID_REQUEST",
        settingsInvalid ? "Choose supported export frame rate, resolution and quality settings." : "Invalid export attempt."));
    }
    try {
      return reply.code(202).send(await exporter.start(parsed.data.attemptId, parsed.data.settings));
    } catch (e) {
      if (e instanceof ExportError) return reply.code(EXPORT_STATUS[e.code]).send(apiError(e.code, e.message));
      if (e instanceof SessionError) return reply.code(409).send(apiError(e.code, e.message));
      throw e;
    }
  });

  app.post("/project/export/cancel", async () => exporter.cancel());
}
