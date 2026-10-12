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

vi.mock("../projectApi.js", () => ({
  createProject: vi.fn(), getDefaultFolder: vi.fn(), listRecent: vi.fn(), openProject: vi.fn(),
  getMediaStatus: vi.fn(), getProject: vi.fn(), sendCommands: vi.fn(),
  startExport: vi.fn(), getExport: vi.fn(), cancelExport: vi.fn(),
}));
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
  vi.restoreAllMocks();
  bridge(undefined);
});

describe("shared modal input policy", () => {
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
    expect(api.openProject).toHaveBeenCalledExactlyOnceWith(config, "C:\\Chosen");
    await act(async () => opened.resolve({ ok: false, code: "CORRUPT", message: "No usable backup" }));
    expect(screen.getByRole("alert").textContent).toContain("[CORRUPT]");
    expect((screen.getByRole("button", { name: "Create new project" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("export dialog input isolation", () => {
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
