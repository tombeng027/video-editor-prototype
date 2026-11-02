import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiErrorSchema } from "@ve/schema";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { reportDiagnostic } from "./diagnostics.js";

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; vi.restoreAllMocks(); });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
});
