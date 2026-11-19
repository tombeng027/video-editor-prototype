import type { Command } from "@ve/schema";

export type HistoryAction = "record" | "undo" | "redo";

export class CommandHistory {
  private undoStack: Command[][] = [];
  private redoStack: Command[][] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  peekUndo(): Command[] | undefined {
    return this.undoStack.at(-1);
  }

  peekRedo(): Command[] | undefined {
    return this.redoStack.at(-1);
  }

  complete(action: HistoryAction, inverse: Command[]): void {
    if (action === "record") {
      this.redoStack = [];
      if (inverse.length > 0) this.undoStack.push(inverse);
    } else if (action === "undo") {
      this.undoStack.pop();
      if (inverse.length > 0) this.redoStack.push(inverse);
    } else {
      this.redoStack.pop();
      if (inverse.length > 0) this.undoStack.push(inverse);
    }
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
