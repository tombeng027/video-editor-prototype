// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptionCue, Command, Project } from "@ve/schema";
import { applyCommands, createEmptyProject } from "@ve/timeline-core";
import { PlayheadClock } from "../clock.js";
import { CaptionWorkspace } from "./CaptionWorkspace.js";

const first: CaptionCue = { id: "one", start: 30, end: 90, text: "First caption" };
const second: CaptionCue = { id: "two", start: 120, end: 180, text: "Second caption" };
const makeProject = (cues = [first, second]): Project => ({
  ...createEmptyProject({ id: "p", name: "Captions", fps: { num: 30, den: 1 }, width: 640, height: 360 }),
  captionCues: cues,
});
const pointer = (type: string, clientX: number) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
};
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(initial = makeProject()) {
  const clock = new PlayheadClock({ now: () => 0, request: () => 1, cancel: () => undefined });
  clock.configure(initial.settings.fps, 600);
  const sent = vi.fn<(commands: Command[]) => void>();
  const onExpand = vi.fn(), onScroll = vi.fn();
  function Harness() {
    const [project, setProject] = useState(initial);
    return <CaptionWorkspace project={project} clock={clock} zoom={60} width={1560} labelWidth={160}
      scrollLeft={100} onScroll={onScroll} onExpand={onExpand} onCommands={async (commands) => {
        sent(commands);
        const result = applyCommands(project, commands);
        if (!result.ok) throw new Error(result.error.message);
        setProject(result.project);
        return true;
      }} />;
  }
  const view = render(<Harness />);
  const expand = () => fireEvent.click(screen.getByRole("button", { name: "Expand captions" }));
  const select = () => fireEvent.click(screen.getByRole("button", { name: "Select caption: First caption" }));
  return { ...view, clock, sent, onExpand, onScroll, expand, select };
}

describe("caption workspace", () => {
  it("starts collapsed with density markers on the shared axis, expands and seeks independently of media selection", () => {
    const { container, clock, onExpand, onScroll, expand, select } = setup();
    expect(screen.queryByRole("form", { name: "Caption editor" })).toBeNull();
    expect(screen.getByText("2 cues")).toBeDefined();
    expect(container.querySelector<HTMLElement>(".caption-axis-content")!.style.transform).toBe("translateX(-100px)");
    expect(container.querySelector<HTMLElement>('[data-caption-id="one"]')!.style.left).toBe("220px");
    expand();
    expect(onExpand).toHaveBeenCalledOnce();
    act(() => clock.play());
    select();
    expect(clock.playing).toBe(false);
    expect(clock.frame).toBe(30);
    expect(screen.getByLabelText("Caption start frame")).toHaveProperty("value", "30");
    fireEvent.wheel(screen.getByLabelText("Caption timeline"), { deltaX: 80 });
    expect(onScroll).toHaveBeenCalledExactlyOnceWith(80);
    act(() => clock.seek(150));
    expect(container.querySelector<HTMLElement>(".tl-playhead")!.style.left).toBe("460px");
  });

  it("adds a Unicode multiline cue only on Apply, caps its default end at the next cue and cancels drafts", async () => {
    const { clock, sent, expand } = setup();
    expand();
    fireEvent.click(screen.getByRole("button", { name: "New caption at playhead" }));
    expect(screen.getByLabelText("Caption end frame")).toHaveProperty("value", "30");
    fireEvent.change(screen.getByLabelText("Caption text"), { target: { value: "Hello\n世界 <b>plain text</b>" } });
    expect(sent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add caption" }));
    await waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(sent.mock.calls[0]![0][0]).toMatchObject({ type: "AddCaptionCue", cue: { start: 0, end: 30, text: "Hello\n世界 <b>plain text</b>" } });
    await waitFor(() => expect(screen.getByText("3 cues")).toBeDefined());
    act(() => clock.seek(200));
    fireEvent.click(screen.getByRole("button", { name: "New caption at playhead" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel draft" }));
    expect(screen.queryByLabelText("Caption text")).toBeNull();
    expect(sent).toHaveBeenCalledOnce();
  });

  it.each([
    ["Caption text", "   "],
    ["Caption start frame", ""],
    ["Caption start frame", "30.5"],
    ["Caption end frame", "30"],
    ["Caption end frame", "130"],
    ["Caption end frame", "9007199254740992"],
  ])("rejects invalid %s value %s without sending commands", (label, value) => {
    const { sent, expand, select } = setup();
    expand(); select();
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.submit(screen.getByRole("form", { name: "Caption editor" }));
    expect(screen.getByRole("alert")).toBeDefined();
    expect(sent).not.toHaveBeenCalled();
  });

  it("does not add over an existing cue and keeps text drafts out of the saved lane until Apply", async () => {
    const { sent, expand, select } = setup();
    expand(); select();
    fireEvent.click(screen.getByRole("button", { name: "New caption at playhead" }));
    expect(screen.getByRole("alert").textContent).toContain("already covers");
    fireEvent.change(screen.getByLabelText("Caption text"), { target: { value: "Reworded" } });
    expect(screen.getByRole("button", { name: "Select caption: First caption" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Split caption" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Apply caption" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Select caption: Reworded" })).toBeDefined());
    expect(sent.mock.calls[0]![0]).toEqual([{ type: "SetCaptionCue", cue: { ...first, text: "Reworded" } }]);
  });

  it.each([
    ["move", 300, 60, 120],
    ["start", -500, 0, 90],
    ["end", 500, 30, 120],
  ] as const)("commits one %s gesture with whole-frame neighbor constraints", async (kind, x, start, end) => {
    const { container, sent, expand } = setup();
    expand();
    const block = container.querySelector<HTMLElement>('[data-caption-id="one"]')!;
    Object.defineProperty(block, "setPointerCapture", { configurable: true, value: vi.fn() });
    const handle = kind === "move" ? block : block.querySelector(`[data-caption-edge="${kind}"]`)!;
    fireEvent(handle, pointer("pointerdown", 220));
    fireEvent(block, pointer("pointermove", x));
    expect(sent).not.toHaveBeenCalled();
    fireEvent(block, pointer("pointerup", x));
    await waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(sent.mock.calls[0]![0]).toEqual([{ type: "SetCaptionCue", cue: { ...first, start, end } }]);
  });

  it("cancels a gesture on Escape and pointer cancellation without a command", () => {
    const { container, sent, expand } = setup();
    expand();
    const block = container.querySelector<HTMLElement>('[data-caption-id="one"]')!;
    Object.defineProperty(block, "setPointerCapture", { configurable: true, value: vi.fn() });
    for (const cancel of ["escape", "pointercancel"]) {
      fireEvent(block, pointer("pointerdown", 220));
      fireEvent(block, pointer("pointermove", 240));
      if (cancel === "escape") fireEvent.keyDown(block, { key: "Escape" });
      else fireEvent(block, pointer("pointercancel", 240));
      fireEvent(block, pointer("pointerup", 240));
      expect(block.style.left).toBe("220px");
    }
    expect(sent).not.toHaveBeenCalled();
  });

  it("preserves exact cue duration when dragging near the safe-integer timing ceiling", async () => {
    const cue = { ...first, start: Number.MAX_SAFE_INTEGER - 100, end: Number.MAX_SAFE_INTEGER - 40 };
    const { container, sent, expand } = setup(makeProject([cue]));
    expand();
    const block = container.querySelector<HTMLElement>('[data-caption-id="one"]')!;
    Object.defineProperty(block, "setPointerCapture", { configurable: true, value: vi.fn() });
    fireEvent(block, pointer("pointerdown", 0));
    fireEvent(block, pointer("pointerup", 40));
    await waitFor(() => expect(sent).toHaveBeenCalledOnce());
    expect(sent.mock.calls[0]![0]).toEqual([{ type: "SetCaptionCue", cue: { ...cue, start: cue.start + 20, end: cue.end + 20 } }]);
  });

  it("splits with one atomic batch, merges chronologically across gaps and deletes", async () => {
    const { clock, sent, expand, select } = setup();
    expand(); select();
    fireEvent.click(screen.getByRole("button", { name: "Split caption" }));
    expect(screen.getByRole("alert").textContent).toContain("inside");
    act(() => clock.seek(60));
    fireEvent.click(screen.getByRole("button", { name: "Split caption" }));
    await waitFor(() => expect(screen.getByText("3 cues")).toBeDefined());
    expect(sent.mock.calls[0]![0]).toMatchObject([{ type: "SetCaptionCue", cue: { end: 60 } }, { type: "AddCaptionCue", cue: { start: 60, end: 90 } }]);
    fireEvent.click(screen.getByRole("button", { name: "Merge with next" }));
    await waitFor(() => expect(screen.getByText("2 cues")).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Merge with next" }));
    await waitFor(() => expect(screen.getByText("1 cue")).toBeDefined());
    expect(sent.mock.calls[2]![0]).toEqual([{ type: "RemoveCaptionCue", cueId: "two" },
      { type: "SetCaptionCue", cue: { ...first, end: 180, text: "First caption\nFirst caption\nSecond caption" } }]);
    fireEvent.click(screen.getByRole("button", { name: "Delete caption" }));
    await waitFor(() => expect(screen.getByText("0 cues")).toBeDefined());
  });

  it("keeps a failed draft, prevents duplicate submission while pending and disables mutations when locked", async () => {
    const p = makeProject([]);
    const clock = new PlayheadClock();
    let resolve!: (ok: boolean) => void;
    const onCommands = vi.fn(() => new Promise<boolean>((done) => { resolve = done; }));
    const props = { project: p, clock, zoom: 60, width: 1000, labelWidth: 160, scrollLeft: 0, onScroll: vi.fn(), onCommands };
    const view = render(<CaptionWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand captions" }));
    fireEvent.click(screen.getByRole("button", { name: "New caption at playhead" }));
    fireEvent.change(screen.getByLabelText("Caption text"), { target: { value: "Keep draft" } });
    fireEvent.submit(screen.getByRole("form", { name: "Caption editor" }));
    fireEvent.submit(screen.getByRole("form", { name: "Caption editor" }));
    expect(onCommands).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Caption text")).toHaveProperty("disabled", true);
    await act(async () => resolve(false));
    expect(screen.getByRole("alert").textContent).toContain("not confirmed");
    expect(screen.getByLabelText("Caption text")).toHaveProperty("value", "Keep draft");
    view.rerender(<CaptionWorkspace {...props} disabled />);
    expect(screen.getByRole("button", { name: "Add caption" })).toHaveProperty("disabled", true);
  });

  it("preserves drafts on unrelated refresh and adopts a late-confirmed new cue instead of adding it twice", async () => {
    const project = makeProject();
    const clock = new PlayheadClock();
    clock.configure(project.settings.fps, 600);
    const onCommands = vi.fn<(commands: Command[]) => Promise<boolean>>().mockResolvedValue(false);
    const props = { project, clock, zoom: 60, width: 1000, labelWidth: 160, scrollLeft: 0, onScroll: vi.fn(), onCommands };
    const view = render(<CaptionWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand captions" }));
    fireEvent.click(screen.getByRole("button", { name: "Select caption: First caption" }));
    fireEvent.change(screen.getByLabelText("Caption text"), { target: { value: "Unsaved words" } });
    view.rerender(<CaptionWorkspace {...props} project={structuredClone(project)} />);
    expect(screen.getByLabelText("Caption text")).toHaveProperty("value", "Unsaved words");
    act(() => clock.seek(200));
    fireEvent.click(screen.getByRole("button", { name: "New caption at playhead" }));
    fireEvent.change(screen.getByLabelText("Caption text"), { target: { value: "Late caption" } });
    await act(async () => fireEvent.submit(screen.getByRole("form", { name: "Caption editor" })));
    const add = onCommands.mock.calls[0]![0][0]!;
    if (add.type !== "AddCaptionCue") throw new Error("Expected AddCaptionCue");
    view.rerender(<CaptionWorkspace {...props} project={{ ...project, captionCues: [...project.captionCues, add.cue] }} />);
    expect(screen.queryByRole("button", { name: "Add caption" })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply caption" })).toHaveProperty("disabled", true);
  });

  it("cancels a captured gesture when a project refresh or editing lock changes", () => {
    const project = makeProject();
    const clock = new PlayheadClock();
    clock.configure(project.settings.fps, 600);
    const onCommands = vi.fn().mockResolvedValue(true);
    const props = { project, clock, zoom: 60, width: 1000, labelWidth: 160, scrollLeft: 0, onScroll: vi.fn(), onCommands };
    const view = render(<CaptionWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Expand captions" }));
    const block = view.container.querySelector<HTMLElement>('[data-caption-id="one"]')!;
    Object.defineProperty(block, "setPointerCapture", { configurable: true, value: vi.fn() });
    fireEvent(block, pointer("pointerdown", 220));
    fireEvent(block, pointer("pointermove", 240));
    view.rerender(<CaptionWorkspace {...props} project={structuredClone(project)} />);
    fireEvent(block, pointer("pointerup", 240));
    expect(onCommands).not.toHaveBeenCalled();
    fireEvent(block, pointer("pointerdown", 220));
    fireEvent(block, pointer("pointermove", 240));
    view.rerender(<CaptionWorkspace {...props} disabled />);
    fireEvent(block, pointer("pointerup", 240));
    expect(onCommands).not.toHaveBeenCalled();
  });
});
