import { createReadStream } from "node:fs";
import type { OutgoingHttpHeaders } from "node:http";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ImportRequestSchema, type ApiError, type ProxyState } from "@ve/schema";
import { Importer } from "./importer.js";
import type { ProxyManager } from "./proxy.js";
import { SessionError, type ProjectSession } from "./session.js";

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
  app.post("/project/import", async (req, reply) => {
    const parsed = ImportRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(apiError("INVALID_REQUEST", "Provide 1-50 absolute file paths and a mode."));
    try {
      return await importer.importFiles(parsed.data);
    } catch (e) {
      if (e instanceof SessionError) return reply.code(409).send(apiError(e.code, e.message));
      throw e;
    }
  });

  app.get("/project/proxies", async () => ({ proxies: proxies.list() }));

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
    for (const state of proxies.list()) send(state);
    const unsubscribe = proxies.subscribe(send);
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
}