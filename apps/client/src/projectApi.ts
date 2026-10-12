import {
  CommandsResponseSchema,
  DefaultFolderResponseSchema,
  ExportStateSchema,
  ImportResponseSchema,
  MediaStatusResponseSchema,
  ProjectResponseSchema,
  RecentProjectsResponseSchema,
  TOKEN_HEADER,
  type Command,
  type CommandsResponse,
  type CloseProjectRequest,
  type CreateProjectRequest,
  type ExportState,
  type ImportRequest,
  type ImportResponse,
  type MediaStatusResponse,
  type ProjectResponse,
} from "@ve/schema";
import { z, type ZodType } from "zod";
import type { EngineConfig } from "./engine.js";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
export const RECOVERY_TIMEOUT_MS = 15000;

async function call<T>(
  config: EngineConfig,
  method: "GET" | "POST",
  path: string,
  schema: ZodType<T>,
  body?: unknown,
  fetchImpl: typeof fetch = fetch,
  timeoutMs?: number,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = async (): Promise<ApiResult<T>> => {
      const res = await fetchImpl(`${config.url}${path}`, {
        method,
        headers: {
          [TOKEN_HEADER]: config.token,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
        return { ok: false, code: err?.code ?? `HTTP_${res.status}`, message: err?.message ?? `Engine returned HTTP ${res.status}.` };
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) return { ok: false, code: "BAD_RESPONSE", message: "Engine sent an unexpected response." };
      return { ok: true, data: parsed.data };
    };
    if (timeoutMs === undefined) return await request();
    const timeout = new Promise<ApiResult<T>>((resolve) => {
      timer = setTimeout(() => {
        resolve({ ok: false, code: "REQUEST_TIMEOUT",
          message: "The engine response timed out. The operation may still be running; check authoritative state before retrying." });
        controller.abort();
      }, timeoutMs);
    });
    return await Promise.race([request(), timeout]);
  } catch {
    return { ok: false, code: "UNREACHABLE", message: "Cannot reach the engine. Is it running?" };
  } finally {
    clearTimeout(timer);
  }
}

export const createProject = (c: EngineConfig, req: CreateProjectRequest, f?: typeof fetch) =>
  call<ProjectResponse>(c, "POST", "/project/create", ProjectResponseSchema, req, f);

export const openProject = (c: EngineConfig, folder: string, f?: typeof fetch) =>
  call<ProjectResponse>(c, "POST", "/project/open", ProjectResponseSchema, { folder }, f);

export const sendCommands = (c: EngineConfig, commands: Command[], f?: typeof fetch) =>
  call<CommandsResponse>(c, "POST", "/project/commands", CommandsResponseSchema, { commands }, f);

export const listRecent = (c: EngineConfig, f?: typeof fetch) =>
  call(c, "GET", "/projects/recent", RecentProjectsResponseSchema, undefined, f);

export const closeProject = (c: EngineConfig, expectedProject?: CloseProjectRequest["expectedProject"], f?: typeof fetch) =>
  call(c, "POST", "/project/close", z.object({ ok: z.literal(true) }), { expectedProject }, f, RECOVERY_TIMEOUT_MS);

export const importFiles = (c: EngineConfig, req: ImportRequest, f?: typeof fetch) =>
  call<ImportResponse>(c, "POST", "/project/import", ImportResponseSchema, req, f);

export const getProject = (c: EngineConfig, f?: typeof fetch) =>
  call<ProjectResponse>(c, "GET", "/project", ProjectResponseSchema, undefined, f, RECOVERY_TIMEOUT_MS);

export const getMediaStatus = (c: EngineConfig, f?: typeof fetch) =>
  call<MediaStatusResponse>(c, "GET", "/project/media-status", MediaStatusResponseSchema, undefined, f);

export const getExport = (c: EngineConfig, f?: typeof fetch) =>
  call<ExportState>(c, "GET", "/project/export", ExportStateSchema, undefined, f, RECOVERY_TIMEOUT_MS);

export const startExport = (c: EngineConfig, f?: typeof fetch) =>
  call<ExportState>(c, "POST", "/project/export", ExportStateSchema, {}, f);

export const cancelExport = (c: EngineConfig, f?: typeof fetch) =>
  call<ExportState>(c, "POST", "/project/export/cancel", ExportStateSchema, {}, f, RECOVERY_TIMEOUT_MS);

export const getDefaultFolder = (c: EngineConfig, f?: typeof fetch) =>
  call(c, "GET", "/projects/default-folder", DefaultFolderResponseSchema, undefined, f);
