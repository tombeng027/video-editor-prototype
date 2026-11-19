import { createReadStream } from "node:fs";
import type { OutgoingHttpHeaders } from "node:http";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { ImportRequestSchema, PreviewJobRequestSchema, type ApiError, type ImportOperation, type ProxyState } from "@ve/schema";
import { z } from "zod";
import { Importer, ImportError, resolveAssetPath } from "./importer.js";
import type { ProxyManager } from "./proxy.js";
import { SessionError, type ProjectSession } from "./session.js";
import { reportDiagnostic } from "./diagnostics.js";
import { MediaError } from "./media.js";

const apiError = (code: string, message: string): ApiError => ({ error: { code, message } });

export type ByteRange = { start: number; end: number };

/** Parses a single `bytes=a-b` range. Returns null when absent, "invalid" when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

export function registerMediaRoutes(
  app: FastifyInstance,
  session: ProjectSession,
  importer: Importer,
  proxies: ProxyManager,
) {
  const operations = new Map<string, { status: ImportOperation; version: number }>();
  const invalid = (reply: FastifyReply, message: string) =>
    reply.code(400).send(apiError("INVALID_REQUEST", message));

  app.post("/project/import", async (req, reply) => {
    const parsed = ImportRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(apiError("INVALID_REQUEST", "Provide 1-50 absolute file paths and a mode."));
    const attemptId = parsed.data.attemptId ?? randomUUID();
    if (operations.has(attemptId)) {
      return reply.code(409).send(apiError("ATTEMPT_EXISTS", "This import attempt was already submitted. Check its status instead of resubmitting."));
    }
    if ([...operations.values()].some(({ status }) => status.state === "pending")) {
      return reply.code(409).send(apiError("IMPORT_OPERATION_BUSY", "An import is still settling. Check its status before starting another import."));
    }
    if (operations.size >= 16) operations.delete(operations.keys().next().value!);
    const version = session.version;
    const operation = { status: { state: "pending", attemptId } as ImportOperation, version };
    operations.set(attemptId, operation);
    try {
      const imported = await importer.importFiles(parsed.data, (response) => {
        operation.status = { state: "done", attemptId, response };
      });
      session.assertVersion(version);
      const active = session.open;
      if (!active) throw new SessionError("NO_PROJECT", "No project is open.");
      const response = { ...imported, project: active.project };
      operation.status = { state: "done", attemptId, response };
      return response;
    } catch (e) {
      if (operation.status.state !== "done") {
        if (e instanceof SessionError) {
          operation.status = { state: "failed", attemptId, error: { code: e.code, message: e.message } };
        } else if (e instanceof ImportError) {
          operation.status = { state: "failed", attemptId, error: { code: e.code, message: e.message } };
        } else {
          const diagnosticId = reportDiagnostic("ENGINE_UNEXPECTED_ERROR", e, { method: "POST", route: "/project/import" });
          const error = {
            code: "IMPORT_OUTCOME_UNKNOWN",
            message: "Import outcome is unconfirmed. Check the current project and operation status before retrying.",
            diagnosticId,
          };
          operation.status = { state: "unknown", attemptId, error };
          return reply.code(500).send({ error } satisfies ApiError);
        }
      }
      if (e instanceof SessionError) return reply.code(409).send(apiError(e.code, e.message));
      if (e instanceof ImportError) return reply.code(500).send(apiError(e.code, e.message));
      throw e;
    }
  });

  app.get<{ Params: { attemptId: string } }>("/project/imports/:attemptId", async (req, reply) => {
    if (!z.uuid().safeParse(req.params.attemptId).success) {
      return invalid(reply, "Invalid import attempt.");
    }
    const operation = operations.get(req.params.attemptId);
    if (!operation) {
      return reply.code(404).send(apiError("IMPORT_RECEIPT_MISSING",
        "This import attempt is not recorded. It may not have arrived, been evicted, or the engine restarted; inspect the current project before retrying."));
    }
    try { session.assertVersion(operation.version); }
    catch (error) {
      if (error instanceof SessionError) return reply.code(409).send(apiError(error.code, error.message));
      throw error;
    }
    if (operation.status.state === "done") {
      const active = session.open;
      if (!active) return reply.code(409).send(apiError("NO_PROJECT", "No project is open."));
      return { ...operation.status, response: { ...operation.status.response, project: active.project } };
    }
    return operation.status;
  });

  app.get("/project/proxies", async () => ({ proxies: proxies.list() }));
  app.post("/project/preview-jobs", async (req, reply) => {
    const parsed = PreviewJobRequestSchema.safeParse(req.body);
    if (!parsed.success) return invalid(reply, "Provide an asset, prepare/cancel action and expected project.");
    const { assetId, action, expectedProject } = parsed.data;
    const version = session.version;
    const open = session.open;
    if (!open || !path.isAbsolute(expectedProject.folder) || open.project.id !== expectedProject.id || open.folder !== path.resolve(expectedProject.folder)) {
      return reply.code(409).send(apiError("PROJECT_CHANGED", "The active project changed. Refresh its status before preparing media."));
    }
    if (!open.project.assets.some((asset) => asset.id === assetId && asset.kind === "video")) {
      return reply.code(404).send(apiError("NOT_FOUND", "Video asset not found."));
    }
    try {
      if (action === "cancel") await proxies.cancel(assetId);
      else await importer.prepareProxy(assetId, version);
      session.assertVersion(version);
      return { proxies: proxies.list() };
    } catch (error) {
      if (error instanceof SessionError) return reply.code(409).send(apiError(error.code, error.message));
      if (error instanceof MediaError) return reply.code(422).send(apiError(error.code, error.message));
      throw error;
    }
  });

  // Server-sent events; the token travels in the query string because EventSource cannot set headers.
  app.get("/project/events", (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as OutgoingHttpHeaders),
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (state: ProxyState) => reply.raw.write(`event: proxy\ndata: ${JSON.stringify(state)}\n\n`);
    reply.raw.write(": connected\n\n");
    const unsubscribe = proxies.subscribe(send);
    for (const state of proxies.list()) send(state);
    const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get<{ Params: { assetId: string } }>("/media/:assetId/proxy", async (req, reply: FastifyReply) => {
    const open = session.open;
    const asset = open?.project.assets.find((a) => a.id === req.params.assetId);
    if (!open || !asset?.proxyPath) return reply.code(404).send(apiError("NOT_FOUND", "No proxy is available for this asset."));
    const file = path.resolve(open.folder, asset.proxyPath);
    if (path.relative(open.folder, file).startsWith("..")) return reply.code(404).send(apiError("NOT_FOUND", "No proxy is available."));
    const size = await stat(file).then((s) => s.size, () => -1);
    if (size < 0) return reply.code(404).send(apiError("NOT_FOUND", "The proxy file is missing."));

    const range = parseRange(req.headers.range, size);
    reply.header("accept-ranges", "bytes").header("content-type", "video/mp4").header("cache-control", "no-store");
    if (range === "invalid") return reply.code(416).header("content-range", `bytes */${size}`).send();
    if (!range) return reply.header("content-length", size).send(createReadStream(file));
    return reply
      .code(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${size}`)
      .header("content-length", range.end - range.start + 1)
      .send(createReadStream(file, { start: range.start, end: range.end }));
  });

  app.get<{ Params: { assetId: string } }>("/media/:assetId/source", async (req, reply: FastifyReply) => {
    const open = session.open;
    const asset = open?.project.assets.find((a) => a.id === req.params.assetId);
    if (!open || !asset) {
      return reply.code(404).send(apiError("NOT_FOUND", "No playable source is available for this asset."));
    }
    const contentTypes: Record<string, string> = {
      ".aac": "audio/aac",
      ".bmp": "image/bmp",
      ".flac": "audio/flac",
      ".gif": "image/gif",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".m4a": "audio/mp4",
      ".mp3": "audio/mpeg",
      ".mp4": "video/mp4",
      ".m4v": "video/mp4",
      ".mov": "video/quicktime",
      ".mkv": "video/x-matroska",
      ".avi": "video/x-msvideo",
      ".mts": "video/mp2t",
      ".m2ts": "video/mp2t",
      ".oga": "audio/ogg",
      ".ogg": "audio/ogg",
      ".opus": "audio/ogg",
      ".png": "image/png",
      ".tif": "image/tiff",
      ".tiff": "image/tiff",
      ".wav": "audio/wav",
      ".webp": "image/webp",
      ".webm": "video/webm",
    };
    const file = resolveAssetPath(open.folder, asset);
    const size = await stat(file).then((s) => s.size, () => -1);
    const contentType = contentTypes[path.extname(file).toLowerCase()] ?? (asset.kind === "video" ? "application/octet-stream" : undefined);
    if (size < 0 || !contentType) return reply.code(404).send(apiError("NOT_FOUND", "The media source is missing or unsupported."));
    const range = parseRange(req.headers.range, size);
    reply.header("accept-ranges", "bytes").header("content-type", contentType).header("cache-control", "no-store");
    if (range === "invalid") return reply.code(416).header("content-range", `bytes */${size}`).send();
    if (!range) return reply.header("content-length", size).send(createReadStream(file));
    return reply
      .code(206)
      .header("content-range", `bytes ${range.start}-${range.end}/${size}`)
      .header("content-length", range.end - range.start + 1)
      .send(createReadStream(file, { start: range.start, end: range.end }));
  });
}