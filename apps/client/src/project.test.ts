import { describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_SETTINGS, resolveExportSettings } from "@ve/schema";
import { cancelExport, closeProject, createProject, diagnosticMessage, getCommandOperation, getDefaultFolder, getExport, getImportOperation, getMediaStatus, getProject, getProjectOperation, getProxyStates, importFiles, listRecent, openProject, RECOVERY_TIMEOUT_MS, sendCommands, startExport } from "./projectApi.js";
import { FPS_PRESETS, projectFolderFor, validateNewProject } from "./presets.js";
import { updatePreviewJob } from "./projectApi.js";
import { editOperation, safeErrorContext } from "./editErrors.js";

const config = { url: "http://engine", token: "tok" };
const json = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("sanitized edit error context", () => {
  it("labels commands and history actions without retaining private command payloads", () => {
    expect(editOperation([{ type: "SetClipSpeed", clipId: "private-name", speed: 2 }], "record")).toBe("clip-speed");
    expect(editOperation([{ type: "RelinkAsset", assetId: "private-id", sourcePath: "C:\\Private\\file.mp4" }], "record")).toBe("media-edit");
    expect(editOperation([], "undo")).toBe("undo");
    expect(editOperation([], "redo")).toBe("redo");
    expect(editOperation([], "record")).toBe("edit");
    expect(safeErrorContext("C:\\Private\\file.mp4", "submit", "unconfirmed", "clip-speed", "not-a-uuid"))
      .toEqual({ code: "UNRECOGNIZED_CODE", stage: "submit", outcome: "unconfirmed", operation: "clip-speed" });
  });
});
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
  it("preserves explicit not-applied outcome without inventing one for older or ambiguous failures", async () => {
    const error = { code: "INVALID_REQUEST", message: "Invalid command list." };
    expect(await sendCommands(config, [], json(400, { error, outcome: "not-applied" })))
      .toMatchObject({ ok: false, outcome: "not-applied" });
    const old = await sendCommands(config, [], json(400, { error }));
    expect(old).not.toHaveProperty("outcome");
    expect(await sendCommands(config, [], json(500, { error, outcome: "saved" })))
      .toMatchObject({ ok: false, code: "HTTP_500" });
  });
  const operations = [
    (c: typeof config, f: typeof fetch) => updatePreviewJob(c, { assetId: "video", action: "prepare", expectedProject: { id: "p", folder: "C:\\test" } }, f),
    (c: typeof config, f: typeof fetch) => cancelExport(c, f),
    (c: typeof config, f: typeof fetch) => closeProject(c, undefined, f),
    (c: typeof config, f: typeof fetch) => createProject(c, {
      folder: "C:\\test", name: "test", fps: { num: 30, den: 1 }, width: 640, height: 360,
    }, f),
    (c: typeof config, f: typeof fetch) => getCommandOperation(c, "00000000-0000-4000-8000-000000000001", f),
    (c: typeof config, f: typeof fetch) => getDefaultFolder(c, f),
    (c: typeof config, f: typeof fetch) => getExport(c, f),
    (c: typeof config, f: typeof fetch) => getImportOperation(c, "00000000-0000-4000-8000-000000000001", f),
    (c: typeof config, f: typeof fetch) => getMediaStatus(c, f),
    (c: typeof config, f: typeof fetch) => getProject(c, f),
    (c: typeof config, f: typeof fetch) => getProjectOperation(c, "00000000-0000-4000-8000-000000000001", f),
    (c: typeof config, f: typeof fetch) => getProxyStates(c, f),
    (c: typeof config, f: typeof fetch) => importFiles(c, {
      attemptId: "00000000-0000-4000-8000-000000000001", paths: ["C:\\video.mp4"], mode: "reference",
    }, f),
    (c: typeof config, f: typeof fetch) => listRecent(c, f),
    (c: typeof config, f: typeof fetch) => openProject(c, "C:\\test", f, "00000000-0000-4000-8000-000000000001"),
    (c: typeof config, f: typeof fetch) => sendCommands(c, [], f, "00000000-0000-4000-8000-000000000001"),
    (c: typeof config, f: typeof fetch) => startExport(c, "00000000-0000-4000-8000-000000000001", f),
  ];

  it("sends owned preview-job requests and validates cancelled status", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(json(200, {
      proxies: [{ assetId: "video", state: "cancelled", percent: 0 }],
    }));
    const request = { assetId: "video", action: "cancel" as const, expectedProject: { id: "p", folder: "C:\\test" } };
    expect(await updatePreviewJob(config, request, fetchImpl)).toMatchObject({
      ok: true, data: { proxies: [{ state: "cancelled" }] },
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe("http://engine/project/preview-jobs");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual(request);
  });
  it("retains validated diagnostic IDs and codes without misclassifying engine failures as unreachable", async () => {
    const diagnosticId = "00000000-0000-4000-8000-000000000001";
    const error = { code: "ENGINE_UNEXPECTED_ERROR", message: "Check status before retrying.", diagnosticId };
    expect(await closeProject(config, undefined, json(500, { error }))).toEqual({
      ok: false, code: error.code, message: `${error.message} Diagnostic ID: ${diagnosticId}`, diagnosticId,
    });
    expect(diagnosticMessage(error)).toContain(diagnosticId);
    expect(await getProject(config, json(500, { error: { ...error, diagnosticId: "invalid" } })))
      .toMatchObject({ ok: false, code: "HTTP_500" });
    expect(await getProject(config, json(500, { error: { code: {}, message: [] } })))
      .toMatchObject({ ok: false, code: "HTTP_500" });
  });
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
      for (const operation of operations) {
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

  it("sends the open attempt and parses operation-specific pending/failed status", async () => {
    const attemptId = "00000000-0000-4000-8000-000000000001";
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(json(500, {}));
    await openProject(config, "C:\\Demo", fetchImpl, attemptId);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({ folder: "C:\\Demo", attemptId });
    expect(await getProjectOperation(config, attemptId, json(200, { state: "pending", attemptId })))
      .toEqual({ ok: true, data: { state: "pending", attemptId } });
    expect(await getProjectOperation(config, attemptId, json(200, { state: "failed", attemptId, error: { code: "NOT_FOUND", message: "Missing project" } })))
      .toMatchObject({ ok: true, data: { state: "failed", error: { code: "NOT_FOUND" } } });
    expect(await getProjectOperation(config, attemptId, json(200, { state: "done", attemptId })))
      .toMatchObject({ ok: false, code: "BAD_RESPONSE" });
  });

  it("correlates export start and status with the submitted attempt", async () => {
    const attemptId = "00000000-0000-4000-8000-000000000001";
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(json(202, { state: "running", percent: 0, attemptId }));
    expect(await startExport(config, attemptId, fetchImpl)).toEqual({ ok: true, data: { state: "running", percent: 0, attemptId } });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({ attemptId });
    expect(await getExport(config, json(200, { state: "done", percent: 100, attemptId })))
      .toMatchObject({ ok: true, data: { attemptId, state: "done" } });
  });

  it("sends selected export settings and parses the attempt's resolved output", async () => {
    const attemptId = "00000000-0000-4000-8000-000000000001";
    const settings = { ...DEFAULT_EXPORT_SETTINGS, frameRate: "60", resolution: "720p", quality: "high" } as const;
    const resolved = resolveExportSettings({ width: 1920, height: 1080, fps: { num: 30, den: 1 } }, settings);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(json(202, { state: "running", percent: 0, attemptId, settings: resolved }));
    expect(await startExport(config, attemptId, fetchImpl, settings)).toMatchObject({ ok: true, data: { settings: resolved } });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({ attemptId, settings });
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
      const exportResult = startExport(config, "00000000-0000-4000-8000-000000000001", fetchImpl);
      await vi.advanceTimersByTimeAsync(RECOVERY_TIMEOUT_MS);
      expect(await exportResult).toMatchObject({ ok: false, code: "REQUEST_TIMEOUT" });
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

  it("normalizes transport, non-JSON HTTP and invalid success failures across every API wrapper", async () => {
    for (const operation of operations) {
      const unreachable: typeof fetch = async () => { throw new Error("private transport detail"); };
      expect(await operation(config, unreachable)).toEqual({
        ok: false, code: "UNREACHABLE", message: "Cannot reach the engine. Is it running?",
      });

      const nonJsonError: typeof fetch = async () => new Response("private upstream body", { status: 502 });
      expect(await operation(config, nonJsonError)).toEqual({
        ok: false, code: "HTTP_502", message: "Engine returned HTTP 502.",
      });

      const invalidSuccess: typeof fetch = async () => new Response("{}", { status: 200 });
      expect(await operation(config, invalidSuccess)).toEqual({
        ok: false, code: "BAD_RESPONSE", message: "Engine sent an unexpected response.",
      });
    }
  });

  it("sends a command attempt ID and queries its status without resubmitting", async () => {
    const attemptId = "00000000-0000-4000-8000-000000000001";
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(json(409, { error: { code: "ATTEMPT_EXISTS", message: "Already submitted." } }));
    await sendCommands(config, [{ type: "RemoveTrack", trackId: "t" }], fetchImpl, attemptId);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({
      commands: [{ type: "RemoveTrack", trackId: "t" }], attemptId,
    });

    const statusFetch = vi.fn<typeof fetch>().mockImplementation(json(404, { error: { code: "OPERATION_UNKNOWN", message: "Not recorded." } }));
    expect(await getCommandOperation(config, attemptId, statusFetch)).toMatchObject({ ok: false, code: "OPERATION_UNKNOWN" });
    expect(statusFetch.mock.calls[0]![0]).toBe(`http://engine/project/command-operations/${attemptId}`);
    expect(statusFetch.mock.calls[0]![1]!.method).toBe("GET");
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
