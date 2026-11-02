// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "@ve/timeline-core";
import type { DesktopBridge } from "../desktop.js";
import { importFiles } from "../projectApi.js";
import { AssetsPane } from "./AssetsPane.js";

vi.mock("../projectApi.js", () => ({ importFiles: vi.fn() }));
const config = { url: "http://engine", token: "fixture" };
const project = createEmptyProject({ id: "p", name: "Fixture", fps: { num: 30, den: 1 }, width: 640, height: 360 });
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
  onProject: vi.fn(), onAddToTimeline: vi.fn() });
const success = { ok: true as const, data: { project, imported: [], failed: [] } };

beforeEach(() => { vi.resetAllMocks(); bridge(); });
afterEach(() => { cleanup(); bridge(); });

describe("media picker and import ownership", () => {
  it("shows picker rejection, sends no import and allows retry/cancel without an error", async () => {
    const pickMedia = vi.fn().mockRejectedValueOnce(new Error("IPC unavailable")).mockResolvedValueOnce([]);
    bridge({ pickMedia });
    render(<AssetsPane {...props()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Import media" })));
    expect(screen.getByRole("alert").textContent).toContain("[MEDIA_PICK_FAILED] IPC unavailable");
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
    expect(importFiles).toHaveBeenCalledExactlyOnceWith(config, { paths: ["C:\\Synthetic.mp4"], mode: "copy" });
    expect(screen.getByRole("status").textContent).toContain("does not cancel");
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
        failed: [{ path: "C:\\Retry.mp4", code: "UNSUPPORTED", message: "Unsupported codec" }] } })
      .mockResolvedValueOnce(success);
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(screen.getByRole("alert").textContent).toContain("[IMPORT_FAILED]");
    expect((input as HTMLInputElement).value).toBe("C:\\Retry.mp4");
    await act(async () => fireEvent.submit(view.container.querySelector("form")!));
    expect(screen.getByRole("alert").textContent).toContain("[UNSUPPORTED]");
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
    expect(importFiles).toHaveBeenCalledExactlyOnceWith(config, { paths: ["C:\\Synthetic.mp4"], mode: "reference" });
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
    await act(async () => imported.resolve(success));
  });
});
