// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, ProjectResponse } from "@ve/schema";
import { applyCommands, createEmptyProject } from "@ve/timeline-core";
import type { HealthResult } from "../engine.js";
import type { DesktopBridge } from "../desktop.js";
import * as api from "../projectApi.js";
import { Modal } from "./Modal.js";
import { NewProjectDialog } from "./NewProjectDialog.js";
import { Landing } from "./Landing.js";
import { Editor } from "./Editor.js";
import { ExportDialog as ExportDialogComponent } from "./ExportDialog.js";
import { App } from "../App.js";
import { DEFAULT_ZOOM, pxToFrame } from "../timelineMath.js";
import { ASSET_DRAG_TYPE } from "../assets.js";

const proxyHook = vi.hoisted(() => ({ onDone: undefined as (() => void) | undefined,
  refresh: vi.fn<() => Promise<boolean>>() }));

vi.mock("../projectApi.js", async (importOriginal) => ({
  diagnosticMessage: (await importOriginal<typeof import("../projectApi.js")>()).diagnosticMessage,
  createProject: vi.fn(), getDefaultFolder: vi.fn(), listRecent: vi.fn(), openProject: vi.fn(),
  getMediaStatus: vi.fn(), getProxyStates: vi.fn(), getProject: vi.fn(), getProjectOperation: vi.fn(), getCommandOperation: vi.fn(), sendCommands: vi.fn(),
  startExport: vi.fn(), getExport: vi.fn(), cancelExport: vi.fn(),
  closeProject: vi.fn(), importFiles: vi.fn(),
  updatePreviewJob: vi.fn(),
  getUnknownEditErrors: vi.fn(), recordUnknownEditError: vi.fn(),
}));
vi.mock("../useHealth.js", () => ({ useHealth: () => health }));
vi.mock("../useProxyStatus.js", () => ({
  useProxyStatus: (_config: unknown, onDone: () => void) => {
    proxyHook.onDone = onDone;
    return {
      states: new Map(), error: null, refreshing: false, refresh: proxyHook.refresh,
    };
  },
}));
vi.mock("./Preview.js", () => ({ Preview: () => <div>Preview fixture</div> }));

const config = { url: "http://engine", token: "test" };
const health: HealthResult = { state: "ok", health: { ok: true, version: "test", components: [] } };
const response: ProjectResponse = {
  folder: "C:\\Samples\\Demo", recoveredFromBackup: false,
  project: createEmptyProject({ id: "p", name: "Demo", fps: { num: 30, den: 1 }, width: 640, height: 360 }),
};
function ExportDialog(props: { config: typeof config; onClose: () => void }) {
  return <ExportDialogComponent {...props} projectSettings={response.project.settings} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function bridge(value: DesktopBridge | undefined) {
  Object.defineProperty(window, "veDesktop", { configurable: true, value });
}

function addAssetAction(assetName = "Video") {
  fireEvent.contextMenu(screen.getByRole("listitem", { name: assetName }));
  return screen.getByRole("menuitem", { name: `Add ${assetName} to timeline` });
}

beforeEach(() => {
  vi.resetAllMocks();
  proxyHook.refresh.mockResolvedValue(true);
  bridge(undefined);
  localStorage.clear();
  vi.mocked(api.getDefaultFolder).mockResolvedValue({ ok: true, data: { folder: "C:\\Samples" } });
  vi.mocked(api.listRecent).mockResolvedValue({ ok: true, data: { projects: [
    { folder: "C:\\Recent", name: "Recent", openedAt: "", exists: true },
  ] } });
  vi.mocked(api.getMediaStatus).mockResolvedValue({ ok: true, data: { projectId: response.project.id, offline: [] } });
  vi.mocked(api.getExport).mockResolvedValue({ ok: true, data: { state: "running", percent: 10 } });
  vi.mocked(api.getUnknownEditErrors).mockResolvedValue({ ok: true, data: { records: [], capacityReached: false } });
  vi.mocked(api.recordUnknownEditError).mockResolvedValue({ ok: true, data: { records: [], capacityReached: false } });
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
  it("saves caption UI edits through confirmed history without touching the selected media clip", async () => {
    let project = structuredClone(response.project);
    project.assets = [{
      id: "caption-media", name: "Caption still", kind: "image", mediaMode: "reference", sourcePath: "C:\\still.png",
      contentHash: "fixture", durationFrames: 90, fps: null, width: 640, height: 360, hasAudio: false, proxyPath: null,
    }];
    project.tracks = [{ id: "caption-track", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "caption-clip", assetId: "caption-media", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true,
    }] }];
    const originalTracks = structuredClone(project.tracks);
    vi.mocked(api.sendCommands).mockImplementation(async (_config, commands) => {
      const applied = applyCommands(project, commands);
      if (!applied.ok) throw new Error(applied.error.message);
      project = applied.project;
      return { ok: true, data: { project, inverse: applied.inverse } };
    });
    const view = render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const content = view.container.querySelector(".tl-content")!;
    Object.defineProperty(content, "setPointerCapture", { configurable: true, value: vi.fn() });
    fireEvent.pointerDown(view.container.querySelector(".tl-clip")!, { button: 0, clientX: 10, pointerId: 1 });
    fireEvent.pointerCancel(content);
    fireEvent.click(screen.getByRole("button", { name: "Expand captions" }));
    fireEvent.click(screen.getByRole("button", { name: "New caption at playhead" }));
    fireEvent.change(screen.getByLabelText("Caption text"), { target: { value: "Manual caption" } });
    expect(api.sendCommands).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole("form", { name: "Caption editor" }));
    await waitFor(() => expect(screen.getByText("1 cue")).toBeDefined());
    fireEvent.keyDown(screen.getByRole("button", { name: "Delete caption" }), { key: "Delete" });
    fireEvent.keyDown(screen.getByRole("button", { name: "Split caption" }), { key: "s" });
    expect(api.sendCommands).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByLabelText("Caption text"), { target: { value: "Edited caption" } });
    fireEvent.submit(screen.getByRole("form", { name: "Caption editor" }));
    await waitFor(() => expect(project.captionCues[0]?.text).toBe("Edited caption"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByLabelText("Caption text")).toHaveProperty("value", "Manual caption"));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(screen.getByLabelText("Caption text")).toHaveProperty("value", "Edited caption"));
    fireEvent.click(screen.getByRole("button", { name: "Delete caption" }));
    await waitFor(() => expect(screen.getByText("0 cues")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByText("1 cue")).toBeDefined());
    expect(project.tracks).toEqual(originalTracks);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByText(/This export will not include subtitles/)).toBeDefined();
  });
  it("applies crop through confirmed commands and Undo/Redo while preserving other clip edits", async () => {
    let project = structuredClone(response.project);
    project.assets = [{
      id: "crop-media", name: "Crop still", kind: "image", mediaMode: "reference", sourcePath: "C:\\still.png",
      contentHash: "fixture", durationFrames: 90, fps: null, width: 640, height: 360, hasAudio: false, proxyPath: null,
    }];
    project.tracks = [{ id: "crop-track", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "crop-clip", assetId: "crop-media", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true,
      transform: { x: 0.6, y: 0.4, scale: 0.8, opacity: 0.7 },
      zoom: { version: 1, startPercent: 0, endPercent: 100, startScale: 1, endScale: 2 },
    }] }];
    const original = structuredClone(project.tracks[0]!.clips[0]!);
    vi.mocked(api.sendCommands).mockImplementation(async (_config, commands) => {
      const applied = applyCommands(project, commands);
      if (!applied.ok) throw new Error(applied.error.message);
      project = applied.project;
      return { ok: true, data: { project, inverse: applied.inverse } };
    });
    const view = render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const timeline = view.container.querySelector(".tl-content")!;
    Object.defineProperty(timeline, "setPointerCapture", { configurable: true, value: vi.fn() });
    fireEvent.pointerDown(view.container.querySelector(".tl-clip")!, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerCancel(timeline);
    fireEvent.click(screen.getByText("Crop", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText("Crop left (%)"), { target: { value: "25" } });
    expect(api.sendCommands).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.submit(screen.getByRole("form", { name: "Clip crop" }));
    await waitFor(() => expect(project.tracks[0]!.clips[0]!.crop?.left).toBe(0.25));
    expect(screen.getByRole("button", { name: "Play" })).toBeDefined();
    expect(vi.mocked(api.sendCommands).mock.calls[0]![1]).toEqual([{ type: "SetClipCrop", clipId: "crop-clip",
      crop: { left: 0.25, top: 0, right: 0, bottom: 0 } }]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(project.tracks[0]!.clips[0]).toEqual(original));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(project.tracks[0]!.clips[0]!.crop?.left).toBe(0.25));
    expect(project.tracks[0]!.clips[0]).toMatchObject(original);
    fireEvent.click(screen.getByRole("button", { name: "Reset crop" }));
    await waitFor(() => expect(project.tracks[0]!.clips[0]).toEqual(original));
  });
  it("changes canvas aspect through confirmed history and updates export dimensions", async () => {
    let project = structuredClone(response.project);
    project.assets = [{
      id: "aspect-media", name: "Still", kind: "image", mediaMode: "reference", sourcePath: "C:\\still.png",
      contentHash: "fixture", durationFrames: 90, fps: null, width: 640, height: 360, hasAudio: false, proxyPath: null,
    }];
    project.tracks = [{ id: "aspect-track", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "aspect-clip", assetId: "aspect-media", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true,
    }] }];
    vi.mocked(api.sendCommands).mockImplementation(async (_config, commands) => {
      const applied = applyCommands(project, commands);
      if (!applied.ok) throw new Error(applied.error.message);
      project = applied.project;
      return { ok: true, data: { project, inverse: applied.inverse } };
    });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Canvas aspect ratio" }) as HTMLSelectElement;
    expect(select.value).toBe("16:9");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.change(select, { target: { value: "9:16" } });
    await waitFor(() => expect(select.value).toBe("9:16"));
    expect(screen.getByRole("button", { name: "Play" })).toBeDefined();
    expect(project.settings).toMatchObject({ width: 360, height: 640 });
    expect(vi.mocked(api.sendCommands).mock.calls[0]![1]).toEqual([{ type: "SetProjectCanvas", width: 360, height: 640 }]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(select.value).toBe("16:9"));
    expect(project.settings).toEqual(response.project.settings);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(select.value).toBe("9:16"));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(screen.getByLabelText("Export settings summary").textContent).toContain("360 x 640");
  });

  it("keeps canvas aspect unchanged while pending, blocks duplicate changes, and disables it while closing", async () => {
    const pending = deferred<Awaited<ReturnType<typeof api.sendCommands>>>();
    vi.mocked(api.sendCommands).mockReturnValue(pending.promise);
    const view = render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Canvas aspect ratio" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "1:1" } });
    expect(select.disabled).toBe(true);
    expect(select.value).toBe("16:9");
    fireEvent.change(select, { target: { value: "4:3" } });
    expect(api.sendCommands).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: false, code: "INVALID_CANVAS_SIZE", message: "Invalid size.", outcome: "not-applied" }));
    expect(select.value).toBe("16:9");
    expect(screen.getByText("This canvas size is not supported")).toBeDefined();
    view.rerender(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} importEnabled={false} />);
    expect(select.disabled).toBe(true);
  });

  it("steps with arrows without saving and leaves form controls, splitters and modals alone", () => {
    const project: Project = { ...response.project, assets: [{
      id: "step-media", name: "Step fixture", kind: "image", mediaMode: "reference", sourcePath: "C:\\step.png",
      contentHash: "fixture", durationFrames: 90, fps: null, width: 64, height: 64, hasAudio: false, proxyPath: null,
    }], tracks: [{ id: "step-track", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "step-clip", assetId: "step-media", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true,
    }] }] };
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const timecode = screen.getByLabelText("Playhead time");
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "Play" })).toBeDefined();
    expect(timecode.textContent).toBe("00:00:00:01");
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    expect(timecode.textContent).toBe("00:00:00:02");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(timecode.textContent).toBe("00:00:00:01");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Playback speed" }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize assets pane" }), { key: "ArrowRight" });
    expect(timecode.textContent).toBe("00:00:00:01");
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Help" }), { key: "ArrowLeft" });
    expect(timecode.textContent).toBe("00:00:00:01");
    fireEvent.click(screen.getByRole("button", { name: "Close help" }));
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(timecode.textContent).toBe("00:00:00:01");
    expect(api.sendCommands).not.toHaveBeenCalled();
  });

  it("opens Help from Projects even offline without starting project operations", () => {
    render(<Landing config={config} health={null} onOpened={vi.fn()} />);
    screen.getByRole("button", { name: "Help" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(screen.getByRole("dialog", { name: "Help" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close help" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Help" }));
    expect(api.openProject).not.toHaveBeenCalled();
    expect(api.sendCommands).not.toHaveBeenCalled();
  });

  it("opens editor Help without mutating the project and suppresses background edit/playback shortcuts", () => {
    const project: Project = { ...response.project, assets: [{
      id: "help-media", name: "Help fixture", kind: "image", mediaMode: "reference", sourcePath: "C:\\help.png",
      contentHash: "fixture", durationFrames: 900, fps: null, width: 64, height: 64, hasAudio: false, proxyPath: null,
    }], tracks: [{ id: "help-track", kind: "video", order: 0, muted: false, locked: false, clips: [{
      id: "help-clip", assetId: "help-media", timelineStart: 0, sourceIn: 0, sourceOut: 900, speed: 1, audioLinked: true,
    }] }] };
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    screen.getByRole("button", { name: "Help" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const dialog = screen.getByRole("dialog", { name: "Help" });
    for (const key of [" ", "s", "Delete", "z"]) {
      fireEvent.keyDown(dialog, { key, ctrlKey: key === "z" });
      fireEvent.keyDown(window, { key, ctrlKey: key === "z" });
    }
    expect(api.sendCommands).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close help" }));
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Help" }));
  });

  it("explains a confirmed rejection without locking editing, checking an absent receipt or recording a known error", async () => {
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "INVALID_REQUEST",
      message: "Invalid command list.", outcome: "not-applied" });
    render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    await screen.findByText("The editor could not send this edit");
    expect(screen.getByRole("alert").textContent).toContain("Restart the app");
    expect(screen.getByRole("alert").textContent).toContain("The edit was not applied");
    expect(screen.queryByRole("button", { name: "Check whether edit saved" })).toBeNull();
    expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(false);
    expect(api.getCommandOperation).not.toHaveBeenCalled();
    expect(api.recordUnknownEditError).not.toHaveBeenCalled();
    expect(screen.getByText("Autosaved")).toBeDefined();
  });

  it("records only sanitized unknown context and shows a persistent local development follow-up report", async () => {
    const diagnosticId = "00000000-0000-4000-8000-000000000022";
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "NEW_ENGINE_CASE",
      message: "Private C:\\Personal\\secret.mp4", outcome: "not-applied", diagnosticId });
    vi.mocked(api.getUnknownEditErrors).mockResolvedValue({ ok: true, data: { records: [{
      code: "NEW_ENGINE_CASE", stage: "submit", outcome: "not-applied", operation: "track-edit", diagnosticId,
      appVersion: "0.1.0", count: 1, fingerprint: "NEW_ENGINE_CASE:submit:not-applied:track-edit",
      firstSeen: "2026-11-03T11:00:00.000Z", lastSeen: "2026-11-03T11:00:00.000Z", task: "pending-catalog-update",
    }], capacityReached: false } });
    render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    await screen.findByText("This edit could not be applied");
    expect(api.recordUnknownEditError).toHaveBeenCalledExactlyOnceWith(config, {
      code: "NEW_ENGINE_CASE", stage: "submit", outcome: "not-applied", operation: "track-edit", diagnosticId,
    });
    expect(JSON.stringify(vi.mocked(api.recordUnknownEditError).mock.calls)).not.toContain("secret.mp4");
    fireEvent.click(screen.getByText("Development: unknown-error follow-ups", { selector: "summary" }));
    fireEvent.click(screen.getByRole("button", { name: "Load local follow-ups" }));
    const task = await screen.findByText(/Pending: investigate NEW_ENGINE_CASE/);
    fireEvent.click(task);
    const report = screen.getByRole("textbox", { name: "Development task report (select and copy)" }) as HTMLTextAreaElement;
    expect(report.value).toContain("pending-catalog-update");
    expect(report.value).not.toContain("Personal");
  });

  it("shows unknown-error recording failures without unlocking an unconfirmed edit or claiming it was recorded", async () => {
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "UNREACHABLE", message: "Offline." });
    vi.mocked(api.getCommandOperation).mockResolvedValue({ ok: true, data: {
      state: "unknown", attemptId: "00000000-0000-4000-8000-000000000022",
      error: { code: "NEW_ENGINE_CASE", message: "Not recorded." },
    } });
    vi.mocked(api.recordUnknownEditError).mockResolvedValue({ ok: false, code: "ERROR_INBOX_FULL", message: "Full." });
    render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    await screen.findByText(/This unknown error could not be recorded for development/, { selector: "p.error" });
    expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Retry edit" })).toBeNull();
    expect(api.sendCommands).toHaveBeenCalledOnce();
  });

  it("keeps a different-project result and failed review load locked without adopting it or resending", async () => {
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    vi.mocked(api.getCommandOperation).mockResolvedValue({ ok: true, data: {
      state: "done", attemptId: "00000000-0000-4000-8000-000000000022",
      response: { project: { ...response.project, id: "another" }, inverse: [] },
    } });
    vi.mocked(api.getProject).mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Offline." })
      .mockResolvedValueOnce({ ok: true, data: { ...response, folder: "C:\\Another" } });
    render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    await screen.findByText("A different project may now be open");
    fireEvent.click(screen.getByRole("button", { name: "Load saved project for review" }));
    await screen.findByText("The editor lost contact with the editing engine");
    fireEvent.click(screen.getByRole("button", { name: "Load saved project for review" }));
    await screen.findByText("A different project may now be open");
    expect(screen.queryByRole("button", { name: "I reviewed my last edit - continue editing" })).toBeNull();
    expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(true);
    expect(api.sendCommands).toHaveBeenCalledOnce();
  });

  it("edits selected clip properties with autosave history, reset, speed and persistent resizing beside the assistant", async () => {
    let project: Project = { ...structuredClone(response.project), assets: [{
      id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "fixture", durationFrames: 300, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null,
    }], tracks: [{ id: "track", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 90, speed: 1, audioLinked: true },
    ] }] };
    vi.mocked(api.sendCommands).mockImplementation(async (_config, commands) => {
      const applied = applyCommands(project, commands);
      if (!applied.ok) throw new Error(applied.error.message);
      project = applied.project;
      return { ok: true, data: { project, inverse: applied.inverse } };
    });
    const view = render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const pane = screen.getByRole("region", { name: "Clip properties" });
    expect(within(pane).getByText(/Select a timeline clip/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Hide assistant" }));
    expect(pane).toBeDefined();
    const separator = screen.getByRole("separator", { name: "Resize properties pane" });
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(JSON.parse(localStorage.getItem("ve.layout.v1")!).propertiesWidth).toBe(290);
    fireEvent.click(screen.getByRole("button", { name: "Show assistant" }));
    expect(screen.getByRole("region", { name: "AI Assistant" })).toBeDefined();
    expect(view.container.querySelector(".upper")!.children[4]).toBe(pane);
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    try {
      const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 180 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      fireEvent(view.container.querySelector('[data-clip-id="c"]')!, event);
      fireEvent.click(within(pane).getByText("Appearance", { selector: "summary" }));
      fireEvent.change(within(pane).getByRole("spinbutton", { name: "Zoom (%)" }), { target: { value: "150" } });
      fireEvent.submit(within(pane).getByRole("form", { name: "Clip appearance" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.transform?.scale).toBe(1.5));
      await waitFor(() => expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.transform).toBeUndefined());
      await waitFor(() => expect(screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled")).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.transform?.scale).toBe(1.5));
      await waitFor(() => expect(pane.querySelector("fieldset")?.disabled).toBe(false));
      fireEvent.click(within(pane).getByText("Appearance", { selector: "summary" }));
      fireEvent.click(within(pane).getByRole("button", { name: "Reset appearance" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.transform).toBeUndefined());
      await waitFor(() => expect(pane.querySelector("fieldset")?.disabled).toBe(false));
      fireEvent.change(within(pane).getByRole("spinbutton", { name: "Clip speed (x)" }), { target: { value: "2" } });
      fireEvent.submit(within(pane).getByRole("form", { name: "Clip speed" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.speed).toBe(2));
      await waitFor(() => expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.speed).toBe(1));
      await waitFor(() => expect(screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled")).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.speed).toBe(2));
      await waitFor(() => expect(pane.querySelector("fieldset")?.disabled).toBe(false));
      fireEvent.click(within(pane).getByText("Animations", { selector: "summary" }));
      fireEvent.change(within(pane).getByRole("combobox", { name: "Entrance animation" }), { target: { value: "entrance.zoom" } });
      fireEvent.change(within(pane).getByRole("combobox", { name: "Exit animation" }), { target: { value: "exit.fade" } });
      fireEvent.submit(within(pane).getByRole("form", { name: "Clip animations" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.animations).toEqual({
        entrance: { id: "entrance.zoom", version: 1, durationPercent: 33 },
        exit: { id: "exit.fade", version: 1, durationPercent: 33 },
      }));
      await waitFor(() => expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.animations).toBeUndefined());
      await waitFor(() => expect(screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled")).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Redo" }));
      await waitFor(() => expect(project.tracks[0]!.clips[0]!.animations?.exit?.id).toBe("exit.fade"));
      await waitFor(() => expect(pane.querySelector("fieldset")?.disabled).toBe(false));
      fireEvent.click(screen.getByRole("button", { name: "Lock track" }));
      await waitFor(() => expect(within(pane).getByText(/Unlock this track/)).toBeDefined());
      expect(pane.querySelector("fieldset")?.disabled).toBe(true);
    } finally { delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture; }
  });

  it("requests optimization for the current asset/project only on demand and prevents duplicate clicks", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 10800 * 30, fps: { num: 30, den: 1 }, width: 3840, height: 2160,
      hasAudio: false, proxyPath: null }];
    const pending = deferred<Awaited<ReturnType<typeof api.updatePreviewJob>>>();
    vi.mocked(api.updatePreviewJob).mockReturnValue(pending.promise);
    vi.mocked(api.getProject).mockResolvedValue({ ok: true, data: { ...response, project } });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    expect(api.updatePreviewJob).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByRole("listitem", { name: "Video" }));
    const prepare = screen.getByRole("menuitem", { name: "Prepare optimized preview" });
    fireEvent.click(prepare);
    fireEvent.click(prepare);
    expect(api.updatePreviewJob).toHaveBeenCalledExactlyOnceWith(config, {
      assetId: "a", action: "prepare", expectedProject: { id: project.id, folder: response.folder },
    });
    expect(screen.getByText(/Updating preview preparation/)).toBeDefined();
    await act(async () => pending.resolve({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." }));
    expect(screen.getByRole("alert").textContent).toContain("Refresh preview status before");
    expect(api.updatePreviewJob).toHaveBeenCalledOnce();
    expect(api.getProject).toHaveBeenCalledWith(config);
  });

  it("explains disabled controls while a normal edit is saving without presenting it as an error", async () => {
    const result = deferred<Awaited<ReturnType<typeof api.sendCommands>>>();
    vi.mocked(api.sendCommands).mockReturnValue(result.promise);
    render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    expect(screen.getByText(/Saving your edit\./).closest('[role="status"]')?.className).toBe("muted");
    expect(screen.queryByText(/Command outcome is unresolved/)).toBeNull();
    expect(screen.getByText("Resolve the pending edit using the recovery controls before importing or changing assets.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Undo" }).title).toBe("Resolve the pending edit before using Undo");
    expect(screen.getByRole("button", { name: "Add visual track" }).hasAttribute("disabled")).toBe(true);
    const applied = applyCommands(response.project, vi.mocked(api.sendCommands).mock.calls[0]![1]);
    if (!applied.ok) throw new Error(applied.error.message);
    await act(async () => result.resolve({ ok: true, data: { project: applied.project, inverse: applied.inverse } }));
    expect(screen.queryByText(/Saving your edit\./)).toBeNull();
    expect(screen.queryByText("Resolve the pending edit using the recovery controls before importing or changing assets.")).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps uncertain preview requests gated through failed status refresh without locking timeline edits", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360,
      hasAudio: false, proxyPath: null }];
    vi.mocked(api.updatePreviewJob).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    vi.mocked(api.getProject).mockResolvedValue({ ok: true, data: { ...response, project } });
    proxyHook.refresh.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.contextMenu(screen.getByRole("listitem", { name: "Video" }));
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Prepare optimized preview" })));
    expect(screen.getByRole("alert").textContent).toContain("preview job's result is unconfirmed");
    fireEvent.contextMenu(screen.getByRole("listitem", { name: "Video" }));
    const prepare = screen.getByRole("menuitem", { name: "Prepare optimized preview" });
    expect(prepare.hasAttribute("disabled")).toBe(true);
    fireEvent.click(prepare);
    expect(api.updatePreviewJob).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Add visual track" }).hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh preview status" })));
    expect(screen.getByRole("menuitem", { name: "Prepare optimized preview" }).hasAttribute("disabled")).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh preview status" })));
    expect(screen.getByRole("menuitem", { name: "Prepare optimized preview" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/New preview preparation and cancellation requests are paused/)).toBeNull();
    expect(api.updatePreviewJob).toHaveBeenCalledOnce();
    expect(api.recordUnknownEditError).not.toHaveBeenCalled();
  });

  it("renames and locks tracks through confirmed history with Undo and Redo", async () => {
    let project: Project = { ...response.project, tracks: [{
      id: "track", kind: "video" as const, order: 0, muted: false, locked: false, clips: [],
    }] };
    vi.mocked(api.sendCommands).mockImplementation(async (_config, commands) => {
      const applied = applyCommands(project, commands);
      if (!applied.ok) throw new Error(applied.error.message);
      project = applied.project;
      return { ok: true, data: { project, inverse: applied.inverse } };
    });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Select video track 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Track name" }), { target: { value: "B-roll" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename track" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Select video track 1" }).textContent).toBe("B-roll"));
    fireEvent.click(screen.getByRole("button", { name: "Lock track" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unlock track" })).toBeDefined());
    expect(project.tracks[0]).toMatchObject({ name: "B-roll", locked: true });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Lock track" })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Select video track 1" }).textContent).toBe("Video 1"));
    expect(project.tracks[0]).not.toHaveProperty("name");
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Select video track 1" }).textContent).toBe("B-roll"));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unlock track" })).toBeDefined());
    expect(project.tracks[0]).toMatchObject({ name: "B-roll", locked: true });
  });

  it("shows backup recovery persistently and only marks the recovered project saved after a confirmed edit", async () => {
    const result = deferred<Awaited<ReturnType<typeof api.sendCommands>>>();
    vi.mocked(api.sendCommands).mockReturnValue(result.promise);
    render(<Editor config={config} project={response.project} folder={response.folder}
      recoveredFromBackup health={health} onClose={vi.fn()} />);
    expect(screen.getByText("Backup loaded")).toBeDefined();
    expect(screen.getByText(/has not been saved to the main file yet/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    expect(screen.getByText("Saving…")).toBeDefined();
    expect(screen.queryByText("Autosaved")).toBeNull();
    const commands = vi.mocked(api.sendCommands).mock.calls[0]![1];
    const applied = applyCommands(response.project, commands);
    if (!applied.ok) throw new Error(applied.error.message);
    await act(async () => result.resolve({ ok: true, data: { project: applied.project, inverse: applied.inverse } }));
    expect(screen.getByText("Autosaved")).toBeDefined();
    expect(screen.getByText("Recovered from backup")).toBeDefined();
    expect(screen.getByText(/has now been autosaved to the main file/)).toBeDefined();
  });

  it("offers a single explicit retry for a confirmed failed save and records only the successful edit for Undo", async () => {
    vi.mocked(api.sendCommands).mockResolvedValueOnce({ ok: false, code: "SAVE_FAILED", message: "Disk full." });
    vi.mocked(api.getCommandOperation).mockResolvedValueOnce({ ok: true, data: {
      state: "failed", attemptId: "00000000-0000-4000-8000-000000000051",
      error: { code: "SAVE_FAILED", message: "Disk full." },
    } });
    vi.mocked(api.sendCommands).mockImplementationOnce(async (_config, commands) => {
      const applied = applyCommands(response.project, commands);
      if (!applied.ok) throw new Error(applied.error.message);
      return { ok: true, data: { project: applied.project, inverse: applied.inverse } };
    });
    render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    await waitFor(() => expect(screen.getByText("Save failed")).toBeDefined());
    expect(screen.getByRole("alert").textContent).toContain("The edit was not applied");
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(true);
    expect(api.sendCommands).toHaveBeenCalledOnce();
    const retry = await screen.findByRole("button", { name: "Retry edit" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("Autosaved")).toBeDefined());
    expect(api.sendCommands).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.sendCommands).mock.calls[1]![1]).toEqual(vi.mocked(api.sendCommands).mock.calls[0]![1]);
    expect(vi.mocked(api.sendCommands).mock.calls[1]![3]).not.toBe(vi.mocked(api.sendCommands).mock.calls[0]![3]);
    expect(screen.queryByRole("button", { name: "Retry edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps an unknown save unconfirmed without offering a mutation retry", async () => {
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    vi.mocked(api.getCommandOperation).mockResolvedValue({ ok: false, code: "UNREACHABLE", message: "Offline." });
    render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    await waitFor(() => expect(screen.getByText("Save unconfirmed")).toBeDefined());
    expect(screen.queryByText("Save failed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(true);
    expect(api.sendCommands).toHaveBeenCalledOnce();
  });

  it.each(["SAVE_FAILED", "SAVE_CLEANUP_FAILED"])("offers retry only after a later status check confirms %s", async (code) => {
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    vi.mocked(api.getCommandOperation).mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Offline." })
      .mockResolvedValueOnce({ ok: true, data: { state: "failed",
        attemptId: "00000000-0000-4000-8000-000000000051", error: { code, message: "Could not write project." } } });
    render(<Editor config={config} project={response.project} folder={response.folder}
      recoveredFromBackup health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    await waitFor(() => expect(screen.getByText("Save unconfirmed")).toBeDefined());
    expect(screen.queryByRole("button", { name: "Retry edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check whether edit saved" }));
    await waitFor(() => expect(screen.getByText("Save failed")).toBeDefined());
    expect(screen.getByRole("button", { name: "Retry edit" })).toBeDefined();
    expect(screen.getByText(/has not been saved to the main file yet/)).toBeDefined();
    expect(api.sendCommands).toHaveBeenCalledOnce();
    expect(vi.mocked(api.getCommandOperation).mock.calls[0]![1])
      .toBe(vi.mocked(api.getCommandOperation).mock.calls[1]![1]);
  });

  it("does not label a rejected edit as a failed save", async () => {
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "Track missing." });
    vi.mocked(api.getCommandOperation).mockResolvedValue({ ok: true, data: {
      state: "failed", attemptId: "00000000-0000-4000-8000-000000000051",
      error: { code: "NOT_FOUND", message: "Track missing." },
    } });
    render(<Editor config={config} project={response.project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add visual track" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("The edit was not applied"));
    expect(screen.getByText("Autosaved")).toBeDefined();
    expect(screen.queryByText("Save failed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry edit" })).toBeNull();
  });

  it("relinks offline media through confirmed commands and refreshes offline status", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Missing\\Video.mp4",
      contentHash: "hash", durationFrames: 120, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    let relinked = false;
    vi.mocked(api.getMediaStatus).mockImplementation(async () => ({
      ok: true, data: { projectId: project.id, offline: relinked ? [] : [
        { assetId: "a", name: "Video", path: project.assets[0]!.sourcePath },
      ] },
    }));
    vi.mocked(api.sendCommands).mockImplementation(async (_config, commands) => {
      expect(commands).toEqual([{ type: "RelinkAsset", assetId: "a", sourcePath: "C:\\Relocated\\Video.mp4" }]);
      const result = applyCommands(project, commands);
      if (!result.ok) throw new Error(result.error.message);
      relinked = true;
      return { ok: true, data: { project: result.project, inverse: result.inverse } };
    });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Offline")).toBeDefined());
    fireEvent.contextMenu(screen.getByRole("listitem", { name: "Video" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Relink Video" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Replacement path for Video" }), {
      target: { value: "C:\\Relocated\\Video.mp4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Relink Video" }));
    await waitFor(() => expect(screen.queryByText("Offline")).toBeNull());
    expect(api.sendCommands).toHaveBeenCalledOnce();
    expect(api.getMediaStatus).toHaveBeenCalledTimes(3);
  });

  it.each(["button", "drag"] as const)("adds an asset at the requested position and track via %s", async (method) => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 120, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    project.tracks = [
      { id: "base", kind: "video", order: 0, muted: false, locked: false, clips: [
        { id: "existing", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 120, speed: 1, audioLinked: true },
      ] },
      { id: "overlay", kind: "overlay", order: 1, muted: false, locked: false, clips: [
        { id: "neighbor", assetId: "a", timelineStart: 20, sourceIn: 10, sourceOut: 110, speed: 1, audioLinked: true },
      ] },
    ];
    let edited = project;
    vi.mocked(api.sendCommands).mockImplementation(async (_config, commands) => {
      const result = applyCommands(edited, commands);
      if (!result.ok) throw new Error(result.error.message);
      edited = result.project;
      return { ok: true, data: { project: edited, inverse: result.inverse } };
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => undefined });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const content = document.querySelector(".tl-content")!;
    fireEvent(content, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 220 }));
    fireEvent(content, new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 220 }));
    if (method === "button") {
      fireEvent.click(screen.getByRole("button", { name: "Select overlay track 1" }));
      fireEvent.click(addAssetAction());
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Select video track 2" }));
      const dataTransfer = { types: [ASSET_DRAG_TYPE], getData: () => "a" };
      const event = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 280 });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      fireEvent(document.querySelector('[data-track-id="overlay"]')!, event);
    }
    await waitFor(() => expect(api.sendCommands).toHaveBeenCalledOnce());
    const expectedFrame = pxToFrame((method === "button" ? 220 : 280) - 160, { num: 30, den: 1 }, DEFAULT_ZOOM);
    expect(vi.mocked(api.sendCommands).mock.calls[0]![1]).toMatchObject([{
      type: "AddClip", trackId: "overlay", clip: { timelineStart: expectedFrame }, ripple: true,
    }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false));
    expect(edited.tracks[1]!.clips.find((clip) => clip.id === "neighbor")).toMatchObject({
      timelineStart: expectedFrame + 120, sourceIn: 10, sourceOut: 110,
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled")).toBe(false));
    expect(edited).toEqual(project);
  });

  it("refreshes and retries asset placement when a stale track order is rejected", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    project.tracks = [{ id: "audio", kind: "audio", order: 0, muted: false, locked: false, clips: [] }];
    const authoritative = {
      ...project,
      tracks: [...project.tracks, { id: "visual", kind: "video" as const, order: 1, muted: false, locked: false, clips: [] }],
    };
    vi.mocked(api.getProject).mockResolvedValue({
      ok: true, data: { folder: response.folder, recoveredFromBackup: false, project: authoritative },
    });
    vi.mocked(api.getCommandOperation).mockResolvedValue({
      ok: true, data: {
        state: "failed",
        attemptId: "00000000-0000-4000-8000-000000000003",
        error: { code: "DUPLICATE_ORDER", message: "Track order 1 is already in use." },
      },
    });
    vi.mocked(api.sendCommands)
      .mockResolvedValueOnce({ ok: false, code: "COMMAND_FAILED", message: "Track order collision." })
      .mockImplementationOnce(async (_config, commands) => {
        expect(commands[0]).toMatchObject({ type: "AddTrack", track: { order: 2 } });
        const addTrack = commands.find((command) => command.type === "AddTrack");
        const addClip = commands.find((command) => command.type === "AddClip");
        if (addTrack?.type !== "AddTrack" || addClip?.type !== "AddClip") throw new Error("Expected track and clip additions.");
        const addedTrack = { ...addTrack.track, clips: [addClip.clip] };
        const updated = { ...authoritative, tracks: [...authoritative.tracks, addedTrack] };
        return {
          ok: true,
          data: {
            project: updated,
            inverse: [
              { type: "RemoveClip", clipId: addClip.clip.id },
              { type: "RemoveTrack", trackId: addTrack.track.id },
            ],
          },
        };
      });

    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    fireEvent.click(addAssetAction());
    await waitFor(() => expect(api.sendCommands).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" }).hasAttribute("disabled")).toBe(false));
    expect(api.getProject).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("undoes and redoes confirmed editor commands through engine inverses", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    const track = { id: "track", kind: "video" as const, order: 0, muted: false, locked: false, clips: [] };
    project.tracks = [track];
    let edited = project;
    let addedClip: (typeof project.tracks)[number]["clips"][number] | undefined;
    vi.mocked(api.sendCommands).mockImplementation(async (_config, commands) => {
      const command = commands[0]!;
      if (command.type === "AddClip") {
        addedClip = command.clip;
        edited = { ...project, tracks: [{ ...track, clips: [command.clip] }] };
        return { ok: true, data: { project: edited, inverse: [{ type: "RemoveClip", clipId: command.clip.id }] } };
      }
      if (command.type === "RemoveClip" && addedClip) {
        edited = project;
        return { ok: true, data: { project: edited, inverse: [{ type: "AddClip", trackId: track.id, clip: addedClip }] } };
      }
      throw new Error(`Unexpected history command: ${command.type}`);
    });

    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const undoButton = screen.getByRole("button", { name: "Undo" });
    const redoButton = screen.getByRole("button", { name: "Redo" });
    expect(undoButton.hasAttribute("disabled")).toBe(true);
    expect(redoButton.hasAttribute("disabled")).toBe(true);

    fireEvent.click(addAssetAction());
    await waitFor(() => expect(undoButton.hasAttribute("disabled")).toBe(false));
    fireEvent.click(undoButton);
    await waitFor(() => expect(redoButton.hasAttribute("disabled")).toBe(false));
    expect(api.sendCommands).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.sendCommands).mock.calls[1]![1]).toEqual([{ type: "RemoveClip", clipId: addedClip?.id }]);

    fireEvent.click(redoButton);
    await waitFor(() => expect(undoButton.hasAttribute("disabled")).toBe(false));
    expect(api.sendCommands).toHaveBeenCalledTimes(3);
    expect(vi.mocked(api.sendCommands).mock.calls[2]![1]).toEqual([
      { type: "AddClip", trackId: track.id, clip: addedClip },
    ]);
  });

  it("retains engine error codes and diagnostic IDs in actual editor command feedback", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Fixture video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Synthetic.mp4",
      contentHash: "synthetic", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    const diagnosticId = "00000000-0000-4000-8000-000000000001";
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "ENGINE_UNEXPECTED_ERROR",
      message: `Check status before retrying. Diagnostic ID: ${diagnosticId}` });
    vi.mocked(api.getCommandOperation).mockResolvedValue({
      ok: true, data: {
        state: "failed",
        attemptId: "00000000-0000-4000-8000-000000000002",
        error: { code: "ENGINE_UNEXPECTED_ERROR", message: "Check status before retrying.", diagnosticId },
      },
    });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    const addAction = addAssetAction("Fixture video");
    await act(async () => fireEvent.click(addAction));
    expect(screen.getByRole("alert").textContent).toContain("This edit could not be applied");
    expect(screen.getByRole("alert").textContent).toContain(`Diagnostic ID: ${diagnosticId}`);
    expect(api.sendCommands).toHaveBeenCalledTimes(1);
  });

  it("reconciles an ambiguous edit without resubmitting and unlocks only after confirmed completion", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    const committed = structuredClone(project);
    committed.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true },
    ] }];
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    vi.mocked(api.getCommandOperation).mockResolvedValue({
      ok: true, data: { state: "done", attemptId: "00000000-0000-4000-8000-000000000001", response: { project: committed, inverse: [] } },
    });
    vi.mocked(api.getCommandOperation).mockResolvedValueOnce({ ok: true, data: {
      state: "pending", attemptId: "00000000-0000-4000-8000-000000000001",
    } });
    const onClose = vi.fn();
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={onClose} />);
    fireEvent.click(addAssetAction());

    await waitFor(() => expect(screen.getByRole("button", { name: "Check whether edit saved" })).toBeDefined());
    await waitFor(() => expect(api.getCommandOperation).toHaveBeenCalledOnce());
    expect(addAssetAction().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(true);
    expect(api.sendCommands).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.sendCommands).mock.calls[0]![3]).toMatch(/^[0-9a-f-]{36}$/i);

    fireEvent.click(screen.getByRole("button", { name: "Check whether edit saved" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Check whether edit saved" })).toBeNull());
    expect(api.getCommandOperation).toHaveBeenCalledWith(config, vi.mocked(api.sendCommands).mock.calls[0]![3]);
    expect(addAssetAction().hasAttribute("disabled")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(api.sendCommands).toHaveBeenCalledTimes(1);
  });

  it("keeps an ambiguous edit locked after a failed status read and retries the same attempt", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    const committed = structuredClone(project);
    committed.tracks = [{ id: "t", kind: "video", order: 0, muted: false, locked: false, clips: [
      { id: "c", assetId: "a", timelineStart: 0, sourceIn: 0, sourceOut: 60, speed: 1, audioLinked: true },
    ] }];
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    vi.mocked(api.getCommandOperation)
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine offline." })
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine offline." })
      .mockResolvedValueOnce({
        ok: true, data: { state: "done", attemptId: "00000000-0000-4000-8000-000000000001",
          response: { project: committed, inverse: [] } },
      });
    const onClose = vi.fn();
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={onClose} />);
    fireEvent.click(addAssetAction());
    await waitFor(() => expect(screen.getByRole("button", { name: "Load saved project for review" })).toBeDefined());
    const attemptId = vi.mocked(api.sendCommands).mock.calls[0]![3]!;

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check whether edit saved" })));
    expect(screen.getByRole("alert").textContent).toContain("lost contact");
    expect(screen.getByRole("alert").textContent).toContain("do not yet know");
    expect(addAssetAction().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(true);
    expect(api.sendCommands).toHaveBeenCalledOnce();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check whether edit saved" })));
    expect(api.getCommandOperation).toHaveBeenNthCalledWith(3, config, attemptId);
    expect(addAssetAction().hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(false);
    expect(api.sendCommands).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("requires refreshed project state and explicit confirmation for an unknown edit outcome", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    vi.mocked(api.sendCommands).mockResolvedValue({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    const diagnosticId = "00000000-0000-4000-8000-000000000022";
    vi.mocked(api.getCommandOperation).mockResolvedValue({
      ok: true, data: { state: "unknown", attemptId: "00000000-0000-4000-8000-000000000001",
        error: { code: "ENGINE_UNEXPECTED_ERROR", message: "Outcome not recorded.", diagnosticId } },
    });
    vi.mocked(api.getProject).mockResolvedValue({ ok: true, data: { ...response, project } });
    const onClose = vi.fn();
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={onClose} />);
    fireEvent.click(addAssetAction());
    await waitFor(() => expect(screen.getByRole("button", { name: "Load saved project for review" })).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Check whether edit saved" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Load saved project for review" })).toBeDefined());
    expect(screen.getByRole("alert").textContent).toContain(`Diagnostic ID: ${diagnosticId}`);
    fireEvent.click(screen.getByRole("button", { name: "Load saved project for review" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "I reviewed my last edit - continue editing" })).toBeDefined());
    expect(api.sendCommands).toHaveBeenCalledTimes(1);

    expect(screen.getByText(/Undo\/Redo history was cleared/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "I reviewed my last edit - continue editing" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(false));
    expect(addAssetAction().hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "← Projects" }).hasAttribute("disabled")).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
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

  it("preserves a manually entered location when the default request resolves late", async () => {
    const defaults = deferred<Awaited<ReturnType<typeof api.getDefaultFolder>>>();
    vi.mocked(api.getDefaultFolder).mockReturnValue(defaults.promise);
    render(<NewProjectDialog config={config} onCancel={vi.fn()} onCreated={vi.fn()} />);
    const location = screen.getByLabelText("Location") as HTMLInputElement;
    await userEvent.setup().type(location, "C:\\Chosen");
    await act(async () => defaults.resolve({ ok: true, data: { folder: "C:\\Default" } }));
    expect(location.value).toBe("C:\\Chosen");
  });

  it("ignores an older default-folder response after engine configuration changes", async () => {
    const oldDefault = deferred<Awaited<ReturnType<typeof api.getDefaultFolder>>>();
    vi.mocked(api.getDefaultFolder)
      .mockReturnValueOnce(oldDefault.promise)
      .mockResolvedValueOnce({ ok: true, data: { folder: "C:\\NewEngine" } });
    const view = render(<NewProjectDialog config={config} onCancel={vi.fn()} onCreated={vi.fn()} />);
    view.rerender(<NewProjectDialog config={{ url: "http://new-engine", token: "new-token" }}
      onCancel={vi.fn()} onCreated={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\NewEngine"));
    await act(async () => oldDefault.resolve({ ok: true, data: { folder: "C:\\OldEngine" } }));
    expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\NewEngine");
  });

  it("allows retry when the default project location request fails", async () => {
    vi.mocked(api.getDefaultFolder)
      .mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." })
      .mockResolvedValueOnce({ ok: true, data: { folder: "C:\\Recovered" } });
    render(<NewProjectDialog config={config} onCancel={vi.fn()} onCreated={vi.fn()} />);
    await screen.findByRole("button", { name: "Retry default location" });
    fireEvent.click(screen.getByRole("button", { name: "Retry default location" }));
    await waitFor(() => expect((screen.getByLabelText("Location") as HTMLInputElement).value).toBe("C:\\Recovered"));
    expect(api.getDefaultFolder).toHaveBeenCalledTimes(2);
  });

  it("allows retry when the recent-project list request fails", async () => {
    vi.mocked(api.listRecent)
      .mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." })
      .mockResolvedValueOnce({ ok: true, data: { projects: [
        { folder: "C:\\Recovered", name: "Recovered", openedAt: "", exists: true },
      ] } });
    render(<Landing config={config} health={health} onOpened={vi.fn()} />);
    await screen.findByRole("button", { name: "Retry recent projects" });
    fireEvent.click(screen.getByRole("button", { name: "Retry recent projects" }));
    await screen.findByRole("button", { name: /Recovered/ });
    expect(api.listRecent).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores an older recent-project response after engine configuration changes", async () => {
    const oldRecent = deferred<Awaited<ReturnType<typeof api.listRecent>>>();
    vi.mocked(api.listRecent)
      .mockReturnValueOnce(oldRecent.promise)
      .mockResolvedValueOnce({ ok: true, data: { projects: [
        { folder: "C:\\NewEngine", name: "New engine project", openedAt: "", exists: true },
      ] } });
    const view = render(<Landing config={config} health={health} onOpened={vi.fn()} />);
    await waitFor(() => expect(api.listRecent).toHaveBeenCalledTimes(1));
    view.rerender(<Landing config={{ url: "http://new-engine", token: "new-token" }} health={health} onOpened={vi.fn()} />);
    await screen.findByRole("button", { name: /New engine project/ });
    await act(async () => oldRecent.resolve({ ok: true, data: { projects: [
      { folder: "C:\\OldEngine", name: "Old engine project", openedAt: "", exists: true },
    ] } }));
    expect(screen.getByRole("button", { name: /New engine project/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Old engine project/ })).toBeNull();
  });

  it.each(["CORRUPT", "UNSUPPORTED_PROJECT_VERSION"])("locks landing navigation while choosing/opening, then unlocks on %s", async (code) => {
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
    await act(async () => opened.resolve({ ok: false, code, message: "Project cannot be opened" }));
    expect(screen.getByRole("alert").textContent).toContain(`[${code}]`);
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
  function exportAttemptId() { return vi.mocked(api.startExport).mock.calls.at(-1)![1]!; }
  function correlatedStart(data: import("@ve/schema").ExportState) {
    vi.mocked(api.startExport).mockImplementationOnce(async (_config, attemptId) => ({ ok: true, data: { ...data, attemptId } }));
  }
  it("shows diagnostic IDs for failed background export states", async () => {
    const diagnosticId = "00000000-0000-4000-8000-000000000023";
    correlatedStart({
      state: "failed", percent: 0, code: "EXPORT_CLEANUP_FAILED",
      message: "Export cleanup failed. Check engine diagnostics using the diagnostic ID.", diagnosticId,
    });
    render(<ExportDialog config={config} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(screen.getByRole("alert").textContent).toContain(`Diagnostic ID: ${diagnosticId}`);
  });

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

  it("explains busy export and only adopts an earlier job after an explicit status check", async () => {
    vi.mocked(api.startExport).mockResolvedValueOnce({ ok: false, code: "EXPORT_BUSY", message: "Earlier render settling" });
    const activeId = "00000000-0000-4000-8000-000000000033";
    vi.mocked(api.getExport)
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "offline" })
      .mockResolvedValueOnce({ ok: true, data: { state: "running", percent: 42, attemptId: activeId } });
    render(<ExportDialog config={config} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(screen.getByRole("alert").textContent).toContain("did not start a new render");
    expect(api.getExport).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check active export" })));
    expect(screen.getByRole("button", { name: "Check active export" })).toBeDefined();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check active export" })));
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("42");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(api.startExport).toHaveBeenCalledOnce();
    expect(api.recordUnknownEditError).not.toHaveBeenCalled();
  });

  it("rejects a mismatched immediate export result instead of showing an earlier completion", async () => {
    vi.mocked(api.startExport).mockResolvedValueOnce({ ok: true, data: { state: "done", percent: 100,
      attemptId: "00000000-0000-4000-8000-000000000033", outputPath: "C:\\earlier.mp4" } });
    render(<ExportDialog config={config} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(screen.queryByText("C:\\earlier.mp4")).toBeNull();
    expect(screen.getByRole("button", { name: "Check export status" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("BAD_RESPONSE");
    expect(api.startExport).toHaveBeenCalledOnce();
  });

  it("records unknown export failures without private details and exposes recording failure without unlocking", async () => {
    vi.mocked(api.startExport).mockResolvedValueOnce({ ok: false, code: "NEW_EXPORT_ERROR",
      message: "private token C:\\Secret\\output.mp4", diagnosticId: "00000000-0000-4000-8000-000000000022" });
    vi.mocked(api.recordUnknownEditError).mockResolvedValueOnce({ ok: false, code: "ERROR_INBOX_FULL", message: "Full" });
    render(<ExportDialog config={config} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(api.recordUnknownEditError).toHaveBeenCalledExactlyOnceWith(config, {
      code: "NEW_EXPORT_ERROR", stage: "submit", outcome: "unconfirmed", operation: "export-start",
      diagnosticId: "00000000-0000-4000-8000-000000000022",
    });
    expect(screen.getByText(/could not be recorded for development/)).toBeDefined();
    expect(screen.getByRole("alert", { name: "Export problem" }).querySelector("details")?.open).toBe(false);
    expect(screen.getByRole("alert", { name: "Export problem" }).querySelector("details")?.textContent).toContain("Secret");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(api.startExport).toHaveBeenCalledOnce();
  });

  it("uses a failed-render fallback and records generic background failures rather than guessing FFmpeg causes", async () => {
    correlatedStart({ state: "failed", percent: 0, code: "EXPORT_FAILED",
      message: "private C:\\Secret\\codec.mp4", diagnosticId: "00000000-0000-4000-8000-000000000022" });
    render(<ExportDialog config={config} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(screen.getByRole("alert").textContent).toContain("No verified finished file");
    expect(screen.getByRole("alert").textContent).not.toContain("edit was not applied");
    expect(api.recordUnknownEditError).toHaveBeenCalledExactlyOnceWith(config, {
      code: "EXPORT_FAILED", stage: "job", outcome: "failed", operation: "export",
      diagnosticId: "00000000-0000-4000-8000-000000000022",
    });
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  });

  it.each(["idle", "done"] as const)("keeps running export gated when polling returns a different or missing %s attempt", async (state) => {
    vi.useFakeTimers();
    await startRunning();
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state, percent: 0,
      ...(state === "done" ? { attemptId: "00000000-0000-4000-8000-000000000033", outputPath: "C:\\wrong.mp4" } : {}) } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole("alert").textContent).toContain("does not identify your export");
    expect(screen.queryByText("C:\\wrong.mp4")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel export" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Retry status check" })).toBeDefined();
    expect(api.startExport).toHaveBeenCalledOnce();
  });

  it("requires a matching status after lost cancellation before allowing another cancel", async () => {
    vi.useFakeTimers();
    await startRunning();
    vi.mocked(api.cancelExport).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "lost reply" });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel export" })));
    expect(screen.getByRole("button", { name: "Cancel export" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    expect(api.cancelExport).toHaveBeenCalledOnce();
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "offline" });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole("button", { name: "Cancel export" }).hasAttribute("disabled")).toBe(true);
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "running", percent: 60, attemptId: exportAttemptId() } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry status check" })));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(screen.getByRole("button", { name: "Cancel export" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.cancelExport).toHaveBeenCalledOnce();
    expect(api.startExport).toHaveBeenCalledOnce();
  });

  it("does not accept cancellation for a different attempt as successful cleanup", async () => {
    vi.useFakeTimers();
    await startRunning();
    vi.mocked(api.cancelExport).mockResolvedValueOnce({ ok: true, data: { state: "cancelled", percent: 0,
      attemptId: "00000000-0000-4000-8000-000000000033" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel export" })));
    expect(screen.queryByText(/engine finished cleanup/)).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel export" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    expect(api.cancelExport).toHaveBeenCalledOnce();
  });

  it("does not display an earlier completion as success while a new start is unconfirmed", async () => {
    correlatedStart({ state: "done", percent: 100, outputPath: "C:\\earlier.mp4" });
    vi.mocked(api.startExport).mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Response lost" });
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
    correlatedStart({ state: "running", percent: 0 });
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
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "done", percent: 100, outputPath: "C:\\done.mp4", attemptId: exportAttemptId() } });
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

    it("does not apply an old editor refresh after close and reopening the same project", async () => {
      const oldRefresh = deferred<Awaited<ReturnType<typeof api.getProject>>>();
      const staleProject = { ...response.project, name: "Stale prior editor state" };
      vi.mocked(api.getProject).mockReturnValueOnce(oldRefresh.promise);
      await openApp();
      await act(async () => proxyHook.onDone?.());
      expect(api.getProject).toHaveBeenCalledOnce();

      vi.mocked(api.closeProject).mockResolvedValueOnce({ ok: true, data: { ok: true } });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Projects/ })));
      expect(screen.getByRole("heading", { name: "Video Editor Prototype" })).toBeDefined();

      vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, data: response });
      await act(async () => fireEvent.click(screen.getByRole("button", { name: /Recent/ })));
      expect(screen.getByText("Demo")).toBeDefined();
      await act(async () => oldRefresh.resolve({
        ok: true, data: { folder: response.folder, project: staleProject, recoveredFromBackup: false },
      }));

      expect(screen.getByText("Demo")).toBeDefined();
      expect(screen.queryByText("Stale prior editor state")).toBeNull();
      expect(api.openProject).toHaveBeenCalledTimes(2);
    });

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
    await act(async () => cancel.resolve({ ok: true, data: { state: "running", percent: 20, attemptId: exportAttemptId() } }));
    expect(screen.getByRole("status").textContent).toContain("cleanup");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await act(async () => poll.resolve({ ok: true, data: { state: "done", percent: 100, outputPath: "C:\\obsolete.mp4" } }));
    expect(screen.queryByText(/obsolete/)).toBeNull();
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "cancelled", percent: 0, attemptId: exportAttemptId() } });
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
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "done", percent: 100, outputPath: "C:\\done.mp4", attemptId: exportAttemptId() } });
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
    correlatedStart({ state: "running", percent: 0 });
    vi.mocked(api.cancelExport).mockImplementation(async () => ({ ok: true, data: { state: "cancelled", percent: 0, attemptId: exportAttemptId() } }));
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
    Object.defineProperty(content, "setPointerCapture", { configurable: true, value: vi.fn() });
    // Track labels occupy the first 160px; seek to x=220 so the playhead is inside the clip and Split is valid.
    fireEvent(content, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 220 }));
    fireEvent(content, new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 220 }));
    fireEvent.pointerDown(content.querySelector("[data-clip-id]")!, { button: 0, clientX: 220, pointerId: 1 });
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

  it("surfaces and retries failed media-status refresh before updating offline badges", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    vi.mocked(api.getMediaStatus)
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine offline." })
      .mockResolvedValueOnce({ ok: true, data: { projectId: project.id, offline: [{ assetId: "a", name: "Video", path: "C:\\Video.mp4" }] } });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("[UNREACHABLE]"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh media status" }));
    await waitFor(() => expect(screen.getByText("Offline")).toBeDefined());
    expect(api.getMediaStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not apply offline status returned for another active project", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    vi.mocked(api.getMediaStatus).mockResolvedValueOnce({
      ok: true,
      data: { projectId: "another-project", offline: [{ assetId: "a", name: "Video", path: "C:\\Video.mp4" }] },
    });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("different project"));
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("ignores an offline snapshot for an older asset revision in the same project", async () => {
    const project = structuredClone(response.project);
    project.assets = [{ id: "a", name: "Video", kind: "video", mediaMode: "reference", sourcePath: "C:\\Video.mp4",
      contentHash: "old-hash", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360, hasAudio: false, proxyPath: null }];
    const oldSnapshot = deferred<Awaited<ReturnType<typeof api.getMediaStatus>>>();
    const updatedProject = { ...project, assets: project.assets.map((asset) => ({ ...asset, contentHash: "new-hash" })) };
    vi.mocked(api.getMediaStatus)
      .mockReturnValueOnce(oldSnapshot.promise)
      .mockResolvedValueOnce({ ok: true, data: { projectId: project.id, offline: [] } });
    vi.mocked(api.importFiles).mockResolvedValueOnce({
      ok: true,
      data: { project: updatedProject, imported: [{ assetId: "a", name: "Video" }], failed: [] },
    });
    bridge({ pickMedia: vi.fn().mockResolvedValue(["C:\\Video.mp4"]) });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    await waitFor(() => expect(api.getMediaStatus).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Import media" }));
    await waitFor(() => expect(api.getMediaStatus).toHaveBeenCalledTimes(2));
    await act(async () => oldSnapshot.resolve({
      ok: true,
      data: { projectId: project.id, offline: [{ assetId: "a", name: "Video", path: "C:\\Video.mp4" }] },
    }));
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("shows failed authoritative project refresh and adopts state only after retry succeeds", async () => {
    const project = structuredClone(response.project);
    const refreshedProject = { ...project, name: "Refreshed project" };
    vi.mocked(api.getProject)
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine offline." })
      .mockResolvedValueOnce({
        ok: true, data: { folder: response.folder, project: refreshedProject, recoveredFromBackup: false },
      });
    render(<Editor config={config} project={project} folder={response.folder} health={health} onClose={vi.fn()} />);
    await act(async () => proxyHook.onDone?.());
    expect((await screen.findByRole("alert")).textContent).toContain("[UNREACHABLE]");
    expect(screen.getByText("Demo")).toBeDefined();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh project" })));
    expect(await screen.findByText("Refreshed project")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.getProject).toHaveBeenCalledTimes(2);
  });
});
