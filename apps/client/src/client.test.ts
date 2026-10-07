import { describe, expect, it } from "vitest";
import { DEFAULT_SIZES, LIMITS, clampSize, loadSizes, saveSizes } from "./layout.js";
import { fetchHealth, resolveEngineConfig } from "./engine.js";

const memory = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
  };
};

describe("layout persistence", () => {
  it("falls back to defaults for missing, corrupt or invalid data", () => {
    expect(loadSizes(memory())).toEqual(DEFAULT_SIZES);
    expect(loadSizes(memory("{not json"))).toEqual(DEFAULT_SIZES);
    expect(loadSizes(memory(JSON.stringify({ assetsWidth: "wide" }))).assetsWidth).toBe(DEFAULT_SIZES.assetsWidth);
  });

  it("clamps stored sizes to limits", () => {
    const loaded = loadSizes(memory(JSON.stringify({ assetsWidth: 5, timelineHeight: 99999 })));
    expect(loaded.assetsWidth).toBe(LIMITS.assetsWidth.min);
    expect(loaded.timelineHeight).toBe(LIMITS.timelineHeight.max);
  });

  it("round-trips saved sizes", () => {
    const store = memory();
    const sizes = { assetsWidth: 300, assistantWidth: 400, timelineHeight: 350, assistantOpen: false };
    saveSizes(store, sizes);
    expect(loadSizes(store)).toEqual(sizes);
  });

  it("clamps drag results", () => {
    expect(clampSize("assistantWidth", 10)).toBe(LIMITS.assistantWidth.min);
    expect(clampSize("assistantWidth", 300.4)).toBe(300);
  });
});

describe("engine config", () => {
  it("prefers the desktop bridge, then env, then defaults", () => {
    expect(resolveEngineConfig({ engine: { url: "http://x", token: "t" } }, { VITE_ENGINE_URL: "http://y" })).toEqual({
      url: "http://x",
      token: "t",
    });
    expect(resolveEngineConfig(undefined, { VITE_ENGINE_URL: "http://y", VITE_ENGINE_TOKEN: "z" })).toEqual({
      url: "http://y",
      token: "z",
    });
    expect(resolveEngineConfig(undefined, {})).toEqual({ url: "http://127.0.0.1:7878", token: "dev-token" });
  });
});

describe("fetchHealth", () => {
  const config = { url: "http://e", token: "tok" };
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

  it("sends the token and parses a valid response", async () => {
    let header = "";
    const impl = (async (_url: string, init?: RequestInit) => {
      header = (init?.headers as Record<string, string>)["x-engine-token"] ?? "";
      return new Response(JSON.stringify({ ok: true, version: "1", components: [{ name: "engine", status: "ok" }] }));
    }) as unknown as typeof fetch;
    const result = await fetchHealth(config, impl);
    expect(header).toBe("tok");
    expect(result.state).toBe("ok");
  });

  it("reports auth failures, bad payloads and unreachable engines", async () => {
    expect(await fetchHealth(config, respond(401, {}))).toMatchObject({ state: "error", message: expect.stringContaining("token") });
    expect(await fetchHealth(config, respond(200, { nope: 1 }))).toMatchObject({ state: "error" });
    const down = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    expect(await fetchHealth(config, down)).toMatchObject({ state: "error", message: expect.stringContaining("Cannot reach") });
  });
});
