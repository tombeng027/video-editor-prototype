import { describe, expect, it } from "vitest";
import { createProject, listRecent, sendCommands } from "./projectApi.js";
import { FPS_PRESETS, projectFolderFor, validateNewProject } from "./presets.js";

const config = { url: "http://engine", token: "tok" };
const json = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("presets", () => {
  it("offers NTSC rates as exact rationals", () => {
    expect(FPS_PRESETS.find((p) => p.label === "29.97")?.value).toEqual({ num: 30000, den: 1001 });
  });

  it("validates the form", () => {
    const form = { name: "A", folder: "C:\\v", fpsIndex: 4, matchFirstImport: false, resolutionIndex: 0 };
    expect(validateNewProject(form)).toBeNull();
    expect(validateNewProject({ ...form, name: " " })).toMatch(/name/i);
    expect(validateNewProject({ ...form, folder: "" })).toMatch(/folder/i);
  });

  it("builds a project folder path with the parent's separator and a safe name", () => {
    expect(projectFolderFor("C:\\Videos\\", "My: Cut?")).toBe("C:\\Videos\\My- Cut-");
    expect(projectFolderFor("/home/me", "demo")).toBe("/home/me/demo");
    expect(projectFolderFor("/home/me", "...")).toBe("/home/me/project");
  });
});

describe("projectApi", () => {
  it("surfaces typed engine errors", async () => {
    const res = await createProject(
      config,
      { folder: "x", name: "n", fps: { num: 30, den: 1 }, width: 1, height: 1 },
      json(409, { error: { code: "ALREADY_EXISTS", message: "exists" } }),
    );
    expect(res).toEqual({ ok: false, code: "ALREADY_EXISTS", message: "exists" });
  });

  it("reports an unreachable engine", async () => {
    const failing = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const res = await sendCommands(config, [{ type: "RemoveTrack", trackId: "t" }], failing);
    expect(res).toMatchObject({ ok: false, code: "UNREACHABLE" });
  });

  it("rejects malformed success payloads and returns [] for recents on failure", async () => {
    const bad = await createProject(
      config,
      { folder: "x", name: "n", fps: { num: 30, den: 1 }, width: 1, height: 1 },
      json(200, { nope: true }),
    );
    expect(bad).toMatchObject({ ok: false, code: "BAD_RESPONSE" });
    expect(await listRecent(config, json(500, {}))).toEqual([]);
  });
});
