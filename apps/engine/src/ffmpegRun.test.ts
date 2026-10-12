import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { runFfmpeg } from "./ffmpegRun.js";

const process = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: process.spawn }));

beforeEach(() => { process.spawn.mockReset(); });

it("waits for close after an abort error before settling the writer", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  process.spawn.mockReturnValue(child);
  let settled = false;
  const error = new Error("aborted");
  const result = runFfmpeg({
    ffmpegPath: "ffmpeg", args: [], durationSeconds: 1,
    signal: new AbortController().signal, onProgress: () => {},
  });
  const rejected = expect(result).rejects.toBe(error);
  void result.then(() => { settled = true; }, () => { settled = true; });
  child.emit("error", error);
  await Promise.resolve();
  expect(settled).toBe(false);
  child.emit("close", null);
  await rejected;
  expect(settled).toBe(true);
});

it("retains progress and stderr failures while waiting for close", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  process.spawn.mockReturnValue(child);
  const progress = vi.fn();
  const result = runFfmpeg({
    ffmpegPath: "ffmpeg", args: [], durationSeconds: 2,
    signal: new AbortController().signal, onProgress: progress,
  });
  const rejected = expect(result).rejects.toThrow("last error");
  child.stdout.emit("data", Buffer.from("out_time_us=1000000\n"));
  child.stderr.emit("data", Buffer.from("context\nlast error\n"));
  expect(progress).toHaveBeenCalledWith(0.5);
  child.emit("close", 1);
  await rejected;
});

it("settles a failed spawn when its streams close", async () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  process.spawn.mockReturnValue(child);
  const error = new Error("ENOENT");
  const result = runFfmpeg({
    ffmpegPath: "missing", args: [], durationSeconds: 1,
    signal: new AbortController().signal, onProgress: () => {},
  });
  const rejected = expect(result).rejects.toBe(error);
  child.emit("error", error);
  child.emit("close", -1);
  await rejected;
});
