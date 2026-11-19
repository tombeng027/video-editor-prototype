import { mkdir } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CommandsRequestSchema,
  CloseProjectRequestSchema,
  CreateProjectRequestSchema,
  OpenProjectRequestSchema,
  type ApiError,
  type ProjectOperation,
  type CommandOperation,
  type ProjectResponse,
} from "@ve/schema";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StoreError } from "./projectStore.js";
import { RecentError, type RecentProjects } from "./recent.js";
import { ProjectSession, SessionError } from "./session.js";
import { reportDiagnostic } from "./diagnostics.js";

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

const STORE_STATUS = { ALREADY_EXISTS: 409, NOT_FOUND: 404, CORRUPT: 422, UNSUPPORTED_PROJECT_VERSION: 422, STORE_IO_FAILED: 500, SAVE_FAILED: 500, SAVE_CLEANUP_FAILED: 500 } as const;

function sendFailure(reply: FastifyReply, error: unknown, notApplied = false) {
  const failure = (code: string, message: string): ApiError => ({
    ...apiError(code, message), ...(notApplied ? { outcome: "not-applied" as const } : {}),
  });
  if (error instanceof StoreError) {
    return reply.code(STORE_STATUS[error.code]).send(failure(error.code, error.message));
  }
  if (error instanceof SessionError) {
    const status = error.code === "INVALID_PATH" ? 400 : 409;
    return reply.code(status).send(failure(error.code, error.message));
  }
  if (error instanceof RecentError) return reply.code(500).send(apiError(error.code, error.message));
  throw error;
}

export type ProjectHooks = { onOpened: () => Promise<void>; onClosed: () => Promise<void>; onRelinked?: () => Promise<void> };

export function registerProjectRoutes(
  app: FastifyInstance,
  session: ProjectSession,
  recent: RecentProjects,
  hooks: ProjectHooks,
  projectsDir: string,
) {
  const operations = new Map<string, { status: ProjectOperation; version?: number }>();
  const commandOperations = new Map<string, { status: CommandOperation; version: number }>();
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
    const reject = (status: number, code: string, message: string) =>
      reply.code(status).send({ ...apiError(code, message), outcome: "not-applied" } satisfies ApiError);
    const parsed = CommandsRequestSchema.safeParse(req.body);
    if (!parsed.success) return reject(400, "INVALID_REQUEST", "Invalid command list.");
    if (!session.open) return reject(404, "NO_PROJECT", "No project is open.");
    const attemptId = parsed.data.attemptId ?? randomUUID();
    if (commandOperations.has(attemptId)) {
      return reply.code(409).send(apiError("ATTEMPT_EXISTS", "This command attempt was already submitted. Check its status instead of resubmitting."));
    }
    const pending = [...commandOperations.values()].filter(({ status }) => status.state === "pending").length;
    if (pending >= 16) {
      return reject(409, "COMMAND_OPERATION_BUSY", "Too many command operations are still settling. Check their status before submitting more.");
    }
    if (commandOperations.size >= 16) {
      const evictable = [...commandOperations].find(([, operation]) => operation.status.state !== "pending");
      if (evictable) commandOperations.delete(evictable[0]);
    }
    if (commandOperations.size >= 16) {
      return reject(409, "COMMAND_OPERATION_BUSY", "Command recovery records are full. Check pending operation status before submitting more.");
    }
    const version = session.version;
    const operation = { status: { state: "pending", attemptId } as CommandOperation, version };
    commandOperations.set(attemptId, operation);
    try {
      const outcome = await session.apply(parsed.data.commands, version);
      if (!outcome.ok) {
        operation.status = { state: "failed", attemptId, error: outcome.error };
        return reply.code(422).send({ error: outcome.error, outcome: "not-applied" } satisfies ApiError);
      }
      const response = { project: outcome.project, inverse: outcome.inverse };
      operation.status = { state: "done", attemptId, response };
      if (parsed.data.commands.some((command) => command.type === "RelinkAsset")) {
        try { await hooks.onRelinked?.(); }
        catch (error) {
          reportDiagnostic("PROJECT_PREPARATION_FAILED", error, { method: "POST", route: "/project/commands" });
          throw error;
        }
      }
      return response;
    } catch (e) {
      if (operation.status.state === "done") throw e;
      if (e instanceof SessionError || e instanceof StoreError) {
        operation.status = { state: "failed", attemptId, error: { code: e.code, message: e.message } };
        return sendFailure(reply, e, true);
      }
      const error: ApiError["error"] = {
        code: "ENGINE_UNEXPECTED_ERROR",
        message: "Command outcome is unconfirmed. Check operation status before retrying.",
        diagnosticId: reportDiagnostic("ENGINE_UNEXPECTED_ERROR", e, { method: "POST", route: "/project/commands" }),
      };
      operation.status = { state: "unknown", attemptId, error };
      return reply.code(500).send({ error } satisfies ApiError);
    }
  });

  app.get<{ Params: { attemptId: string } }>("/project/command-operations/:attemptId", async (req, reply) => {
    if (!z.uuid().safeParse(req.params.attemptId).success) return invalid(reply, "Invalid command attempt.");
    const operation = commandOperations.get(req.params.attemptId);
    if (!operation) {
      return reply.code(404).send(apiError("OPERATION_UNKNOWN",
        "This command attempt is not recorded. It may not have arrived, been evicted, or the engine restarted; refresh project state before retrying."));
    }
    try { session.assertVersion(operation.version); }
    catch (error) {
      if (error instanceof SessionError) return sendFailure(reply, error);
      throw error;
    }
    if (operation.status.state === "done") {
      const active = session.open;
      if (!active) return reply.code(409).send(apiError("NO_PROJECT", "No project is open."));
      return { ...operation.status, response: { ...operation.status.response, project: active.project } };
    }
    return operation.status;
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
