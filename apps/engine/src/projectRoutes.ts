import type { FastifyInstance, FastifyReply } from "fastify";
import {
  CommandsRequestSchema,
  CreateProjectRequestSchema,
  OpenProjectRequestSchema,
  type ApiError,
} from "@ve/schema";
import { StoreError } from "./projectStore.js";
import type { RecentProjects } from "./recent.js";
import { ProjectSession, SessionError } from "./session.js";

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

const STORE_STATUS = { ALREADY_EXISTS: 409, NOT_FOUND: 404, CORRUPT: 422 } as const;

function sendFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof StoreError) {
    return reply.code(STORE_STATUS[error.code]).send(apiError(error.code, error.message));
  }
  if (error instanceof SessionError) {
    const status = error.code === "NO_PROJECT" ? 409 : 400;
    return reply.code(status).send(apiError(error.code, error.message));
  }
  throw error;
}

export function registerProjectRoutes(
  app: FastifyInstance,
  session: ProjectSession,
  recent: RecentProjects,
) {
  const invalid = (reply: FastifyReply, message: string) =>
    reply.code(400).send(apiError("INVALID_REQUEST", message));

  app.get("/projects/recent", async () => ({ projects: await recent.list() }));

  app.get("/project", async (_req, reply) => {
    const open = session.open;
    return open ?? reply.code(404).send(apiError("NO_PROJECT", "No project is open."));
  });

  app.post("/project/create", async (req, reply) => {
    const parsed = CreateProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, "Invalid project settings.");
    try {
      return await session.create(parsed.data);
    } catch (e) {
      return sendFailure(reply, e);
    }
  });

  app.post("/project/open", async (req, reply) => {
    const parsed = OpenProjectRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, "A project folder is required.");
    try {
      return await session.openFolder(parsed.data.folder);
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
    return { ok: true };
  });
}
