import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { HealthResponseSchema } from "@ve/schema";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { Probes } from "./probes.js";

const config = loadConfig({ ENGINE_TOKEN: "secret", ENGINE_ALLOWED_ORIGINS: "http://localhost:5173" });

const probes: Probes = {
  ffmpeg: async () => ({ name: "ffmpeg", status: "ok" }),
  ollama: async () => ({ name: "ollama", status: "unavailable", hint: "Start Ollama" }),
  vision: async () => ({ name: "vision", status: "unknown" }),
};

let app: FastifyInstance;
afterEach(async () => app?.close());

async function make() {
  app = await buildApp(config, probes);
  return app;
}

describe("engine auth", () => {
  it("rejects requests without a token", async () => {
    const res = await (await make()).inject({ url: "/health" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a wrong token", async () => {
    const res = await (await make()).inject({ url: "/health", headers: { "x-engine-token": "nope" } });
    expect(res.statusCode).toBe(401);
  });

  it("accepts the token as a header or a query parameter", async () => {
    const a = await make();
    expect((await a.inject({ url: "/health", headers: { "x-engine-token": "secret" } })).statusCode).toBe(200);
    expect((await a.inject({ url: "/health?token=secret" })).statusCode).toBe(200);
  });

  it("rejects an unknown origin even with a valid token", async () => {
    const res = await (await make()).inject({
      url: "/health",
      headers: { "x-engine-token": "secret", origin: "http://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows a known origin and returns CORS headers", async () => {
    const res = await (await make()).inject({
      url: "/health",
      headers: { "x-engine-token": "secret", origin: "http://localhost:5173" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("answers preflight for a known origin without a token", async () => {
    const res = await (await make()).inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-engine-token",
      },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe("GET /health", () => {
  it("returns a valid payload including component status", async () => {
    const res = await (await make()).inject({ url: "/health?token=secret" });
    const body = HealthResponseSchema.parse(res.json());
    expect(body.components.map((c) => c.name)).toEqual(["engine", "ffmpeg", "ollama", "vision"]);
    expect(body.components.find((c) => c.name === "ollama")?.status).toBe("unavailable");
  });
});

describe("loadConfig", () => {
  it("uses safe defaults and rejects an invalid port", () => {
    expect(loadConfig({}).host).toBe("127.0.0.1");
    expect(() => loadConfig({ ENGINE_PORT: "abc" })).toThrow();
  });
});
