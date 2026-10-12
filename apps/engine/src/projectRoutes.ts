import { mkdir } from "node:fs/promises";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CommandsRequestSchema,
  CreateProjectRequestSchema,
  OpenProjectRequestSchema,
  type ApiError,
} from "@ve/schema";
import { StoreError } from "./projectStore.js";
import { RecentError, type RecentProjects } from "./recent.js";
import { ProjectSession, SessionError } from "./session.js";

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
  const invalid = (reply: FastifyReply, message: string) =>
    reply.code(400).send(apiError("INVALID_REQUEST", message));

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
    try {
      const created = await session.create(parsed.data);
      await hooks.onOpened();
      return created;
    } catch (e) {
      return sendFailure(reply, e);
    }
  });

  app.post("/project/open", async (req, reply) => {
    const parsed = OpenProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, "A project folder is required.");
    try {
      const opened = await session.openFolder(parsed.data.folder);
      await hooks.onOpened();
      return opened;
    } catch (e) {
      return sendFailure(reply, e);
    }
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

  app.post("/project/close", async () => {
    await session.close();
    await hooks.onClosed();
    return { ok: true };
  });
}
