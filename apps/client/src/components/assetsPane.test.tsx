// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@ve/timeline-core";
import type { Asset } from "@ve/schema";
import type { DesktopBridge } from "../desktop.js";
import { getImportOperation, getProject, importFiles, recordUnknownEditError } from "../projectApi.js";
import { AssetsPane } from "./AssetsPane.js";
import { ASSET_DRAG_TYPE } from "../assets.js";

vi.mock("../projectApi.js", () => ({
  diagnosticMessage: (error: { message: string; diagnosticId?: string }) =>
    `${error.message}${error.diagnosticId ? ` Diagnostic ID: ${error.diagnosticId}` : ""}`,
  getImportOperation: vi.fn(), getProject: vi.fn(), importFiles: vi.fn(), recordUnknownEditError: vi.fn(),
}));
const config = { url: "http://engine", token: "fixture" };
const project = createEmptyProject({ id: "p", name: "Fixture", fps: { num: 30, den: 1 }, width: 640, height: 360 });
const videoAsset: Asset = {
  id: "video", kind: "video", name: "video.mp4", mediaMode: "reference", sourcePath: "C:\\video.mp4",
  contentHash: "video", durationFrames: 60, fps: { num: 30, den: 1 }, width: 640, height: 360,
  hasAudio: false, proxyPath: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function bridge(value?: DesktopBridge) {
  Object.defineProperty(window, "veDesktop", { configurable: true, value });
}
const props = () => ({ config, project, proxyStates: new Map(), offline: new Set<string>(),
  onProject: vi.fn(), onAddToTimeline: vi.fn(), onRemoveAsset: vi.fn() });
const success = { ok: true as const, data: { project, imported: [], failed: [] } };

function assetAction(name: string, assetName = "video.mp4") {
  fireEvent.contextMenu(screen.getByRole("listitem", { name: assetName }), { clientX: 20, clientY: 20 });
  return screen.getByRole("menuitem", { name });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(recordUnknownEditError).mockResolvedValue({ ok: true, data: { records: [], capacityReached: false } });
  vi.mocked(getImportOperation).mockResolvedValue({ ok: false, code: "IMPORT_RECEIPT_MISSING", message: "Not found." });
  vi.mocked(getProject).mockResolvedValue({ ok: false, code: "NO_PROJECT", message: "No project." });
  bridge();
});
afterEach(() => { cleanup(); bridge(); });

describe("media picker and import ownership", () => {
  it("offers explicit prepare, cancel and retry without automatically requesting optimization", () => {
    const onPreviewJob = vi.fn();
    const p = { ...props(), project: { ...project, assets: [videoAsset] }, onPreviewJob };
    const view = render(<AssetsPane {...p} />);
    expect(onPreviewJob).not.toHaveBeenCalled();
    fireEvent.click(assetAction("Prepare optimized preview"));
    expect(onPreviewJob).toHaveBeenCalledExactlyOnceWith(videoAsset.id, "prepare");
    view.rerender(<AssetsPane {...p} proxyStates={new Map([[videoAsset.id,
      { assetId: videoAsset.id, state: "running", percent: 20 }]])} />);
    fireEvent.click(assetAction("Cancel preparation"));
    expect(onPreviewJob).toHaveBeenLastCalledWith(videoAsset.id, "cancel");
    view.rerender(<AssetsPane {...p} proxyStates={new Map([[videoAsset.id,
      { assetId: videoAsset.id, state: "cancelled", percent: 0 }]])} />);
    expect(screen.getByText("Optimization cancelled")).toBeDefined();
    expect(assetAction("Prepare optimized preview")).toBeDefined();
    view.rerender(<AssetsPane {...p} previewJobBusy proxyStates={new Map([[videoAsset.id,
      { assetId: videoAsset.id, state: "failed", percent: 0 }]])} />);
    expect((assetAction("Retry optimized preview") as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<AssetsPane {...p} project={{ ...project, assets: [{ ...videoAsset, proxyPath: "proxies/video.mp4" }] }} />);
    fireEvent.contextMenu(screen.getByRole("listitem", { name: videoAsset.name }));
    expect(screen.queryByRole("menuitem", { name: "Prepare optimized preview" })).toBeNull();
  });

  it("retries a failed thumbnail only through its right-click action", () => {
    const p = { ...props(), project: { ...project, assets: [{ ...videoAsset, proxyPath: "proxies/video.mp4" }] } };
    render(<AssetsPane {...p} />);
    const original = screen.getByLabelText("video.mp4 thumbnail");
    fireEvent.error(original);
    expect(screen.getByText("Thumbnail unavailable")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Retry thumbnail" })).toBeNull();
    fireEvent.click(assetAction("Retry thumbnail for video.mp4"));
    expect(screen.queryByText("Thumbnail unavailable")).toBeNull();
    const next = screen.getByLabelText("video.mp4 thumbnail");
    expect(next).not.toBe(original);
    expect(next.getAttribute("src")).toBe(original.getAttribute("src"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows failed preview guidance and explains disabled asset actions", () => {
    const message = "Encoder unavailable.";
    const diagnosticId = "00000000-0000-4000-8000-000000000075";
    render(<AssetsPane {...props()} project={{ ...project, assets: [videoAsset] }}
      enabled={false} mutationsDisabled disabledReason="Resolve the pending edit before importing."
      proxyStates={new Map([[videoAsset.id, { assetId: videoAsset.id, state: "failed", percent: 0, message, diagnosticId }]])} />);
    expect(screen.getByText("Resolve the pending edit before importing.")).toBeDefined();
    expect(screen.getByText("Optimization failed")).toBeDefined();
    expect(screen.queryByText("Preparing thumbnail...")).toBeNull();
    expect(screen.getByRole("alert").querySelector("details")?.textContent).toContain("Encoder unavailable.");
    expect(screen.getByRole("alert").querySelector("details")?.textContent).toContain(diagnosticId);
    expect(screen.getByRole("alert").querySelector("details")?.open).toBe(false);
  });

  it("distinguishes an active import from recovery and disables duplicate submission", async () => {
    const imported = deferred<Awaited<ReturnType<typeof importFiles>>>();
    vi.mocked(importFiles).mockReturnValue(imported.promise);
    const view = render(<AssetsPane {...props()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "File path" }), { target: { value: "C:\\New.mp4" } });
    fireEvent.submit(view.container.querySelector("form")!);
    expect(screen.getByRole("region", { name: "Assets" }).getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText(/Importing media\.\.\./)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Check import result" })).toBeNull();
    await act(async () => imported.resolve({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." }));
    expect(screen.getByRole("region", { name: "Assets" }).getAttribute("aria-busy")).toBe("false");
    expect(screen.getByRole("button", { name: "Check import result" })).toBeDefined();
  });

  it("reports import save progress and uncertainty, and confirms saving only after authoritative completion", async () => {
    const pending = deferred<Awaited<ReturnType<typeof importFiles>>>();
    vi.mocked(importFiles).mockReturnValue(pending.promise);
    const onSaveStatusChange = vi.fn(), onImportSaved = vi.fn();
    const view = render(<AssetsPane {...props()} onSaveStatusChange={onSaveStatusChange} onImportSaved={onImportSaved} />);
    fireEvent.change(screen.getByRole("textbox", { name: "File path" }), { target: { value: "C:\\New.mp4" } });
    fireEvent.submit(view.container.querySelector("form")!);
    expect(onSaveStatusChange).toHaveBeenLastCalledWith("saving");
    await act(async () => pending.resolve({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." }));
    expect(onSaveStatusChange).toHaveBeenLastCalledWith("unknown");
    expect(onImportSaved).not.toHaveBeenCalled();
    const attemptId = vi.mocked(importFiles).mock.calls[0]![1].attemptId!;
    vi.mocked(getImportOperation).mockResolvedValueOnce({ ok: true, data: { state: "pending", attemptId } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect(onSaveStatusChange).toHaveBeenLastCalledWith("saving");
    vi.mocked(getImportOperation).mockResolvedValueOnce({ ok: true, data: { state: "done", attemptId,
      response: { project: { ...project, assets: [videoAsset] }, imported: [{ assetId: videoAsset.id, name: videoAsset.name }], failed: [] } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect(onSaveStatusChange).toHaveBeenLastCalledWith(null);
    expect(onImportSaved).toHaveBeenCalledOnce();
    expect(importFiles).toHaveBeenCalledOnce();
  });

  it("does not claim a save when an import adds no assets", async () => {
    vi.mocked(importFiles).mockResolvedValue(success);
    const onImportSaved = vi.fn();
    const view = render(<AssetsPane {...props()} onImportSaved={onImportSaved} />);
    fireEvent.change(screen.getByRole("textbox", { name: "File path" }), { target: { value: "C:\\Duplicate.mp4" } });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(onImportSaved).not.toHaveBeenCalled();
  });

  it("shows image and video thumbnails without visible action buttons", () => {
    const image: Asset = { ...videoAsset, id: "image", name: "photo.png", kind: "image", proxyPath: null };
    const video = { ...videoAsset, proxyPath: "proxies/video.mp4" };
    render(<AssetsPane {...props()} project={{ ...project, assets: [image, video] }} />);
    expect(screen.getByRole("img", { name: "photo.png thumbnail" }).getAttribute("src"))
      .toBe("http://engine/media/image/source?token=fixture");
    const thumbnail = screen.getByLabelText("video.mp4 thumbnail") as HTMLVideoElement;
    expect(thumbnail.getAttribute("src")).toBe("http://engine/media/video/proxy?token=fixture");
    expect(thumbnail.muted).toBe(true);
    expect(thumbnail.controls).toBe(false);
    Object.defineProperty(thumbnail, "duration", { configurable: true, value: 2 });
    fireEvent.loadedMetadata(thumbnail);
    expect(thumbnail.currentTime).toBe(0.1);
    expect(screen.queryByRole("button", { name: "Add video.mp4 to timeline" })).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.error(thumbnail);
    expect(screen.getByRole("status").textContent).toBe("Thumbnail unavailable");
  });

  it("loads an original thumbnail immediately and avoids requesting offline or audio thumbnails", () => {
    const p = { ...props(), project: { ...project, assets: [videoAsset] } };
    const view = render(<AssetsPane {...p} />);
    expect(screen.getByLabelText("video.mp4 thumbnail").getAttribute("src")).toContain("/media/video/source");
    expect(screen.queryByText("Preparing thumbnail...")).toBeNull();
    view.rerender(<AssetsPane {...p} offline={new Set([videoAsset.id])} />);
    expect(screen.getByText("Offline media")).toBeDefined();
    expect(document.querySelector(".asset-thumbnail video")).toBeNull();
    view.rerender(<AssetsPane {...p} project={{ ...project, assets: [{ ...videoAsset, kind: "audio" }] }} />);
    expect(screen.getByLabelText("Audio file")).toBeDefined();
    expect(document.querySelector(".asset-thumbnail video, .asset-thumbnail img")).toBeNull();
  });

  it("supports keyboard menus, navigation, Escape and outside dismissal", () => {
    render(<AssetsPane {...props()} project={{ ...project, assets: [videoAsset] }} />);
    const card = screen.getByRole("listitem", { name: "video.mp4" });
    fireEvent.keyDown(card, { key: "F10", shiftKey: true });
    const add = screen.getByRole("menuitem", { name: "Add video.mp4 to timeline" });
    expect(document.activeElement).toBe(add);
    fireEvent.keyDown(add, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Retry thumbnail for video.mp4" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(card);
    assetAction("Remove video.mp4");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("targets the right-clicked asset, closes after acting and preserves mutation locks", () => {
    const other = { ...videoAsset, id: "other", name: "other.mp4" };
    const p = { ...props(), project: { ...project, assets: [videoAsset, other] } };
    const view = render(<AssetsPane {...p} />);
    fireEvent.click(assetAction("Add other.mp4 to timeline", "other.mp4"));
    expect(p.onAddToTimeline).toHaveBeenCalledExactlyOnceWith(other);
    expect(screen.queryByRole("menu")).toBeNull();
    view.rerender(<AssetsPane {...p} mutationsDisabled />);
    const remove = assetAction("Remove video.mp4") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    expect(p.onRemoveAsset).not.toHaveBeenCalled();
    expect((screen.getByRole("menuitem", { name: "Add video.mp4 to timeline" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("relinks an offline asset using a browser path and keeps online assets without a relink action", () => {
    const onRelinkAsset = vi.fn();
    const p = { ...props(), project: { ...project, assets: [videoAsset] }, offline: new Set([videoAsset.id]), onRelinkAsset };
    const view = render(<AssetsPane {...p} />);
    fireEvent.click(assetAction("Relink video.mp4"));
    fireEvent.change(screen.getByRole("textbox", { name: "Replacement path for video.mp4" }), {
      target: { value: "C:\\Relocated\\video.mp4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Relink video.mp4" }));
    expect(onRelinkAsset).toHaveBeenCalledExactlyOnceWith(videoAsset.id, "C:\\Relocated\\video.mp4");
    view.rerender(<AssetsPane {...p} offline={new Set()} />);
    expect(screen.queryByRole("button", { name: "Relink video.mp4" })).toBeNull();
  });

  it("uses the media picker for relinking and ignores a selection after the editor closes", async () => {
    const selection = deferred<string[]>();
    bridge({ pickMedia: vi.fn().mockReturnValue(selection.promise) });
    const onRelinkAsset = vi.fn();
    const p = { ...props(), project: { ...project, assets: [videoAsset] }, offline: new Set([videoAsset.id]), onRelinkAsset };
    const view = render(<AssetsPane {...p} />);
    fireEvent.click(assetAction("Relink video.mp4"));
    view.rerender(<AssetsPane {...p} enabled={false} />);
    await act(async () => selection.resolve(["C:\\Relocated\\video.mp4"]));
    expect(onRelinkAsset).not.toHaveBeenCalled();
  });

  it("submits a confirmed desktop relink selection and treats cancellation as a no-op", async () => {
    const pickMedia = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(["C:\\Relocated\\video.mp4"]);
    bridge({ pickMedia });
    const onRelinkAsset = vi.fn();
    render(<AssetsPane {...props()} project={{ ...project, assets: [videoAsset] }}
      offline={new Set([videoAsset.id])} onRelinkAsset={onRelinkAsset} />);
    const first = assetAction("Relink video.mp4");
    await act(async () => fireEvent.click(first));
    expect(onRelinkAsset).not.toHaveBeenCalled();
    const second = assetAction("Relink video.mp4");
    await act(async () => fireEvent.click(second));
    expect(pickMedia).toHaveBeenCalledWith("Locate original media");
    expect(onRelinkAsset).toHaveBeenCalledExactlyOnceWith(videoAsset.id, "C:\\Relocated\\video.mp4");
  });

  it("provides an asset ID for dragging and prevents offline or locked-editor drags", () => {
    const p = { ...props(), project: { ...project, assets: [videoAsset] }, onAssetDragStart: vi.fn() };
    const view = render(<AssetsPane {...p} />);
    const card = screen.getByText("video.mp4").closest("li")!;
    const dataTransfer = { setData: vi.fn(), effectAllowed: "none" };
    expect(card.draggable).toBe(true);
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(ASSET_DRAG_TYPE, videoAsset.id);
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(p.onAssetDragStart).toHaveBeenCalledOnce();
    dataTransfer.setData.mockClear();
    view.rerender(<AssetsPane {...p} offline={new Set([videoAsset.id])} />);
    expect(card.draggable).toBe(false);
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    view.rerender(<AssetsPane {...p} mutationsDisabled />);
    expect(card.draggable).toBe(false);
    fireEvent.dragStart(card, { dataTransfer });
    expect(dataTransfer.setData).not.toHaveBeenCalled();
  });

  it("removes unused assets on request and disables removal while a clip uses the asset", () => {
    const p = props();
    p.project = { ...project, assets: [videoAsset] };
    const view = render(<AssetsPane {...p} />);
    fireEvent.click(assetAction("Remove video.mp4"));
    expect(p.onRemoveAsset).toHaveBeenCalledExactlyOnceWith(videoAsset.id);

    p.project = {
      ...p.project,
      tracks: [{ id: "track", kind: "video", order: 0, muted: false, locked: false, clips: [
        { id: "clip", assetId: videoAsset.id, timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true },
      ] }],
    };
    view.rerender(<AssetsPane {...p} />);
    expect((assetAction("Remove video.mp4") as HTMLButtonElement).disabled).toBe(true);
    expect(p.onRemoveAsset).toHaveBeenCalledOnce();
  });

  it("offers audio assets for timeline placement", () => {
    const audio = {
      id: "music", kind: "audio" as const, name: "music.wav", mediaMode: "reference" as const,
      sourcePath: "C:\\music.wav", contentHash: "music", durationFrames: 2000, fps: { num: 1000, den: 1 },
      width: null, height: null, hasAudio: true, proxyPath: null,
    };
    const p = props();
    p.project = { ...project, assets: [audio] };
    render(<AssetsPane {...p} />);
    fireEvent.click(assetAction("Add music.wav to timeline", "music.wav"));
    expect(p.onAddToTimeline).toHaveBeenCalledExactlyOnceWith(audio);
  });

  it("shows picker rejection, sends no import and allows retry/cancel without an error", async () => {
    const pickMedia = vi.fn().mockRejectedValueOnce(new Error("IPC unavailable")).mockResolvedValueOnce([]);
    bridge({ pickMedia });
    render(<AssetsPane {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Import media" })));
    expect(screen.getByRole("alert").textContent).toContain("The file chooser could not open");
    expect(screen.getByRole("alert").querySelector("details")?.textContent).toContain("IPC unavailable");
    expect(screen.getByRole("alert").querySelector("details")?.open).toBe(false);
    expect(importFiles).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Import media" })));
    expect(pickMedia).toHaveBeenCalledTimes(2);
    expect(importFiles).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Import media" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("locks mode and duplicate input through picker/import and sends one request with captured mode", async () => {
    const picker = deferred<string[]>(), imported = deferred<Awaited<ReturnType<typeof importFiles>>>();
    const pickMedia = vi.fn().mockReturnValue(picker.promise);
    bridge({ pickMedia });
    vi.mocked(importFiles).mockReturnValue(imported.promise);
    const p = props();
    render(<AssetsPane {...p} />);
    fireEvent.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: "Import media" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(pickMedia).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("no import has started");
    await act(async () => picker.resolve(["C:\\Synthetic.mp4"]));
    expect(importFiles).toHaveBeenCalledOnce();
    expect(vi.mocked(importFiles).mock.calls[0]![1]).toMatchObject({ paths: ["C:\\Synthetic.mp4"], mode: "copy" });
    expect(vi.mocked(importFiles).mock.calls[0]![1].attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("does not cancel"))).toBe(true);
    await act(async () => imported.resolve(success));
    expect(p.onProject).toHaveBeenCalledExactlyOnceWith(project);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false);
  });

  it.each(["resolve", "reject"] as const)("discards a late picker %s after unmount without an import", async (outcome) => {
    const picker = deferred<string[]>();
    bridge({ pickMedia: vi.fn().mockReturnValue(picker.promise) });
    const p = props(), view = render(<AssetsPane {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Import media" }));
    view.unmount();
    await act(async () => {
      if (outcome === "resolve") picker.resolve(["C:\\Late.mp4"]);
      else picker.reject(new Error("Late picker rejection"));
    });
    expect(importFiles).not.toHaveBeenCalled();
    expect(p.onProject).not.toHaveBeenCalled();
  });

  it("invalidates an outstanding picker immediately when closing starts, even before unmount", async () => {
    const picker = deferred<string[]>();
    bridge({ pickMedia: vi.fn().mockReturnValue(picker.promise) });
    const p = props(), view = render(<AssetsPane {...p} enabled />);
    fireEvent.click(screen.getByRole("button", { name: "Import media" }));
    view.rerender(<AssetsPane {...p} enabled={false} />);
    await act(async () => picker.resolve(["C:\\Late.mp4"]));
    expect(importFiles).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Import media" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<AssetsPane {...p} enabled />);
    expect((screen.getByRole("button", { name: "Import media" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not transfer an old picker selection to another project or disturb its new pending picker", async () => {
    const first = deferred<string[]>(), second = deferred<string[]>();
    bridge({ pickMedia: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
    const p = props(), view = render(<AssetsPane {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Import media" }));
    const next = { ...p, project: { ...project, id: "other" } };
    view.rerender(<AssetsPane {...next} />);
    fireEvent.click(screen.getByRole("button", { name: "Import media" }));
    await act(async () => first.resolve(["C:\\Old.mp4"]));
    expect(importFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Choosing media..." })).toBeDefined();
    await act(async () => second.resolve([]));
    expect(screen.getByRole("button", { name: "Import media" })).toBeDefined();
  });

  it("ignores a sent import's late result after unmount without claiming the engine work was cancelled", async () => {
    bridge({ pickMedia: vi.fn().mockResolvedValue(["C:\\Synthetic.mp4"]) });
    const imported = deferred<Awaited<ReturnType<typeof importFiles>>>();
    vi.mocked(importFiles).mockReturnValue(imported.promise);
    const p = props(), view = render(<AssetsPane {...p} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Import media" })));
    expect(importFiles).toHaveBeenCalledTimes(1);
    view.unmount();
    await act(async () => imported.resolve(success));
    expect(p.onProject).not.toHaveBeenCalled();
  });

  it("preserves typed paths on coded batch/per-file failure and clears only confirmed success", async () => {
    const p = props(), view = render(<AssetsPane {...p} />);
    const input = screen.getByRole("textbox", { name: "File path" });
    fireEvent.change(input, { target: { value: "C:\\Retry.mp4" } });
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code: "IMPORT_FAILED", message: "Commit failed" })
      .mockResolvedValueOnce({ ok: true, data: { project, imported: [],
        failed: [{ path: "C:\\Retry.mp4", code: "IMPORT_FAILED", message: "Check engine diagnostics.", diagnosticId: "00000000-0000-4000-8000-000000000003" }] } })
      .mockResolvedValueOnce(success);
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(screen.getByRole("alert").textContent).toContain("Code: IMPORT_FAILED");
    expect((input as HTMLInputElement).value).toBe("C:\\Retry.mp4");
    expect((input as HTMLInputElement).disabled).toBe(true);
    const attemptId = vi.mocked(importFiles).mock.calls[0]![1].attemptId!;
    vi.mocked(getImportOperation).mockResolvedValueOnce({ ok: true, data: { state: "failed", attemptId,
      error: { code: "IMPORT_FAILED", message: "Commit failed" } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect((input as HTMLInputElement).disabled).toBe(false);
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(screen.getByRole("alert").textContent).toContain("Code: IMPORT_FAILED");
    expect(screen.getByRole("alert").textContent).toContain("Diagnostic ID: 00000000-0000-4000-8000-000000000003");
    expect((input as HTMLInputElement).value).toBe("C:\\Retry.mp4");
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("suppresses duplicate browser submits while keeping the path locked", async () => {
    const imported = deferred<Awaited<ReturnType<typeof importFiles>>>();
    vi.mocked(importFiles).mockReturnValue(imported.promise);
    const view = render(<AssetsPane {...props()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " C:\\Synthetic.mp4 " } });
    const form = view.container.querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(importFiles).toHaveBeenCalledOnce();
    expect(vi.mocked(importFiles).mock.calls[0]![1]).toMatchObject({ paths: ["C:\\Synthetic.mp4"], mode: "reference" });
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    await act(async () => imported.resolve(success));
  });

  it("explains partial results per file without suggesting a successful file be imported again", async () => {
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: true, data: {
      project: { ...project, assets: [videoAsset] }, imported: [{ assetId: videoAsset.id, name: videoAsset.name }],
      failed: [{ path: "C:\\Private\\missing.mp4", code: "FILE_NOT_FOUND", message: "source missing" },
        { path: "C:\\Private\\duplicate.mp4", code: "ALREADY_IMPORTED", message: "duplicate" }],
    } });
    const p = props(), saved = vi.fn(), view = render(<AssetsPane {...p} onImportSaved={saved} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:\\Batch.mp4" } });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(screen.getByRole("status").textContent).toContain("1 file(s) added to Assets; 2 file(s) not added");
    expect(screen.getByText("File: missing.mp4")).toBeDefined();
    expect(screen.getByText("This file is already in Assets")).toBeDefined();
    expect(screen.getAllByRole("alert").every((notice) => notice.textContent?.includes("This file was not added."))).toBe(true);
    expect(document.body.textContent).not.toContain("C:\\Private");
    expect(recordUnknownEditError).not.toHaveBeenCalled();
    expect(saved).toHaveBeenCalledOnce();
    expect(p.onProject).toHaveBeenCalledOnce();
  });

  it.each(["INVALID_REQUEST", "IMPORT_OPERATION_BUSY", "UNAUTHORIZED"])("explains a pre-execution %s rejection without uncertain recovery", async (code) => {
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code, message: "technical rejection" });
    const view = render(<AssetsPane {...props()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:\\file.mp4" } });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(screen.getByRole("alert").textContent).toContain("This import did not add assets");
    expect(screen.queryByRole("button", { name: "Check import result" })).toBeNull();
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(false);
    expect(recordUnknownEditError).not.toHaveBeenCalled();
    expect(getImportOperation).not.toHaveBeenCalled();
  });

  it("records only sanitized unknown import contexts and exposes recording failure without unlocking", async () => {
    const diagnosticId = "00000000-0000-4000-8000-000000000022";
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code: "NEW_IMPORT_ERROR",
      message: "private token and C:\\Private\\file.mp4", diagnosticId });
    vi.mocked(recordUnknownEditError).mockResolvedValueOnce({ ok: false, code: "ERROR_INBOX_FULL", message: "Full." });
    const view = render(<AssetsPane {...props()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:\\Private\\file.mp4" } });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(recordUnknownEditError).toHaveBeenCalledExactlyOnceWith(config, {
      code: "NEW_IMPORT_ERROR", stage: "submit", outcome: "unconfirmed", operation: "import", diagnosticId,
    });
    expect(screen.getByText(/could not be recorded for development/)).toBeDefined();
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect(importFiles).toHaveBeenCalledOnce();
  });

  it("records unknown file causes as file-only failures", async () => {
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: true, data: { ...success.data,
      failed: [{ path: "C:\\Private\\file.mp4", code: "IMPORT_FAILED", message: "A private underlying error" }] } });
    const view = render(<AssetsPane {...props()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:\\Private\\file.mp4" } });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(recordUnknownEditError).toHaveBeenCalledExactlyOnceWith(config, {
      code: "IMPORT_FAILED", stage: "file", outcome: "not-applied", operation: "import",
    });
    expect(screen.getByRole("alert").textContent).toContain("Other files in the selection may have imported successfully.");
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(false);
  });

  it("rejects a different project's initial import response without adopting it or allowing retry", async () => {
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: true, data: { ...success.data, project: { ...project, id: "other" } } });
    const p = props(), view = render(<AssetsPane {...p} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:\\file.mp4" } });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(p.onProject).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("The active project changed during import");
    expect(recordUnknownEditError).not.toHaveBeenCalled();
  });

  it("serializes review loading and refuses the same project ID from another folder", async () => {
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timeout" });
    const refresh = deferred<Awaited<ReturnType<typeof getProject>>>();
    vi.mocked(getProject).mockReturnValueOnce(refresh.promise);
    const p = props(), view = render(<AssetsPane {...p} projectFolder="C:\\Expected" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:\\file.mp4" } });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    fireEvent.click(screen.getByRole("button", { name: "Load Assets for review" }));
    expect(screen.queryByRole("button", { name: "Check import result" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I reviewed Assets - continue importing" })).toBeNull();
    await act(async () => refresh.resolve({ ok: true, data: { project, folder: "C:\\Other", recoveredFromBackup: false } }));
    expect(p.onProject).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    expect(getProject).toHaveBeenCalledOnce();
    expect(importFiles).toHaveBeenCalledOnce();
  });

  it("keeps a timed-out import locked until its status confirms success", async () => {
    const p = props(), view = render(<AssetsPane {...p} />);
    const input = screen.getByRole("textbox", { name: "File path" });
    fireEvent.change(input, { target: { value: "C:\\Uncertain.mp4" } });
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(importFiles).toHaveBeenCalledOnce();
    const attemptId = vi.mocked(importFiles).mock.calls[0]![1].attemptId!;
    vi.mocked(getImportOperation).mockResolvedValueOnce({ ok: true, data: { state: "done", attemptId,
      response: { ...success.data, imported: [{ assetId: "asset-1", name: "Uncertain.mp4" }] } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect(getImportOperation).toHaveBeenCalledExactlyOnceWith(config, attemptId);
    expect(p.onProject).toHaveBeenCalledExactlyOnceWith(project);
    expect((input as HTMLInputElement).value).toBe("");
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(importFiles).toHaveBeenCalledOnce();
  });

  it("keeps a timed-out import locked after a failed status read and retries the same attempt", async () => {
    const p = props(), view = render(<AssetsPane {...p} />);
    const input = screen.getByRole("textbox", { name: "File path" });
    fireEvent.change(input, { target: { value: "C:\\Uncertain.mp4" } });
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    const attemptId = vi.mocked(importFiles).mock.calls[0]![1].attemptId!;
    vi.mocked(getImportOperation)
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine offline." })
      .mockResolvedValueOnce({ ok: true, data: { state: "done", attemptId,
        response: { ...success.data, imported: [{ assetId: "asset-1", name: "Uncertain.mp4" }] } } });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect(screen.getByRole("alert").textContent).toContain("Code: UNREACHABLE");
    expect(screen.getByRole("alert").textContent).toContain("remains unconfirmed");
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(importFiles).toHaveBeenCalledOnce();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect(getImportOperation).toHaveBeenNthCalledWith(2, config, attemptId);
    expect(p.onProject).toHaveBeenCalledExactlyOnceWith(project);
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(importFiles).toHaveBeenCalledOnce();
  });

  it("unlocks a timed-out import only after status confirms failure", async () => {
    const view = render(<AssetsPane {...props()} />);
    const input = screen.getByRole("textbox", { name: "File path" });
    fireEvent.change(input, { target: { value: "C:\\Retry.mp4" } });
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Disconnected." });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    const attemptId = vi.mocked(importFiles).mock.calls[0]![1].attemptId!;
    vi.mocked(getImportOperation).mockResolvedValueOnce({ ok: true, data: { state: "failed", attemptId,
      error: { code: "IMPORT_FAILED", message: "Commit failed." } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect(screen.getByRole("alert").textContent).toContain("Code: IMPORT_FAILED");
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect((input as HTMLInputElement).value).toBe("C:\\Retry.mp4");
  });

  it("requires project refresh and explicit confirmation before retrying an unknown import", async () => {
    const p = props(), view = render(<AssetsPane {...p} />);
    const input = screen.getByRole("textbox", { name: "File path" });
    fireEvent.change(input, { target: { value: "C:\\Uncertain.mp4" } });
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    const diagnosticId = "00000000-0000-4000-8000-000000000024";
    vi.mocked(getImportOperation).mockResolvedValueOnce({ ok: true, data: { state: "unknown",
      attemptId: "00000000-0000-4000-8000-000000000001",
      error: { code: "ENGINE_UNEXPECTED_ERROR", message: "Outcome not recorded.", diagnosticId },
    } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect(screen.getByRole("alert").textContent).toContain(`Diagnostic ID: ${diagnosticId}`);
    expect((input as HTMLInputElement).disabled).toBe(true);
    vi.mocked(getProject).mockResolvedValueOnce({ ok: true, data: { folder: "C:\\Project", project,
      recoveredFromBackup: false } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load Assets for review" })));
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "I reviewed Assets - continue importing" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "I reviewed Assets - continue importing" }));
    expect((input as HTMLInputElement).disabled).toBe(false);
    expect(importFiles).toHaveBeenCalledOnce();
  });

  it("ignores an old status response after switching projects", async () => {
    const pending = deferred<Awaited<ReturnType<typeof getImportOperation>>>();
    const p = props(), view = render(<AssetsPane {...p} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:\\Uncertain.mp4" } });
    vi.mocked(importFiles).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "Timed out." });
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    vi.mocked(getImportOperation).mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "Check import result" }));
    const next = { ...p, project: { ...project, id: "other" } };
    view.rerender(<AssetsPane {...next} />);
    await act(async () => pending.resolve({ ok: true, data: { state: "done",
      attemptId: vi.mocked(importFiles).mock.calls[0]![1].attemptId!,
      response: { ...success.data, project } } }));
    expect(p.onProject).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Check import result" })).toBeNull();
  });

  it("preserves submitted import recovery when close temporarily disables the editor", async () => {
    const imported = deferred<Awaited<ReturnType<typeof importFiles>>>();
    vi.mocked(importFiles).mockReturnValueOnce(imported.promise);
    const p = props(), view = render(<AssetsPane {...p} enabled />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "C:\\Closing.mp4" } });
    fireEvent.submit(view.container.querySelector("form")!);
    const attemptId = vi.mocked(importFiles).mock.calls[0]![1].attemptId!;
    view.rerender(<AssetsPane {...p} enabled={false} />);
    await act(async () => imported.resolve(success));
    expect(p.onProject).not.toHaveBeenCalled();
    view.rerender(<AssetsPane {...p} enabled />);
    expect(screen.getByRole("button", { name: "Check import result" })).toBeDefined();
    vi.mocked(getImportOperation).mockResolvedValueOnce({ ok: true, data: { state: "done", attemptId,
      response: { ...success.data, imported: [{ assetId: "asset-2", name: "Closing.mp4" }] } } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check import result" })));
    expect(p.onProject).toHaveBeenCalledExactlyOnceWith(project);
  });

  it("keeps failed proxy details collapsed and records a sanitized development task even off the timeline", () => {
    const p = props();
    const asset = { id: "asset-1", kind: "video" as const, name: "Synthetic.mp4", mediaMode: "reference" as const,
      sourcePath: "C:\\Synthetic.mp4", contentHash: "hash", durationFrames: 30, fps: { num: 30, den: 1 },
      width: 640, height: 360, hasAudio: false, proxyPath: null };
    p.project = { ...project, assets: [asset] };
    p.proxyStates = new Map([["asset-1", { assetId: "asset-1", state: "failed", percent: 0,
      message: "Decoder failed.", diagnosticId: "123e4567-e89b-42d3-a456-426614174000" }]]);
    render(<AssetsPane {...p} />);
    expect(screen.getByText("Optimization failed").getAttribute("title")).toBeNull();
    const details = screen.getByRole("alert").querySelector("details")!;
    expect(details.textContent).toContain("Decoder failed.");
    expect(details.textContent).toContain("123e4567-e89b-42d3-a456-426614174000");
    expect(details.open).toBe(false);
    expect(recordUnknownEditError).toHaveBeenCalledExactlyOnceWith(config, {
      code: "PREVIEW_JOB_FAILED", operation: "preview-prepare", stage: "job", outcome: "unavailable",
      diagnosticId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });
});
