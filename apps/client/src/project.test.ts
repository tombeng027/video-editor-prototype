import { describe, expect, it, vi } from "vitest";
import { cancelExport, closeProject, createProject, getDefaultFolder, getExport, getProject, listRecent, RECOVERY_TIMEOUT_MS, sendCommands } from "./projectApi.js";
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
  it("sends the expected project identity with guarded close", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(json(200, { ok: true }));
    const expected = { id: "p", folder: "C:\\Demo" };
    expect(await closeProject(config, expected, fetchImpl)).toMatchObject({ ok: true });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({ expectedProject: expected });
  });

  it("retains close failures and requires a confirmed true success", async () => {
    expect(await closeProject(config, undefined, json(200, { ok: true }))).toEqual({ ok: true, data: { ok: true } });
    expect(await closeProject(config, undefined, json(200, { ok: false }))).toMatchObject({ ok: false, code: "BAD_RESPONSE" });
    expect(await closeProject(config, undefined, json(500, { error: { code: "CLOSE_FAILED", message: "Cleanup incomplete" } })))
      .toEqual({ ok: false, code: "CLOSE_FAILED", message: "Cleanup incomplete" });
    expect(await getProject(config, json(404, { error: { code: "NO_PROJECT", message: "No project" } })))
      .toMatchObject({ ok: false, code: "NO_PROJECT" });
  });

  it("bounds recovery reads/mutations at exactly 15 seconds and aborts outstanding requests", async () => {
    vi.useFakeTimers();
    try {
      const close = (c: typeof config, f: typeof fetch) => closeProject(c, undefined, f);
      for (const operation of [close, getProject, getExport, cancelExport]) {
        let signal: AbortSignal | null | undefined;
        const fetchImpl: typeof fetch = (_input, init) => {
          signal = init?.signal;
          return new Promise<Response>(() => undefined);
        };
        let settled = false;
        const result = operation(config, fetchImpl).then((r) => { settled = true; return r; });
        await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS - 1);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await result).toMatchObject({ ok: false, code: "REQUEST_TIMEOUT" });
        expect(signal?.aborted).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a stalled response body and clears deadlines on a successful response", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl: typeof fetch = async () => {
        const response = new Response();
        response.json = () => new Promise<unknown>(() => undefined);
        return response;
      };
      const result = closeProject(config, undefined, fetchImpl);
      await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS);
      expect(await result).toMatchObject({ ok: false, code: "REQUEST_TIMEOUT" });
      expect(await closeProject(config, undefined, json(200, { ok: true }))).toMatchObject({ ok: true });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the default location or an explicit failure", async () => {
    expect(await getDefaultFolder(config, json(200, { folder: "C:\\Samples" }))).toEqual({
      ok: true, data: { folder: "C:\\Samples" },
    });
    expect(await getDefaultFolder(config, json(500, { error: { code: "FAILED", message: "no access" } })))
      .toEqual({ ok: false, code: "FAILED", message: "no access" });
    expect(await getDefaultFolder(config, json(200, {}))).toMatchObject({ ok: false, code: "BAD_RESPONSE" });
  });
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

  it("rejects malformed success payloads and exposes recents failure", async () => {
    const bad = await createProject(
      config,
      { folder: "x", name: "n", fps: { num: 30, den: 1 }, width: 1, height: 1 },
      json(200, { nope: true }),
    );
    expect(bad).toMatchObject({ ok: false, code: "BAD_RESPONSE" });
    expect(await listRecent(config, json(500, {}))).toMatchObject({ ok: false, code: "HTTP_500" });
  });

  it("retains project-operation warnings and distinguishes an empty recent list from failure", async () => {
    const project = {
      schemaVersion: 1, id: "p", name: "Demo", settings: { fps: { num: 30, den: 1 }, width: 640, height: 360, fpsFromFirstImport: false },
      assets: [], tracks: [], createdAt: "", updatedAt: "",
    };
    const warnings = [{ code: "RECENT_UPDATE_FAILED", message: "Open succeeded; index update failed." }];
    expect(await createProject(config, { folder: "x", name: "Demo", fps: { num: 30, den: 1 }, width: 640, height: 360 },
      json(200, { folder: "x", project, recoveredFromBackup: false, warnings }))).toMatchObject({ ok: true, data: { warnings } });
    expect(await listRecent(config, json(200, { projects: [] }))).toEqual({ ok: true, data: { projects: [] } });
    expect(await listRecent(config, json(500, { error: { code: "RECENT_INDEX_INVALID", message: "Damaged index." } }))).toEqual({
      ok: false, code: "RECENT_INDEX_INVALID", message: "Damaged index.",
    });
  });
});
