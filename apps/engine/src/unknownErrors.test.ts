import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDIT_ERROR_DEFINITIONS, errorFingerprint, type ErrorContext, type UnknownErrorRecord } from "@ve/schema";
import { UnknownErrorInbox } from "./unknownErrors.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

let tmp: string;
const context: ErrorContext = { code: "NEW_ERROR", stage: "submit", outcome: "unconfirmed", operation: "clip-speed" };
beforeEach(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), "ve-unknown-errors-")); });
afterEach(async () => { vi.restoreAllMocks(); await rm(tmp, { recursive: true, force: true }); });

describe("unknown edit error inbox", () => {
  it("groups repeats, persists tasks across restarts and ignores catalogued errors", async () => {
    const inbox = new UnknownErrorInbox(tmp, "0.1.0");
    expect(inbox.record(context)?.records[0]).toMatchObject({ count: 1, task: "pending-catalog-update" });
    inbox.record({ ...context, diagnosticId: "00000000-0000-4000-8000-000000000022" });
    const reopened = new UnknownErrorInbox(tmp, "0.1.1");
    expect(reopened.list().records[0]).toMatchObject({ count: 2, appVersion: "0.1.0", operation: "clip-speed" });
    reopened.record({ ...context, code: "TRACK_LOCKED", outcome: "not-applied" });
    expect(reopened.list().records).toHaveLength(1);
    expect(await readdir(tmp)).toEqual(["unknown-edit-errors.json"]);
    const stored = JSON.parse(await readFile(path.join(tmp, "unknown-edit-errors.json"), "utf8"));
    expect(Object.keys(stored[0]).sort()).toEqual([
      "appVersion", "code", "count", "diagnosticId", "fingerprint", "firstSeen", "lastSeen", "operation", "outcome", "stage", "task",
    ]);
  });

  it("removes only explicitly verified matching catalog resolutions, preserving other tasks", async () => {
    const old: UnknownErrorRecord = { ...context, code: "TRACK_LOCKED", outcome: "not-applied",
      fingerprint: "", count: 1, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(),
      appVersion: "0.1.0", task: "pending-catalog-update" };
    old.fingerprint = errorFingerprint(old);
    await writeFile(path.join(tmp, "unknown-edit-errors.json"), JSON.stringify([old]));
    const unresolved = new UnknownErrorInbox(tmp, "0.1.0");
    expect(unresolved.list().records).toHaveLength(1);
    unresolved.record(context);
    const resolved = new UnknownErrorInbox(tmp, "0.1.1", [old.fingerprint, errorFingerprint(context)]);
    expect(resolved.list().records.map((r) => r.code)).toEqual(["NEW_ERROR"]);
    expect(new UnknownErrorInbox(tmp, "0.1.1").list().records).toHaveLength(1);
  });
  it("persists import follow-ups separately from edits while ignoring known import contexts", () => {
    const importing: ErrorContext = { code: "IMPORT_FAILED", stage: "file", outcome: "not-applied", operation: "import" };
    const inbox = new UnknownErrorInbox(tmp, "0.1.0");
    inbox.record(importing);
    inbox.record(importing);
    inbox.record({ ...importing, code: "ALREADY_IMPORTED" });
    inbox.record({ ...importing, stage: "status", outcome: "unconfirmed" });
    inbox.record({ ...importing, operation: "edit", stage: "submit" });
    expect(new UnknownErrorInbox(tmp, "0.1.0").list().records).toHaveLength(3);
    expect(inbox.list().records.find((record) => record.stage === "file")?.count).toBe(2);
    expect(inbox.list().records.every((record) => record.task === "pending-catalog-update")).toBe(true);
  });
  it("accepts preview contexts without timeline claims and preserves unknown job follow-ups across restarts", () => {
    const preview: ErrorContext = { code: "PREVIEW_JOB_FAILED", stage: "job", outcome: "unavailable", operation: "preview-prepare",
      diagnosticId: "00000000-0000-4000-8000-000000000022" };
    const inbox = new UnknownErrorInbox(tmp, "0.1.0");
    inbox.record(preview);
    inbox.record(preview);
    inbox.record({ code: "PREVIEW_OFFLINE", stage: "playback", outcome: "unavailable", operation: "preview" });
    const records = new UnknownErrorInbox(tmp, "0.1.1").list().records;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ...preview, count: 2, task: "pending-catalog-update" });
    expect(Object.keys(records[0]!)).not.toContain("message");
    expect(Object.keys(records[0]!)).not.toContain("assetId");
  });
  it("groups export failures and retains unresolved tasks while known export causes create no task", () => {
    const context: ErrorContext = { code: "EXPORT_FAILED", stage: "job", outcome: "failed", operation: "export" };
    const inbox = new UnknownErrorInbox(tmp, "0.1.0");
    inbox.record(context);
    inbox.record(context);
    inbox.record({ ...context, code: "EXPORT_CLEANUP_FAILED" });
    const records = new UnknownErrorInbox(tmp, "0.1.1").list().records;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ ...context, count: 2, task: "pending-catalog-update" });
    expect(Object.keys(records[0]!)).not.toContain("outputPath");
  });

  it("bounds storage at 100 groups without evicting unresolved tasks; repeats still update", () => {
    const inbox = new UnknownErrorInbox(tmp, "0.1.0");
    for (let i = 0; i < 100; i++) inbox.record({ ...context, code: `NEW_${i}` });
    expect(inbox.record({ ...context, code: "OVER_CAPACITY" })).toBeNull();
    expect(inbox.list().capacityReached).toBe(true);
    expect(inbox.record({ ...context, code: "NEW_0" })?.records[0]!.count).toBe(2);
    expect(inbox.list().records).toHaveLength(100);
  });

  it("does not overwrite corrupt data or silently succeed when storage is unavailable", async () => {
    const file = path.join(tmp, "unknown-edit-errors.json");
    await writeFile(file, "corrupt");
    expect(() => new UnknownErrorInbox(tmp, "0.1.0").record(context)).toThrow();
    expect(await readFile(file, "utf8")).toBe("corrupt");
    await rm(file);
    await mkdir(file);
    expect(() => new UnknownErrorInbox(tmp, "0.1.0").list()).toThrow(/regular bounded file/);
  });

  it("authenticates inbox access, rejects private fields, and returns explicit storage errors", async () => {
    const app = await buildApp(loadConfig({ ENGINE_DATA_DIR: tmp, ENGINE_TOKEN: "secret" }));
    const headers = { "x-engine-token": "secret" };
    try {
      expect((await app.inject({ url: "/diagnostics/unknown-edits" })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/diagnostics/unknown-edits", headers,
        payload: { ...context, message: "C:\\Private\\secret.mp4" } })).statusCode).toBe(400);
      const recorded = await app.inject({ method: "POST", url: "/diagnostics/unknown-edits", headers, payload: context });
      expect(recorded.statusCode).toBe(200);
      expect(recorded.json().records[0].task).toBe("pending-catalog-update");
      expect(JSON.stringify(recorded.json())).not.toContain("secret");
      await writeFile(path.join(tmp, "unknown-edit-errors.json"), "corrupt");
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const failed = await app.inject({ url: "/diagnostics/unknown-edits", headers });
      expect(failed.statusCode).toBe(500);
      expect(failed.json().error.diagnosticId).toBeDefined();
    } finally { await app.close(); }
  });

  it("documents every executable catalog code in the definition index", async () => {
    const document = await readFile(new URL("../../../docs/18-error-catalog-and-recovery.md", import.meta.url), "utf8");
    for (const definition of EDIT_ERROR_DEFINITIONS) expect(document).toContain(`\`${definition.code}\``);
  });
});
