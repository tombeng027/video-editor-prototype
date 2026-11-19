// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANIMATION_CATALOG, EDIT_ERROR_DEFINITIONS } from "@ve/schema";
import { HelpDialog } from "./HelpDialog.js";
import { APP_VERSION, CREDIT_NAME, SUPPORT_LINKS } from "../helpContent.js";

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("offline Help", () => {
  it("lists the shared animation catalog without engine requests and marks the custom editor as future", () => {
    render(<HelpDialog health={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Animation catalog" }));
    for (const preset of ANIMATION_CATALOG) {
      expect(screen.getByRole("heading", { name: preset.name })).toBeDefined();
      expect(screen.getByText(preset.description)).toBeDefined();
    }
    expect(screen.getByText(/Custom animation editing and neighboring crossfades are future/)).toBeDefined();
  });
  it("shows truthful version and prototype information without requiring an engine or network", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const view = render(<HelpDialog health={null} onClose={vi.fn()} />);
    expect(screen.getByText(`Client version: ${APP_VERSION}. Development prototype.`)).toBeDefined();
    expect(screen.getByText(/engine connection not confirmed/)).toBeDefined();
    for (const name of ["How to use", "Current features", "Errors & troubleshooting"]) {
      fireEvent.click(screen.getByRole("tab", { name }));
      expect(screen.getByRole("tabpanel").textContent?.length).toBeGreaterThan(100);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(view.container.querySelector("textarea")).toBeNull();
  });
  it("shows developer credit, thanks and external support links on the About tab", () => {
    render(<HelpDialog health={null} onClose={vi.fn()} />);
    expect(screen.getByText(`Built by ${CREDIT_NAME}.`)).toBeDefined();
    for (const link of SUPPORT_LINKS) {
      const anchor = screen.getByRole("link", { name: link.label }) as HTMLAnchorElement;
      expect(anchor.getAttribute("href")).toBe(link.url);
      expect(anchor.getAttribute("target")).toBe("_blank");
      expect(anchor.getAttribute("rel")).toContain("noopener");
    }
    expect(screen.getByText(/Lucide icons/)).toBeDefined();
  });
  it("supports arrow/Home/End navigation with selected tab and labelled panel", () => {
    render(<HelpDialog health={null} onClose={vi.fn()} />);
    const about = screen.getByRole("tab", { name: "About" });
    about.focus();
    fireEvent.keyDown(about, { key: "ArrowRight" });
    const guide = screen.getByRole("tab", { name: "How to use" });
    expect(document.activeElement).toBe(guide);
    expect(guide.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "How to use" })).toBeDefined();
    fireEvent.keyDown(guide, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Errors & troubleshooting" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(about);
    fireEvent.keyDown(about, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Errors & troubleshooting" }));
  });
  it("searches live catalog definitions and distinguishes rejection from uncertain outcomes", () => {
    render(<HelpDialog health={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Errors & troubleshooting" }));
    expect(screen.getByText(`${EDIT_ERROR_DEFINITIONS.length} matching definitions`)).toBeDefined();
    const input = screen.getByRole("searchbox", { name: "Search errors" });
    fireEvent.change(input, { target: { value: "  INVALID_SPEED  " } });
    expect(screen.getByText("1 matching definitions")).toBeDefined();
    expect(screen.getByText("This clip speed is not supported")).toBeDefined();
    expect(screen.getByText(/Applies when: confirmed not applied/)).toBeDefined();
    fireEvent.change(input, { target: { value: "OPERATION_UNKNOWN" } });
    expect(screen.getByText(/Applies when: result unconfirmed/)).toBeDefined();
    fireEvent.change(input, { target: { value: "ALREADY_IMPORTED" } });
    expect(screen.getByText("1 matching definitions")).toBeDefined();
    expect(screen.getByText("This file is already in Assets")).toBeDefined();
    expect(screen.getByText(/Stage: file\. Operation: importing media/)).toBeDefined();
    fireEvent.change(input, { target: { value: "IMPORT_RECEIPT_MISSING" } });
    expect(screen.getByText(/Applies when: result unconfirmed/)).toBeDefined();
    expect(screen.getByText(/receipt may have expired/)).toBeDefined();
    fireEvent.change(input, { target: { value: "PREVIEW_READY_TIMEOUT" } });
    expect(screen.getByText("Preview is taking too long to load")).toBeDefined();
    expect(screen.getByText(/Applies when: preview unavailable or status stale/)).toBeDefined();
    fireEvent.change(input, { target: { value: "EXPORT_CLEANUP_FAILED" } });
    expect(screen.getByText("Export stopped, but cleanup needs attention")).toBeDefined();
    expect(screen.getByText(/render failed with no verified finished file/)).toBeDefined();
    fireEvent.change(input, { target: { value: "EXPORT_DURATION_MISMATCH" } });
    expect(screen.getByText("The rendered duration did not match the timeline")).toBeDefined();
    fireEvent.change(input, { target: { value: "INVALID_EXPORT_SETTINGS" } });
    expect(screen.getByText("These export settings are not supported")).toBeDefined();
    fireEvent.change(input, { target: { value: "EXPORT_SETTINGS_MISMATCH" } });
    expect(screen.getByText("The rendered file did not match your output settings")).toBeDefined();
    fireEvent.change(input, { target: { value: "NEVER_CATALOGUED" } });
    expect(screen.getByText(/No catalog match/)).toBeDefined();
    expect(screen.getByText(/do not resend it/)).toBeDefined();
  });
  it("labels planned features honestly and closes via button or Escape, restoring focus", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(<HelpDialog health={{ state: "ok", health: { ok: true, version: "engine-test", components: [] } }} onClose={onClose} />);
    expect(screen.getByText("Editing engine version: engine-test")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Current features" }));
    const planned = screen.getByRole("heading", { name: "Planned - not available yet" }).closest("section")!;
    expect(within(planned).getByText(/Conversational Ollama assistant/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close help" }));
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
