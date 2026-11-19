import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ErrorContextSchema, UnknownErrorRecordSchema, VERIFIED_ERROR_RESOLUTIONS,
  errorFingerprint, findErrorDefinition, type ErrorContext, type UnknownErrorRecord,
} from "@ve/schema";

const RecordsSchema = z.array(UnknownErrorRecordSchema).max(100).superRefine((records, ctx) => {
  const fingerprints = new Set<string>();
  for (const record of records) {
    if (record.fingerprint !== errorFingerprint(record) || fingerprints.has(record.fingerprint)) {
      ctx.addIssue({ code: "custom", message: "Invalid or duplicate unknown-error fingerprint." });
    }
    fingerprints.add(record.fingerprint);
  }
});

export class UnknownErrorInbox {
  private readonly file: string;
  constructor(private readonly dataDir: string, private readonly version: string,
    private readonly resolved: readonly string[] = VERIFIED_ERROR_RESOLUTIONS) {
    this.file = path.join(dataDir, "unknown-edit-errors.json");
  }

  private read(): UnknownErrorRecord[] {
    try {
      const info = lstatSync(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024) {
        throw new Error("Unknown-error inbox is not a regular bounded file.");
      }
      return RecordsSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  private write(records: UnknownErrorRecord[]): void {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const info = lstatSync(this.dataDir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unknown-error inbox directory is not a regular directory.");
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const file = openSync(temporary, "wx", 0o600);
    try {
      try { writeFileSync(file, JSON.stringify(records, null, 2), "utf8"); }
      finally { closeSync(file); }
      renameSync(temporary, this.file);
    }
    catch (error) {
      try { unlinkSync(temporary); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], "Unknown-error inbox write and cleanup failed.", { cause: cleanupError }); }
      throw error;
    }
  }

  list() {
    const records = this.read();
    const remaining = records.filter((record) =>
      !(this.resolved.includes(record.fingerprint) && findErrorDefinition(record)));
    if (remaining.length !== records.length) this.write(remaining);
    return { records: remaining, capacityReached: remaining.length >= 100 };
  }

  record(input: ErrorContext) {
    const context = ErrorContextSchema.parse(input);
    const current = this.list();
    if (findErrorDefinition(context)) return current;
    const fingerprint = errorFingerprint(context);
    const index = current.records.findIndex((record) => record.fingerprint === fingerprint);
    if (index < 0 && current.capacityReached) return null;
    const now = new Date().toISOString();
    const previous = current.records[index];
    const record = UnknownErrorRecordSchema.parse({
      ...context, fingerprint, appVersion: this.version,
      ...(!context.diagnosticId && previous?.diagnosticId ? { diagnosticId: previous.diagnosticId } : {}),
      firstSeen: previous?.firstSeen ?? now, lastSeen: now,
      count: Math.min(Number.MAX_SAFE_INTEGER, (previous?.count ?? 0) + 1),
      task: "pending-catalog-update",
    });
    const records = [...current.records];
    if (index < 0) records.push(record);
    else records[index] = record;
    this.write(records);
    return { records, capacityReached: records.length >= 100 };
  }
}

export function registerUnknownErrorRoutes(app: FastifyInstance, dataDir: string, version: string) {
  const inbox = new UnknownErrorInbox(dataDir, version);
  app.get("/diagnostics/unknown-edits", async () => inbox.list());
  app.post("/diagnostics/unknown-edits", async (req, reply) => {
    const parsed = ErrorContextSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: {
      code: "INVALID_REQUEST", message: "Only a sanitized error context can be recorded.",
    } });
    const result = inbox.record(parsed.data);
    if (!result) return reply.code(409).send({ error: {
      code: "ERROR_INBOX_FULL", message: "The unknown-error inbox has 100 pending development tasks. Resolve catalog tasks before recording new groups.",
    } });
    return result;
  });
}
