// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectResponse } from "@ve/schema";
import { createEmptyProject } from "@ve/timeline-core";
import type { HealthResult } from "../engine.js";
import type { DesktopBridge } from "../desktop.js";
import * as api from "../projectApi.js";
import { Modal } from "./Modal.js";
import { NewProjectDialog } from "./NewProjectDialog.js";
import { Landing } from "./Landing.js";
import { Editor } from "./Editor.js";
import { ExportDialog } from "./ExportDialog.js";
import { App } from "../App.js";

vi.mock("../projectApi.js", async (importOriginal) => ({
  diagnosticMessage: (await importOriginal<typeof import("../projectApi.js")>()).diagnosticMessage,
  createProject: vi.fn(), getDefaultFolder: vi.fn(), listRecent: vi.fn(), openProject: vi.fn(),
  getMediaStatus: vi.fn(), getProject: vi.fn(), getProjectOperation: vi.fn(), sendCommands: vi.fn(),
  startExport: vi.fn(), getExport: vi.fn(), cancelExport: vi.fn(),
  closeProject: vi.fn(), importFiles: vi.fn(),
}));
vi.mock("../useHealth.js", () => ({ useHealth: () => health }));
vi.mock("../useProxyStatus.js", () => ({ useProxyStatus: () => new Map() }));
vi.mock("./Preview.js", () => ({ Preview: () => <div>Preview fixture</div> }));

const config = { url: "http://engine", token: "test" };
const health: HealthResult = { state: "ok", health: { ok: true, version: "test", components: [] } };
const response: ProjectResponse = {
  folder: "C:\\Samples\\Demo", recoveredFromBackup: false,
  project: createEmptyProject({ id: "p", name: "Demo", fps: { num: 30, den: 1 }, width: 640, height: 360 }),
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function bridge(value: DesktopBridge | undefined) {
  Object.defineProperty(window, "veDesktop", { configurable: true, value });
}

beforeEach(() => {
  vi.resetAllMocks();
  bridge(undefined);
  localStorage.clear();
  vi.mocked(api.getDefaultFolder).mockResolvedValue({ ok: true, data: { folder: "C:\\Samples" } });
  vi.mocked(api.listRecent).mockResolvedValue({ ok: true, data: { projects: [
    { folder: "C:\\Recent", name: "Recent", openedAt: "", exists: true },
  ] } });
  vi.mocked(api.getMediaStatus).mockResolvedValue({ ok: true, data: { offline: [] } });
  vi.mocked(api.getExport).mockResolvedValue({ ok: true, data: { state: "running", percent: 10 } });
  // jsdom has no native modal/top-layer implementation; browser smoke verifies inertness.
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    }) },
    close: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    }) },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  bridge(undefined);
});

describe("shared modal input policy", () => {
  it("retains engine error codes and diagnostic IDs in actual editor command feedback", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Fixture video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Synthetic.mp4",
      contentHash: "synthetic", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    const diagnosticId = "00000000-0000-4000-8000-000000000001";
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "ENGINE_UNEXPECTED_ERROR",
      message: `Check status before retrying. Diagnostic ID: ${diagnosticId}` });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add Fixture video to timeline" })));
    expect(screen.getByRole("alert").textContent).toContain(`[ENGINE_UNEXPECTED_ERROR] Check status before retrying. Diagnostic ID: ${diagnosticId}`);
    expect(api.sendCommands).toHaveBeenCalledTimes(1);
  });

  it("contains forward/reverse Tab, blocks bubbling shortcuts and restores the opener", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const close = vi.fn();
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    const view = render(<Modal label="Fixture" dismissible onClose={close}><button>First</button><button>Last</button></Modal>);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    await user.keyboard("s{Delete}{Escape}");
    expect(onKey).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    window.removeEventListener("keydown", onKey);
    opener.remove();
  });

  it("prevents both Escape and native cancel while nondismissible", async () => {
    const close = vi.fn();
    render(<Modal label="Busy" dismissible={false} onClose={close}><p>Waiting</p></Modal>);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);
    await userEvent.setup().keyboard("{Tab}{Escape}");
    expect(document.activeElement).toBe(dialog);
    expect(fireEvent(dialog, new Event("cancel", { cancelable: true }))).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});

describe("creation owns its pending interaction", () => {
  it("allows Projects navigation during media picking and discards selection while close is still pending", async () => {
    const picker = deferred<string[]>(), closed = deferred<Awaited<ReturnType<typeof api.closeProject>>>();
    bridge({ pickMedia: vi.fn().mockReturnValue(picker.promise) });
    vi.mocked(api.createProject).mockResolvedValue({ ok: true, data: response });
    vi.mocked(api.closeProject).mockReturnValue(closed.promise);
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create new project" }));
    await waitFor(() => expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\Samples"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(screen.getByRole("button", { name: "Import media" }));
    expect(screen.getByText(/Leaving this editor discards/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "← Projects" }));
    expect(screen.getByRole("dialog", { name: "Close project" })).toBeDefined();
    await act(async () => picker.resolve(["C:\\Late.mp4"]));
    expect(api.importFiles).not.toHaveBeenCalled();
    await act(async () => closed.resolve({ ok: true, data: { ok: true } }));
    expect(screen.getByRole("heading", { name: "Video Editor Prototype" })).toBeDefined();
  });

  it("restores focus to Create after cancelling the idle dialog", async () => {
    render(<Landing config={config} health={health} onOpened={vi.fn()} />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Create new project" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("locks fields, cancel and navigation, suppresses duplicate submit and adopts one committed result", async () => {
    const result = deferred<Awaited<ReturnType<typeof api.createProject>>>();
    vi.mocked(api.createProject).mockReturnValue(result.promise);
    const opened = vi.fn();
    const user = userEvent.setup();
    render(<Landing config={config} health={health} onOpened={opened} />);
    await screen.findByRole("button", { name: /Recent/ });
    await user.click(screen.getByRole("button", { name: "Create new project" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\Samples"));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    for (const control of dialog.querySelectorAll<HTMLInputElement>("input, select, button")) expect(control.matches(":disabled")).toBe(true);
    expect(within(dialog).getByRole("status").textContent).toContain("cannot be cancelled");
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.click(screen.getByRole("button", { name: /Recent/ }));
    await user.keyboard("{Escape}");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(api.openProject).not.toHaveBeenCalled();
    expect(api.createProject).toHaveBeenCalledTimes(1);
    const warnings = [{ code: "RECENT_UPDATE_FAILED", message: "Recent list warning" }];
    await act(async () => result.resolve({ ok: true, data: { ...response, warnings } }));
    expect(opened).toHaveBeenCalledExactlyOnceWith({ ...response, warnings });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("unlocks on coded failure for retry or cancel, but local validation never submits", async () => {
    const cancel = vi.fn();
    const user = userEvent.setup();
    vi.mocked(api.createProject).mockResolvedValue({ ok: false, code: "SAVE_FAILED", message: "Write denied" });
    render(<NewProjectDialog config={config} onCancel={cancel} onCreated={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\Samples"));
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(api.createProject).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Name"), "Retry");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert").textContent).toContain("[SAVE_FAILED]");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(api.createProject).toHaveBeenCalledTimes(2);
    await user.keyboard("{Escape}");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("locks during the native picker and surfaces picker rejection before allowing retry", async () => {
    const picker = deferred<string | null>();
    const pickFolder = vi.fn().mockReturnValue(picker.promise);
    bridge({ pickFolder });
    const cancel = vi.fn();
    const user = userEvent.setup();
    render(<NewProjectDialog config={config} onCancel={cancel} onCreated={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Browse/ }));
    expect((screen.getByRole("button", { name: "Create" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => picker.resolve("C:\\Chosen"));
    expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\Chosen");
    pickFolder.mockRejectedValueOnce(new Error("IPC unavailable"));
    await user.click(screen.getByRole("button", { name: /Browse/ }));
    expect(screen.getByRole("alert").textContent).toContain("[FOLDER_PICK_FAILED]");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not overwrite an explicitly cleared location with a delayed default", async () => {
    const defaults = deferred<Awaited<ReturnType<typeof api.getDefaultFolder>>>();
    vi.mocked(api.getDefaultFolder).mockReturnValue(defaults.promise);
    render(<NewProjectDialog config={config} onCancel={vi.fn()} onCreated={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Location"), "manual");
    await user.clear(screen.getByLabelText("Location"));
    await act(async () => defaults.resolve({ ok: true, data: { folder: "C:\\Default" } }));
    expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("");
  });

  it("locks landing navigation while choosing/opening, then unlocks on failure", async () => {
    const picker = deferred<string | null>();
    const opened = deferred<Awaited<ReturnType<typeof api.openProject>>>();
    bridge({ pickFolder: vi.fn().mockReturnValue(picker.promise) });
    vi.mocked(api.openProject).mockReturnValue(opened.promise);
    const user = userEvent.setup();
    render(<Landing config={config} health={health} onOpened={vi.fn()} />);
    await screen.findByRole("button", { name: /Recent/ });
    await user.click(screen.getByRole("button", { name: /Open project/ }));
    expect((screen.getByRole("button", { name: "Create new project" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Recent/ }));
    expect(api.openProject).not.toHaveBeenCalled();
    await act(async () => picker.resolve("C:\\Chosen"));
    expect(api.openProject).toHaveBeenCalledExactlyOnceWith(config, "C:\\Chosen", undefined, expect.any(String));
    await act(async () => opened.resolve({ ok: false, code: "CORRUPT", message: "No usable backup" }));
    expect(screen.getByRole("alert").textContent).toContain("[CORRUPT]");
    expect((screen.getByRole("button", { name: "Create new project" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps uncertain create locked through pending/unknown status and adopts only the matching attempt", async () => {
    vi.mocked(api.createProject).mockResolvedValue({ ok: false, code: "REQUEST_TIMEOUT", message: "Response lost" });
    const onCreated = vi.fn(), cancel = vi.fn();
    render(<NewProjectDialog config={config} onCancel={cancel} onCreated={onCreated} />);
    await waitFor(() => expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\Samples"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create" })));
    const attemptId = vi.mocked(api.createProject).mock.calls[0]![1].attemptId!;
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.submit(dialog.querySelector("form")!);
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    for (const result of [
      { ok: false as const, code: "OPERATION_UNKNOWN", message: "Not recorded" },
      { ok: true as const, data: { state: "pending" as const, attemptId } },
      { ok: true as const, data: { state: "done" as const, attemptId: "00000000-0000-4000-8000-000000000002", response } },
    ]) {
      vi.mocked(api.getProjectOperation).mockResolvedValueOnce(result);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project operation" })));
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
      expect(onCreated).not.toHaveBeenCalled();
    }
    const warnings = [{ code: "PROJECT_PREPARATION_FAILED", message: "Preparation incomplete" }];
    vi.mocked(api.getProjectOperation).mockResolvedValueOnce({ ok: true, data: { state: "done", attemptId, response: { ...response, warnings } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project operation" })));
    expect(onCreated).toHaveBeenCalledExactlyOnceWith({ ...response, warnings });
    expect(api.createProject).toHaveBeenCalledTimes(1);
    expect(api.getProjectOperation).toHaveBeenLastCalledWith(config, attemptId);
  });

  it("unlocks a confirmed failed create and uses a new attempt on explicit retry", async () => {
    vi.mocked(api.createProject).mockResolvedValue({ ok: false, code: "UNREACHABLE", message: "Connection lost" });
    render(<NewProjectDialog config={config} onCancel={vi.fn()} onCreated={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\Samples"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create" })));
    const attemptId = vi.mocked(api.createProject).mock.calls[0]![1].attemptId!;
    vi.mocked(api.getProjectOperation).mockResolvedValueOnce({ ok: true, data: { state: "failed", attemptId, error: { code: "PROJECT_OPERATION_FAILED", message: "Failed before opening" } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project operation" })));
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("PROJECT_OPERATION_FAILED");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create" })));
    expect(vi.mocked(api.createProject).mock.calls[1]![1].attemptId).not.toBe(attemptId);
  });

  it("displays a correlated diagnostic ID from failed operation status while allowing confirmed-failure recovery", async () => {
    vi.mocked(api.createProject).mockResolvedValue({ ok: false, code: "UNREACHABLE", message: "Response lost" });
    render(<NewProjectDialog config={config} onCancel={vi.fn()} onCreated={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\Samples"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create" })));
    const attemptId = vi.mocked(api.createProject).mock.calls[0]![1].attemptId!;
    const diagnosticId = "00000000-0000-4000-8000-000000000001";
    vi.mocked(api.getProjectOperation).mockResolvedValueOnce({ ok: true, data: { state: "failed", attemptId,
      error: { code: "PROJECT_OPERATION_FAILED", message: "Check local diagnostics", diagnosticId } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project operation" })));
    expect(screen.getByRole("alert").textContent).toContain(`[PROJECT_OPERATION_FAILED] Check local diagnostics Diagnostic ID: ${diagnosticId}`);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("locks uncertain open, guards duplicate checks and ignores a late check after unmount", async () => {
    vi.mocked(api.openProject).mockResolvedValue({ ok: false, code: "BAD_RESPONSE", message: "Invalid response" });
    const onOpened = vi.fn();
    const view = render(<Landing config={config} health={health} onOpened={onOpened} />);
    await screen.findByRole("button", { name: /Recent/ });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Recent/ })));
    const dialog = screen.getByRole("dialog", { name: "Open project" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Create new project" }));
    expect(screen.queryByRole("dialog", { name: "New project" })).toBeNull();
    const check = deferred<Awaited<ReturnType<typeof api.getProjectOperation>>>();
    vi.mocked(api.getProjectOperation).mockReturnValueOnce(check.promise);
    const button = screen.getByRole("button", { name: "Check project operation" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.getProjectOperation).toHaveBeenCalledTimes(1);
    view.unmount();
    const attemptId = vi.mocked(api.openProject).mock.calls[0]![3]!;
    await act(async () => check.resolve({ ok: true, data: { state: "done", attemptId, response } }));
    expect(onOpened).not.toHaveBeenCalled();
  });

  it("keeps changed-project status locked, then adopts a matching open result without another POST", async () => {
    vi.mocked(api.openProject).mockResolvedValue({ ok: false, code: "UNREACHABLE", message: "Lost response" });
    const onOpened = vi.fn();
    render(<Landing config={config} health={health} onOpened={onOpened} />);
    await screen.findByRole("button", { name: /Recent/ });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /Recent/ })));
    vi.mocked(api.getProjectOperation).mockResolvedValueOnce({ ok: false, code: "PROJECT_CHANGED", message: "No longer active" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project operation" })));
    expect(screen.getByRole("alert").textContent).toContain("PROJECT_CHANGED");
    expect(onOpened).not.toHaveBeenCalled();
    const attemptId = vi.mocked(api.openProject).mock.calls[0]![3]!;
    vi.mocked(api.getProjectOperation).mockResolvedValueOnce({ ok: true, data: { state: "done", attemptId, response } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project operation" })));
    expect(onOpened).toHaveBeenCalledExactlyOnceWith(response);
    expect(api.openProject).toHaveBeenCalledTimes(1);
  });
});

describe("export dialog input isolation", () => {
  it("locks ambiguous export start until status identifies this attempt, not an earlier result", async () => {
    const close = vi.fn();
    vi.mocked(api.startExport).mockResolvedValue({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out" });
    render(<ExportDialog config={config} onClose={close} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    const attemptId = vi.mocked(api.startExport).mock.calls[0]![1]!;
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Export again" })).toBeNull();
    for (const data of [
      { state: "idle" as const, percent: 0 },
      { state: "done" as const, percent: 100, attemptId: "00000000-0000-4000-8000-000000000002" },
    ]) {
      vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check export status" })));
      expect(screen.getByRole("alert").textContent).toContain("EXPORT_START_UNCONFIRMED");
      expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    }
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "done", percent: 100, attemptId, outputPath: "C:\\done.mp4" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check export status" })));
    expect(screen.getByRole("status").textContent).toContain("Export finished");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(api.startExport).toHaveBeenCalledTimes(1);
  });

  it("guards duplicate reconciliation, retains read errors and adopts a matching running attempt", async () => {
    vi.mocked(api.startExport).mockResolvedValue({ ok: false, code: "HTTP_500", message: "Unexpected failure" });
    render(<ExportDialog config={config} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    const check = deferred<Awaited<ReturnType<typeof api.getExport>>>();
    vi.mocked(api.getExport).mockReturnValueOnce(check.promise);
    const button = screen.getByRole("button", { name: "Check export status" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.getExport).toHaveBeenCalledTimes(1);
    await act(async () => check.resolve({ ok: false, code: "UNREACHABLE", message: "Offline" }));
    expect(screen.getByRole("alert").textContent).toContain("[UNREACHABLE]");
    const attemptId = vi.mocked(api.startExport).mock.calls[0]![1]!;
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "running", percent: 5, attemptId } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check export status" })));
    expect(screen.getByRole("progressbar")).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel export" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("unlocks definitive export rejection without a status check", async () => {
    vi.mocked(api.startExport).mockResolvedValue({ ok: false, code: "OFFLINE_MEDIA", message: "Restore source" });
    const close = vi.fn();
    render(<ExportDialog config={config} onClose={close} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(screen.getByRole("alert").textContent).toContain("[OFFLINE_MEDIA]");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(api.getExport).not.toHaveBeenCalled();
  });

  it("does not display an earlier completion as success while a new start is unconfirmed", async () => {
    vi.mocked(api.startExport)
      .mockResolvedValueOnce({ ok: true, data: { state: "done", percent: 100, outputPath: "C:\\earlier.mp4" } })
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Response lost" });
    render(<ExportDialog config={config} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(screen.getByText("C:\\earlier.mp4")).toBeDefined();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export again" })));
    expect(screen.queryByText("C:\\earlier.mp4")).toBeNull();
    expect(screen.getByRole("button", { name: "Check export status" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("keeps an unexpected idle start response locked and ignores late reconciliation after unmount", async () => {
    vi.mocked(api.startExport).mockResolvedValue({ ok: true, data: { state: "idle", percent: 0 } });
    const close = vi.fn();
    const view = render(<ExportDialog config={config} onClose={close} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(screen.getByRole("alert").textContent).toContain("[BAD_RESPONSE]");
    const check = deferred<Awaited<ReturnType<typeof api.getExport>>>();
    vi.mocked(api.getExport).mockReturnValueOnce(check.promise);
    fireEvent.click(screen.getByRole("button", { name: "Check export status" }));
    view.unmount();
    const attemptId = vi.mocked(api.startExport).mock.calls[0]![1]!;
    await act(async () => check.resolve({ ok: true, data: { state: "done", percent: 100, attemptId } }));
    expect(close).not.toHaveBeenCalled();
    expect(api.startExport).toHaveBeenCalledTimes(1);
  });

  async function startRunning() {
    vi.mocked(api.startExport).mockResolvedValue({ ok: true, data: { state: "running", percent: 0 } });
    render(<ExportDialog config={config} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
  }

  it("never overlaps polls, displays coded failures and retries to a terminal result", async () => {
    vi.useFakeTimers();
    const poll = deferred<Awaited<ReturnType<typeof api.getExport>>>();
    vi.mocked(api.getExport).mockReturnValueOnce(poll.promise);
    await startRunning();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(api.getExport).toHaveBeenCalledTimes(1);
    await act(async () => poll.resolve({ ok: false, code: "UNREACHABLE", message: "Engine unavailable" }));
    expect(screen.getByRole("alert").textContent).toContain("[UNREACHABLE]");
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(api.getExport).toHaveBeenCalledTimes(1);
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "done", percent: 100, outputPath: "C:\\done.mp4" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry status check" })));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole("status").textContent).toContain("Export finished");
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(api.getExport).toHaveBeenCalledTimes(2);
  });

  describe("project close recovery", () => {
    async function openApp() {
      vi.mocked(api.openProject).mockResolvedValue({ ok: true, data: response });
      await act(async () => render(<App />));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Recent/ })));
    }

    it("locks navigation until close confirms success and suppresses duplicate close", async () => {
      const result = deferred<Awaited<ReturnType<typeof api.closeProject>>>();
      vi.mocked(api.closeProject).mockReturnValueOnce(result.promise);
      await openApp();
      fireEvent.click(screen.getByRole("button", { name: /Projects/ }));
      fireEvent.click(screen.getByRole("button", { name: /Projects/ }));
      expect(api.closeProject).toHaveBeenCalledTimes(1);
      expect(api.closeProject).toHaveBeenCalledWith(expect.anything(), { id: response.project.id, folder: response.folder });
      expect(screen.getByRole("dialog", { name: "Close project" })).toBeDefined();
      await userEvent.setup().keyboard("{Escape}");
      expect(screen.queryByRole("button", { name: "Create new project" })).toBeNull();
      await act(async () => result.resolve({ ok: true, data: { ok: true } }));
      expect(screen.getByRole("button", { name: "Create new project" })).toBeDefined();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("requires successful authoritative checking before retrying close, including post-commit failure", async () => {
      vi.mocked(api.closeProject).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out" });
      vi.mocked(api.getProject)
        .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Unavailable" })
        .mockResolvedValueOnce({ ok: false, code: "NO_PROJECT", message: "No project open" });
      await openApp();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Projects/ })));
      expect(screen.getByRole("alert").textContent).toContain("[REQUEST_TIMEOUT]");
      expect(screen.queryByRole("button", { name: "Retry close" })).toBeNull();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project status" })));
      expect(screen.getByRole("alert").textContent).toContain("[UNREACHABLE]");
      expect(screen.queryByRole("button", { name: "Retry close" })).toBeNull();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project status" })));
      expect(screen.getByRole("alert").textContent).toContain("cleanup was not confirmed");
      vi.mocked(api.closeProject).mockResolvedValueOnce({ ok: true, data: { ok: true } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry close" })));
      expect(api.closeProject).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: "Create new project" })).toBeDefined();
    });

    it("allows retry for the same project but adopts a different project without closing it", async () => {
      vi.mocked(api.closeProject).mockResolvedValue({ ok: false, code: "CLOSE_FAILED", message: "Failed" });
      vi.mocked(api.getProject).mockResolvedValueOnce({ ok: true, data: response });
      await openApp();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Projects/ })));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project status" })));
      expect(screen.getByRole("button", { name: "Retry close" })).toBeDefined();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry close" })));
      const other = { ...response, folder: "C:\\Other", project: { ...response.project, id: "other", name: "Other" } };
      vi.mocked(api.getProject).mockResolvedValueOnce({ ok: true, data: other });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check project status" })));
      expect(screen.queryByRole("button", { name: "Retry close" })).toBeNull();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Use active project" })));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByText("Other", { selector: "strong" })).toBeDefined();
      expect(screen.getByText(/\[PROJECT_RECONCILED\]/)).toBeDefined();
      expect(api.closeProject).toHaveBeenCalledTimes(2);
    });
  });

  it("ignores a stale pre-cancel poll and waits for cleanup after cancellation acknowledgement", async () => {
    vi.useFakeTimers();
    const poll = deferred<Awaited<ReturnType<typeof api.getExport>>>();
    const cancel = deferred<Awaited<ReturnType<typeof api.cancelExport>>>();
    vi.mocked(api.getExport).mockReturnValueOnce(poll.promise);
    vi.mocked(api.cancelExport).mockReturnValueOnce(cancel.promise);
    await startRunning();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    fireEvent.click(screen.getByRole("button", { name: "Requesting cancellation..." }));
    expect(api.cancelExport).toHaveBeenCalledTimes(1);
    await act(async () => cancel.resolve({ ok: true, data: { state: "running", percent: 20 } }));
    expect(screen.getByRole("status").textContent).toContain("cleanup");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await act(async () => poll.resolve({ ok: true, data: { state: "done", percent: 100, outputPath: "C:\\obsolete.mp4" } }));
    expect(screen.queryByText(/obsolete/)).toBeNull();
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "cancelled", percent: 0 } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole("status").textContent).toContain("Export cancelled");
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  });

  it("surfaces cancel rejection, guards duplicates and keeps checking authoritative state", async () => {
    vi.useFakeTimers();
    vi.mocked(api.cancelExport).mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine unavailable" });
    await startRunning();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel export" })));
    expect(screen.getByRole("alert").textContent).toContain("[UNREACHABLE]");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "done", percent: 100, outputPath: "C:\\done.mp4" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole("status").textContent).toContain("Export finished");
  });

  it("stops polling after unmount even with a late response", async () => {
    vi.useFakeTimers();
    const poll = deferred<Awaited<ReturnType<typeof api.getExport>>>();
    vi.mocked(api.getExport).mockReturnValueOnce(poll.promise);
    await startRunning();
    await act(async () => vi.advanceTimersByTimeAsync(500));
    cleanup();
    await act(async () => poll.resolve({ ok: true, data: { state: "running", percent: 30 } }));
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(api.getExport).toHaveBeenCalledTimes(1);
  });

  it("locks start/close during preflight, blocks duplicate start and unlocks on failure", async () => {
    const start = deferred<Awaited<ReturnType<typeof api.startExport>>>();
    vi.mocked(api.startExport).mockReturnValue(start.promise);
    const close = vi.fn();
    render(<ExportDialog config={config} onClose={close} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start export" }));
    fireEvent.click(screen.getByRole("button", { name: "Start export" }));
    expect(api.startExport).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    await act(async () => start.resolve({ ok: false, code: "OFFLINE_MEDIA", message: "Restore source" }));
    expect(screen.getByRole("alert").textContent).toContain("Restore source");
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps running export nondismissible and restores usable focus when controls change", async () => {
    vi.mocked(api.startExport).mockResolvedValue({ ok: true, data: { state: "running", percent: 0 } });
    vi.mocked(api.cancelExport).mockResolvedValue({ ok: true, data: { state: "cancelled", percent: 0 } });
    const close = vi.fn();
    render(<ExportDialog config={config} onClose={close} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Start export" }));
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel export" }));
    await user.keyboard("{Escape}");
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel export" }));
    expect(screen.getByRole("status").textContent).toContain("cancelled");
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("prevents actual editor edit/play shortcuts behind export and restores them after close", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    project.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true },
    ] }];
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: true, data: { project, inverse: [] } });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const user = userEvent.setup();
    const content = document.querySelector<HTMLElement>(".tl-content")!;
    content.setPointerCapture = vi.fn();
    fireEvent.pointerDown(content.querySelector("[data-clip-id]")!, { button: 0, clientX: 40, pointerId: 1 });
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(window, { key: "s", code: "KeyS" });
    fireEvent.keyDown(window, { key: "Delete", code: "Delete" });
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    await user.keyboard("s{Delete}");
    expect(api.sendCommands).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play" })).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Export" }));
    await user.keyboard("s");
    await waitFor(() => expect(api.sendCommands).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.sendCommands).mock.calls[0]![1][0]).toMatchObject({ type: "SplitClip", clipId: "c" });
    await user.keyboard("{Delete}");
    await waitFor(() => expect(api.sendCommands).toHaveBeenCalledTimes(2));
  });
});
