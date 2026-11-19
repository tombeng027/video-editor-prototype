import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@ve/schema";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { closeDiagnosticSink, configureDiagnosticSink, reportDiagnostic } from "./diagnostics.js";
import { DiagnosticStore } from "./diagnosticStore.js";

let app: FastifyInstance | undefined;
const tempDirs: string[] = [];
afterEach(async () => {
  await app?.close();
  app = undefined;
  closeDiagnosticSink();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tempDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ve-diagnostics-"));
  tempDirs.push(dir);
  return dir;
};

describe("safe engine diagnostics", () => {
  it("logs one correlated record using only a registered route template and allowlisted causes", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "private-token" }));
    app.post("/fixture/:id", async () => {
      throw new Error("secret text C:\\Private\\source.mp4", {
        cause: Object.assign(new Error("private nested message"), { code: "ENOSPC", path: "C:\\Private" }),
      });
    });
    const result = await app.inject({ method: "POST", url: "/fixture/private-id?token=private-token&path=private-query",
      headers: { "x-request-id": "caller-controlled-private-id" }, payload: { privateBody: "private-body" } });
    expect(result.statusCode).toBe(500);
    const error = ApiErrorSchema.parse(result.json()).error;
    expect(error.code).toBe("ENGINE_UNEXPECTED_ERROR");
    expect(error.diagnosticId).toMatch(uuid);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    const record = JSON.parse(line);
    expect(record).toMatchObject({ code: error.code, diagnosticId: error.diagnosticId, method: "POST",
      route: "/fixture/:id", causes: [{ name: "Error" }, { name: "Error", ioCode: "ENOSPC" }] });
    for (const value of ["private-token", "private-id", "private-query", "private-body", "Private", "secret text", "stack"]) {
      expect(line + result.body).not.toContain(value);
    }
  });

  it("bounds/cycle-checks cause metadata, omits unknown names/codes and generates distinct server IDs", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const nested = Object.assign(new Error("hidden"), { name: "private-name", code: "private-code" });
    nested.cause = nested;
    const first = reportDiagnostic("PROJECT_OPERATION_FAILED", nested);
    const second = reportDiagnostic("PROJECT_OPERATION_FAILED", "private thrown string");
    expect(first).toMatch(uuid);
    expect(second).not.toBe(first);
    expect(JSON.parse(log.mock.calls[0]![0]).causes).toEqual([{ name: "Error" }]);
    expect(JSON.parse(log.mock.calls[1]![0]).causes).toEqual([]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    let chain = new Error("hidden");
    for (let i = 0; i < 10; i++) chain = new Error("hidden", { cause: chain });
    reportDiagnostic("ENGINE_UNEXPECTED_ERROR", chain);
    expect(JSON.parse(log.mock.calls[2]![0]).causes).toHaveLength(3);
  });

  it("preserves malformed-body status as a coded client error without logging its contents", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    app = await buildApp(loadConfig({ ENGINE_TOKEN: "fixture" }));
    const result = await app.inject({ method: "POST", url: "/project/create", headers: {
      "x-engine-token": "fixture", "content-type": "application/json",
    }, payload: '{"private":' });
    expect(result.statusCode).toBe(400);
    expect(result.json().error.code).toBe("INVALID_REQUEST");
    expect(result.body).not.toContain("private");
    expect(log).not.toHaveBeenCalled();
  });

  it("persists only structured diagnostics while retaining stderr output", () => {
    const dataDir = tempDir();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    configureDiagnosticSink(dataDir);
    const id = reportDiagnostic("PROJECT_OPERATION_FAILED", new Error("private C:\\media\\clip.mp4"), {
      method: "POST",
      route: "/project/create",
    });
    const folder = path.join(dataDir, "diagnostics");
    const [file] = readdirSync(folder);
    expect(file).toMatch(/^engine-.*\.0\.jsonl$/);
    const line = readFileSync(path.join(folder, file!), "utf8");
    expect(JSON.parse(line)).toMatchObject({
      code: "PROJECT_OPERATION_FAILED",
      diagnosticId: id,
      method: "POST",
      route: "/project/create",
    });
    expect(line).not.toContain("private");
    expect(line).not.toContain("C:\\media");
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]![0])).toBe(line.trim());
  });

  it("rotates diagnostics at the file limit and retains only the configured run files", () => {
    const dataDir = tempDir();
    const store = new DiagnosticStore(dataDir);
    const record = JSON.stringify({ code: "ENGINE_UNEXPECTED_ERROR", padding: "x".repeat(900 * 1024) });
    for (let i = 0; i < 4; i++) store.append(record);
    const files = readdirSync(path.join(dataDir, "diagnostics"));
    expect(files).toHaveLength(3);
    expect(files.every((file) => readFileSync(path.join(dataDir, "diagnostics", file), "utf8").length <= 1024 * 1024)).toBe(true);
    expect(files.some((file) => file.endsWith(".0.jsonl"))).toBe(true);
    expect(readFileSync(path.join(dataDir, "diagnostics", files.find((file) => file.endsWith(".0.jsonl"))!), "utf8"))
      .toContain(record);
  });

  it("prunes old inactive engine runs but preserves current-run diagnostics", () => {
    const dataDir = tempDir();
    const folder = path.join(dataDir, "diagnostics");
    mkdirSync(folder);
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString().replace(/[-:.]/g, "");
    const oldFile = `engine-${old}-2147483647-00000000-0000-4000-8000-000000000001.0.jsonl`;
    writeFileSync(path.join(folder, oldFile), "{\"code\":\"old\"}\n");
    const store = new DiagnosticStore(dataDir);
    store.append("{\"code\":\"current\"}");
    const files = readdirSync(folder);
    expect(files).not.toContain(oldFile);
    expect(files.some((file) => file.endsWith(".0.jsonl") && file !== oldFile)).toBe(true);
  });

  it("keeps diagnostic reporting operational when the local sink cannot initialize", () => {
    const dataDir = tempDir();
    writeFileSync(path.join(dataDir, "not-a-directory"), "fixture");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    configureDiagnosticSink(path.join(dataDir, "not-a-directory"));
    expect(() => reportDiagnostic("PROJECT_OPERATION_FAILED", new Error("private"))).not.toThrow();
    expect(log).toHaveBeenCalledOnce();
    expect(String(log.mock.calls[0]![0])).not.toContain("private");
  });
});
