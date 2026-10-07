import { describe, expect, it } from "vitest";
import { decodeEngineArg, encodeEngineArg } from "./engineArg.js";
import {
  buildEngineLaunch,
  clientOrigin,
  generateToken,
  getFreePort,
  waitForEngine,
} from "./engineLaunch.js";

describe("engine launch", () => {
  it("generates unique long tokens", () => {
    const a = generateToken();
    expect(a).toHaveLength(64);
    expect(generateToken()).not.toBe(a);
  });

  it("finds a free loopback port", async () => {
    expect(await getFreePort()).toBeGreaterThan(0);
  });

  it("builds the launch config with the allowed client origin", () => {
    const l = buildEngineLaunch({
      engineDir: "/e",
      execPath: "/electron",
      port: 4000,
      token: "t",
      clientUrl: "http://127.0.0.1:5173/some/path",
      baseEnv: { KEEP: "1" },
    });
    expect(l.env).toMatchObject({
      KEEP: "1",
      ELECTRON_RUN_AS_NODE: "1",
      ENGINE_PORT: "4000",
      ENGINE_TOKEN: "t",
      ENGINE_ALLOWED_ORIGINS: "http://127.0.0.1:5173",
    });
    expect(l.args[0]).toBe("--import");
    expect(clientOrigin("http://localhost:5173/x")).toBe("http://localhost:5173");
  });

  it("round-trips the engine info through a preload argument", () => {
    const info = { url: "http://127.0.0.1:1", token: "abc" };
    expect(decodeEngineArg(["x", encodeEngineArg(info)])).toEqual(info);
    expect(decodeEngineArg(["x"])).toBeUndefined();
    expect(decodeEngineArg(["--ve-engine=!!!"])).toBeUndefined();
  });

  it("times out when the engine never answers", async () => {
    const never = (async () => {
      throw new Error("down");
    }) as typeof fetch;
    await expect(waitForEngine({ url: "http://x", token: "t" }, 400, never)).rejects.toThrow(/did not start/);
  });
});
