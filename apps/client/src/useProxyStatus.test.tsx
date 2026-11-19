// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProxyState } from "@ve/schema";
import * as api from "./projectApi.js";
import { useProxyStatus } from "./useProxyStatus.js";

vi.mock("./projectApi.js", () => ({ getProxyStates: vi.fn() }));

const config = { url: "http://engine", token: "fixture" };
const running: ProxyState = { assetId: "asset-1", state: "running", percent: 40 };
const done: ProxyState = { assetId: "asset-1", state: "done", percent: 100 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

class FakeEventSource {
  static latest: FakeEventSource;
  readonly listeners = new Map<string, EventListenerOrEventListenerObject>();
  close = vi.fn();

  constructor(readonly url: string) { FakeEventSource.latest = this; }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(type, listener);
  }
  emit(type: string, event: Event = new Event(type)) {
    const listener = this.listeners.get(type);
    if (typeof listener === "function") listener(event);
    else listener?.handleEvent(event);
  }
}

function Fixture({ onDone = vi.fn(), engine = config }: { onDone?: () => void; engine?: typeof config }) {
  const status = useProxyStatus(engine, onDone);
  return (
    <div>
      <output aria-label="proxy state">{status.states.get("asset-1")?.state ?? "empty"}</output>
      {status.error && <p role="alert">{status.error}</p>}
      <button onClick={() => void status.refresh()}>Refresh</button>
    </div>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.mocked(api.getProxyStates).mockResolvedValue({ ok: true, data: { proxies: [] } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("proxy status reconciliation", () => {
  it("loads the authoritative snapshot and reconciles a completed proxy once", async () => {
    const onDone = vi.fn();
    vi.mocked(api.getProxyStates).mockResolvedValueOnce({ ok: true, data: { proxies: [done] } });
    render(<Fixture onDone={onDone} />);
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("done"));
    expect(api.getProxyStates).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
    act(() => FakeEventSource.latest.emit("proxy", new MessageEvent("proxy", { data: JSON.stringify(done) })));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("refreshes authoritative proxy states after EventSource reconnects", async () => {
    vi.mocked(api.getProxyStates)
      .mockResolvedValueOnce({ ok: true, data: { proxies: [running] } })
      .mockResolvedValueOnce({ ok: true, data: { proxies: [done] } });
    render(<Fixture />);
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("running"));
    act(() => FakeEventSource.latest.emit("error"));
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("done"));
    expect(api.getProxyStates).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps last-known state through a failed disconnect refresh and reconciles on reconnect", async () => {
    vi.mocked(api.getProxyStates)
      .mockResolvedValueOnce({ ok: true, data: { proxies: [running] } })
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine offline." })
      .mockResolvedValueOnce({ ok: true, data: { proxies: [done] } });
    render(<Fixture />);
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("running"));
    act(() => FakeEventSource.latest.emit("error"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("[UNREACHABLE]"));
    expect(screen.getByLabelText("proxy state").textContent).toBe("running");
    act(() => FakeEventSource.latest.emit("open"));
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("done"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.getProxyStates).toHaveBeenCalledTimes(3);
  });

  it("reconciles from the engine when the editor regains focus", async () => {
    vi.mocked(api.getProxyStates)
      .mockResolvedValueOnce({ ok: true, data: { proxies: [] } })
      .mockResolvedValueOnce({ ok: true, data: { proxies: [running] } });
    render(<Fixture />);
    await waitFor(() => expect(api.getProxyStates).toHaveBeenCalledOnce());
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("running"));
    expect(api.getProxyStates).toHaveBeenCalledTimes(2);
  });

  it("keeps a newer SSE event over an older in-flight snapshot", async () => {
    const snapshot = deferred<Awaited<ReturnType<typeof api.getProxyStates>>>();
    vi.mocked(api.getProxyStates)
      .mockResolvedValueOnce({ ok: true, data: { proxies: [] } })
      .mockReturnValueOnce(snapshot.promise);
    const onDone = vi.fn();
    render(<Fixture onDone={onDone} />);
    await waitFor(() => expect(api.getProxyStates).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    act(() => FakeEventSource.latest.emit("proxy", new MessageEvent("proxy", { data: JSON.stringify(done) })));
    await act(async () => snapshot.resolve({ ok: true, data: { proxies: [running] } }));
    expect(screen.getByLabelText("proxy state").textContent).toBe("done");
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("surfaces refresh errors and clears them after a successful manual retry", async () => {
    vi.mocked(api.getProxyStates)
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine offline." })
      .mockResolvedValueOnce({ ok: true, data: { proxies: [running] } });
    render(<Fixture />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("[UNREACHABLE]"));
    act(() => screen.getByRole("button", { name: "Refresh" }).click());
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("running"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reconciles malformed events without crashing the EventSource listener", async () => {
    vi.mocked(api.getProxyStates)
      .mockResolvedValueOnce({ ok: true, data: { proxies: [running] } })
      .mockResolvedValueOnce({ ok: true, data: { proxies: [running] } });
    render(<Fixture />);
    await waitFor(() => expect(api.getProxyStates).toHaveBeenCalledOnce());
    act(() => FakeEventSource.latest.emit("proxy", new MessageEvent("proxy", { data: "{" })));
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("running"));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(api.getProxyStates).toHaveBeenCalledTimes(2);
  });

  it("preserves last-known status and surfaces reconciliation failure after malformed events", async () => {
    vi.mocked(api.getProxyStates)
      .mockResolvedValueOnce({ ok: true, data: { proxies: [running] } })
      .mockResolvedValueOnce({ ok: false, code: "UNREACHABLE", message: "Engine offline." })
      .mockResolvedValueOnce({ ok: true, data: { proxies: [done] } });
    render(<Fixture />);
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("running"));
    act(() => FakeEventSource.latest.emit("proxy", new MessageEvent("proxy", { data: "{\"assetId\":\"asset-1\",\"state\":\"unknown\",\"percent\":0}" })));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("[UNREACHABLE]"));
    expect(screen.getByLabelText("proxy state").textContent).toBe("running");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("done"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores an older snapshot after the engine configuration changes", async () => {
    const oldSnapshot = deferred<Awaited<ReturnType<typeof api.getProxyStates>>>();
    vi.mocked(api.getProxyStates)
      .mockResolvedValueOnce({ ok: true, data: { proxies: [] } })
      .mockReturnValueOnce(oldSnapshot.promise)
      .mockResolvedValueOnce({ ok: true, data: { proxies: [done] } });
    const view = render(<Fixture />);
    await waitFor(() => expect(api.getProxyStates).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    view.rerender(<Fixture engine={{ url: "http://new-engine", token: "fixture" }} />);
    await waitFor(() => expect(screen.getByLabelText("proxy state").textContent).toBe("done"));
    await act(async () => oldSnapshot.resolve({ ok: true, data: { proxies: [running] } }));
    expect(screen.getByLabelText("proxy state").textContent).toBe("done");
  });

  it("resets per-engine completion tracking and ignores queued events from the old stream", async () => {
    const onDone = vi.fn();
    const view = render(<Fixture onDone={onDone} />);
    const oldSource = FakeEventSource.latest;
    await waitFor(() => expect(api.getProxyStates).toHaveBeenCalledOnce());
    act(() => oldSource.emit("proxy", new MessageEvent("proxy", { data: JSON.stringify(done) })));
    expect(onDone).toHaveBeenCalledOnce();

    vi.mocked(api.getProxyStates).mockResolvedValueOnce({ ok: true, data: { proxies: [done] } });
    view.rerender(<Fixture onDone={onDone} engine={{ url: "http://new-engine", token: "fixture" }} />);
    await waitFor(() => expect(api.getProxyStates).toHaveBeenCalledTimes(2));
    act(() => oldSource.emit("proxy", new MessageEvent("proxy", { data: JSON.stringify(running) })));
    expect(screen.getByLabelText("proxy state").textContent).toBe("done");
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
