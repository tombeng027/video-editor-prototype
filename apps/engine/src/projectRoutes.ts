import { mkdir } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CommandsRequestSchema,
  CloseProjectRequestSchema,
  CreateProjectRequestSchema,
  OpenProjectRequestSchema,
  type ApiError,
  type ProjectOperation,
  type ProjectResponse,
} from "@ve/schema";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StoreError } from "./projectStore.js";
import { RecentError, type RecentProjects } from "./recent.js";
import { ProjectSession, SessionError } from "./session.js";
import { reportDiagnostic } from "./diagnostics.js";

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

const STORE_STATUS = { ALREADY_EXISTS: 409, NOT_FOUND: 404, CORRUPT: 422, STORE_IO_FAILED: 500, SAVE_FAILED: 500, SAVE_CLEANUP_FAILED: 500 } as const;

function sendFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof StoreError) {
    return reply.code(STORE_STATUS[error.code]).send(apiError(error.code, error.message));
  }
  if (error instanceof SessionError) {
    const status = error.code === "INVALID_PATH" ? 400 : 409;
    return reply.code(status).send(apiError(error.code, error.message));
  }
  if (error instanceof RecentError) return reply.code(500).send(apiError(error.code, error.message));
  throw error;
}

export type ProjectHooks = { onOpened: () => Promise<void>; onClosed: () => Promise<void> };

export function registerProjectRoutes(
  app: FastifyInstance,
  session: ProjectSession,
  recent: RecentProjects,
  hooks: ProjectHooks,
  projectsDir: string,
) {
  const operations = new Map<string, { status: ProjectOperation; version?: number }>();
  let opening = false;
  const begin = (attemptId: string, reply: FastifyReply) => {
    if (opening) {
      reply.code(409).send(apiError("PROJECT_OPERATION_BUSY", "A project create/open operation is still settling. Check its status before another operation."));
      return false;
    }
    if (operations.has(attemptId)) {
      reply.code(409).send(apiError("ATTEMPT_EXISTS", "This project attempt was already submitted. Check its status instead of submitting again."));
      return false;
    }
    if (operations.size >= 16) operations.delete(operations.keys().next().value!);
    operations.set(attemptId, { status: { state: "pending", attemptId } });
    opening = true;
    return true;
  };
  const complete = async (attemptId: string, task: () => Promise<ProjectResponse>, reply: FastifyReply) => {
    try {
      const opened = await task();
      const version = session.version;
      let response = opened;
      try { await hooks.onOpened(); }
      catch (error) {
        const diagnosticId = reportDiagnostic("PROJECT_PREPARATION_FAILED", error, { route: "project preparation" });
        response = { ...opened, warnings: [...(opened.warnings ?? []), {
          code: "PROJECT_PREPARATION_FAILED",
          message: `The project was committed, but background cleanup/proxy preparation failed. Do not recreate it. Close and reopen after checking engine diagnostics; preview may be unavailable. Diagnostic ID: ${diagnosticId}`,
        }] };
      }
      session.assertVersion(version);
      const active = session.open;
      if (!active) throw new SessionError("PROJECT_CHANGED", "The completed project is no longer open.");
      response = { ...active, warnings: response.warnings };
      operations.set(attemptId, { status: { state: "done", attemptId, response }, version });
      return response;
    } catch (error) {
      const failure: ApiError["error"] = error instanceof StoreError || error instanceof SessionError || error instanceof RecentError
        ? { code: error.code, message: error.message }
        : { code: "PROJECT_OPERATION_FAILED", message: "Project create/open failed. Check engine diagnostics before retrying.",
          diagnosticId: reportDiagnostic("PROJECT_OPERATION_FAILED", error, { route: "project create/open" }) };
      operations.set(attemptId, { status: { state: "failed", attemptId, error: failure } });
      if (failure.code === "PROJECT_OPERATION_FAILED") {
        return reply.code(500).send({ error: failure } satisfies ApiError);
      }
      return sendFailure(reply, error);
    } finally { opening = false; }
  };
  const invalid = (reply: FastifyReply, message: string) =>
    reply.code(400).send(apiError("INVALID_REQUEST", message));

  app.get<{ Params: { attemptId: string } }>("/project/operations/:attemptId", async (req, reply) => {
    if (!z.uuid().safeParse(req.params.attemptId).success) return invalid(reply, "Invalid project attempt.");
    const operation = operations.get(req.params.attemptId);
    if (!operation) return reply.code(404).send(apiError("OPERATION_UNKNOWN", "This attempt is not recorded. It may not have arrived, been evicted, or the engine restarted. Do not assume retry is safe."));
    if (operation.version !== undefined) {
      try { session.assertVersion(operation.version); }
      catch (error) { return sendFailure(reply, error); }
    }
    if (operation.status.state === "done") {
      const active = session.open;
      if (!active) return reply.code(409).send(apiError("PROJECT_CHANGED", "The completed project is no longer open."));
      return { ...operation.status, response: { ...active, warnings: operation.status.response.warnings } };
    }
    return operation.status;
  });

  app.get("/projects/default-folder", async (_req, reply) => {
    try {
      await mkdir(projectsDir, { recursive: true });
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "EACCES" || code === "EPERM" || code === "EEXIST" || code === "ENOTDIR" || code === "ENOENT" || code === "EROFS") {
        return reply.code(422).send(apiError("PROJECT_LOCATION_UNAVAILABLE",
          `The default project folder cannot be created (${code}). Choose a writable folder in Location or set PROJECTS_DIR to an accessible directory.`));
      }
      throw error;
    }
    return { folder: projectsDir };
  });

  app.get("/projects/recent", async (_req, reply) => {
    try { return { projects: await recent.list() }; }
    catch (error) { return sendFailure(reply, error); }
  });

  app.get("/project", async (_req, reply) => {
    const open = session.open;
    return open ?? reply.code(404).send(apiError("NO_PROJECT", "No project is open."));
  });

  app.post("/project/create", async (req, reply) => {
    const parsed = CreateProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, "Invalid project settings.");
    const attemptId = parsed.data.attemptId ?? randomUUID();
    if (!begin(attemptId, reply)) return reply;
    return complete(attemptId, () => session.create(parsed.data), reply);
  });

  app.post("/project/open", async (req, reply) => {
    const parsed = OpenProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, "A project folder is required.");
    const attemptId = parsed.data.attemptId ?? randomUUID();
    if (!begin(attemptId, reply)) return reply;
    return complete(attemptId, () => session.openFolder(parsed.data.folder), reply);
  });

  app.post("/project/commands", async (req, reply) => {
    const parsed = CommandsRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, "Invalid command list.");
    try {
      const outcome = await session.apply(parsed.data.commands);
      if (!outcome.ok) return reply.code(422).send({ error: outcome.error });
      return { project: outcome.project, inverse: outcome.inverse };
    } catch (e) {
      return sendFailure(reply, e);
    }
  });

  app.post("/project/save", async (_req, reply) => {
    try {
      await session.save();
      return { ok: true };
    } catch (e) {
      return sendFailure(reply, e);
    }
  });

  app.post("/project/close", async (req, reply) => {
    const parsed = CloseProjectRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) return invalid(reply, "Invalid expected project for close.");
    try {
      await session.close(parsed.data.expectedProject);
      await hooks.onClosed();
      return { ok: true };
    } catch (error) {
      return sendFailure(reply, error);
    }
  });
}
