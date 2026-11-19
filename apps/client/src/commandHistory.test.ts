import { describe, expect, it } from "vitest";
import type { Command } from "@ve/schema";
import { CommandHistory } from "./commandHistory.js";

const removeClip: Command = { type: "RemoveClip", clipId: "clip" };
const restoreClip: Command = {
  type: "AddClip",
  trackId: "track",
  clip: { id: "clip", assetId: "asset", timelineStart: 0, sourceIn: 0, sourceOut: 30, speed: 1, audioLinked: true },
};

describe("CommandHistory", () => {
  it("moves completed inverses between undo and redo stacks", () => {
    const history = new CommandHistory();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    history.complete("record", [restoreClip]);
    expect(history.peekUndo()).toEqual([restoreClip]);
    history.complete("undo", [removeClip]);
    expect(history.peekUndo()).toBeUndefined();
    expect(history.peekRedo()).toEqual([removeClip]);
    history.complete("redo", [restoreClip]);
    expect(history.peekUndo()).toEqual([restoreClip]);
    expect(history.peekRedo()).toBeUndefined();
  });

  it("clears redo history when a new edit completes", () => {
    const history = new CommandHistory();
    history.complete("record", [restoreClip]);
    history.complete("undo", [removeClip]);
    history.complete("record", [{ type: "SetTrackMuted", trackId: "track", muted: false }]);
    expect(history.canRedo).toBe(false);
    expect(history.canUndo).toBe(true);
  });

  it("clears both stacks when authoritative project reconciliation invalidates history", () => {
    const history = new CommandHistory();
    history.complete("record", [restoreClip]);
    history.complete("undo", [removeClip]);
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
