// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXPORT_SETTINGS, resolveExportSettings } from "@ve/schema";
import * as api from "../projectApi.js";
import { ExportDialog } from "./ExportDialog.js";

vi.mock("../projectApi.js", () => ({
  startExport: vi.fn(), getExport: vi.fn(), cancelExport: vi.fn(), recordUnknownEditError: vi.fn(),
}));
const config = { url: "http://engine", token: "test" };
const projectSettings = { width: 1080, height: 1920, fps: { num: 30, den: 1 } };
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
  vi.mocked(api.recordUnknownEditError).mockResolvedValue({ ok: true, data: { records: [], capacityReached: false } });
});
afterEach(cleanup);
const select = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });
const settingsGroup = () => screen.getByText(/^(Output settings|Next export settings)$/).closest("fieldset")!;

describe("export settings form", () => {
  it("warns that saved captions are Preview-only and do not extend exported media duration", () => {
    render(<ExportDialog config={config} projectSettings={projectSettings} captionCount={2} onClose={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("will not include subtitles");
    expect(screen.getByRole("status").textContent).toContain("not available yet");
    expect(api.startExport).not.toHaveBeenCalled();
  });
  it("defaults to project settings and standard quality", () => {
    render(<ExportDialog config={config} projectSettings={projectSettings} onClose={vi.fn()} />);
    expect((screen.getByRole("combobox", { name: "Frame rate" }) as HTMLSelectElement).value).toBe("project");
    expect((screen.getByRole("combobox", { name: "Resolution" }) as HTMLSelectElement).value).toBe("project");
    expect((screen.getByRole("combobox", { name: "Quality" }) as HTMLSelectElement).value).toBe("standard");
    expect(screen.getByLabelText("Export settings summary").textContent).toContain("1080 x 1920, 30 fps, standard quality (CRF 20)");
  });
  it("summarizes portrait presets and exact fractional fps, explains upscaling and submits settings", async () => {
    vi.mocked(api.startExport).mockImplementationOnce(async (_config, attemptId, _fetch, settings) => ({
      ok: true, data: { state: "running", percent: 0, attemptId, settings: resolveExportSettings(projectSettings, settings) },
    }));
    render(<ExportDialog config={config} projectSettings={projectSettings} onClose={vi.fn()} />);
    select("Resolution", "4k"); select("Frame rate", "59.94"); select("Quality", "high");
    expect(screen.getByText(/Upscaling increases output pixels/)).toBeDefined();
    expect(screen.getByText(/Higher fps repeats frames/)).toBeDefined();
    expect(screen.getByLabelText("Export settings summary").textContent).toContain("2160 x 3840, 59.94 (60000/1001) fps, high quality (CRF 18)");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(api.startExport).toHaveBeenCalledWith(config, expect.any(String), undefined, {
      ...DEFAULT_EXPORT_SETTINGS, resolution: "4k", frameRate: "59.94", quality: "high",
    });
    expect(settingsGroup().disabled).toBe(true);
    expect(screen.getByLabelText("Export settings summary").textContent).toContain("This attempt");
  });
  it("keeps settings frozen after a lost reply and adopts the recovered attempt's settings without resubmitting", async () => {
    vi.mocked(api.startExport).mockResolvedValueOnce({ ok: false, code: "REQUEST_TIMEOUT", message: "lost reply" });
    render(<ExportDialog config={config} projectSettings={projectSettings} onClose={vi.fn()} />);
    select("Frame rate", "60");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(settingsGroup().disabled).toBe(true);
    const attemptId = vi.mocked(api.startExport).mock.calls[0]![1];
    const recovered = resolveExportSettings(projectSettings, { ...DEFAULT_EXPORT_SETTINGS, frameRate: "60" });
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: { state: "done", percent: 100, attemptId, settings: recovered } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check export status" })));
    expect(screen.getByLabelText("Export settings summary").textContent).toContain("60 fps");
    expect(settingsGroup().disabled).toBe(false);
    select("Frame rate", "24");
    expect(screen.getByLabelText("Export settings summary").textContent).toContain("60 fps");
    expect(api.startExport).toHaveBeenCalledTimes(1);
  });
  it("uses the busy attempt's resolved settings rather than the current draft", async () => {
    vi.mocked(api.startExport).mockResolvedValueOnce({ ok: false, code: "EXPORT_BUSY", message: "busy" });
    render(<ExportDialog config={config} projectSettings={projectSettings} onClose={vi.fn()} />);
    select("Frame rate", "60"); select("Quality", "high");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    const active = resolveExportSettings(projectSettings, { ...DEFAULT_EXPORT_SETTINGS, frameRate: "24", resolution: "720p" });
    vi.mocked(api.getExport).mockResolvedValueOnce({ ok: true, data: {
      state: "running", percent: 40, attemptId: "00000000-0000-4000-8000-000000000022", settings: active,
    } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Check active export" })));
    expect(screen.getByLabelText("Export settings summary").textContent).toContain("720 x 1280, 24 fps, standard");
    expect(api.startExport).toHaveBeenCalledTimes(1);
    expect(settingsGroup().disabled).toBe(true);
  });
  it("keeps a rejected settings request actionable and permits a corrected explicit retry", async () => {
    vi.mocked(api.startExport).mockResolvedValueOnce({ ok: false, code: "INVALID_EXPORT_SETTINGS", message: "unsupported" });
    render(<ExportDialog config={config} projectSettings={projectSettings} onClose={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Start export" })));
    expect(screen.getByRole("alert").textContent).toContain("These export settings are not supported");
    expect(settingsGroup().disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Export again" })).toBeDefined();
    expect(api.getExport).not.toHaveBeenCalled();
    expect(api.recordUnknownEditError).not.toHaveBeenCalled();
  });
});
