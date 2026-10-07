import {
  CommandsResponseSchema,
  ProjectResponseSchema,
  RecentProjectsResponseSchema,
  TOKEN_HEADER,
  type Command,
  type CommandsResponse,
  type CreateProjectRequest,
  type ProjectResponse,
  type RecentProject,
} from "@ve/schema";
import { z, type ZodType } from "zod";
import type { EngineConfig } from "./engine.js";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

async function call<T>(
  config: EngineConfig,
  method: "GET" | "POST",
  path: string,
  schema: ZodType<T>,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<T>> {
  try {
    const res = await fetchImpl(`${config.url}${path}`, {
      method,
      headers: {
        [TOKEN_HEADER]: config.token,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      return { ok: false, code: err?.code ?? `HTTP_${res.status}`, message: err?.message ?? `Engine returned HTTP ${res.status}.` };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) return { ok: false, code: "BAD_RESPONSE", message: "Engine sent an unexpected response." };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, code: "UNREACHABLE", message: "Cannot reach the engine. Is it running?" };
  }
}

export const createProject = (c: EngineConfig, req: CreateProjectRequest, f?: typeof fetch) =>
  call<ProjectResponse>(c, "POST", "/project/create", ProjectResponseSchema, req, f);

export const openProject = (c: EngineConfig, folder: string, f?: typeof fetch) =>
  call<ProjectResponse>(c, "POST", "/project/open", ProjectResponseSchema, { folder }, f);

export const sendCommands = (c: EngineConfig, commands: Command[], f?: typeof fetch) =>
  call<CommandsResponse>(c, "POST", "/project/commands", CommandsResponseSchema, { commands }, f);

export async function listRecent(c: EngineConfig, f?: typeof fetch): Promise<RecentProject[]> {
  const result = await call(c, "GET", "/projects/recent", RecentProjectsResponseSchema, undefined, f);
  return result.ok ? result.data.projects : [];
}

export async function closeProject(c: EngineConfig, f?: typeof fetch): Promise<void> {
  await call(c, "POST", "/project/close", z.object({ ok: z.boolean() }), {}, f);
}
