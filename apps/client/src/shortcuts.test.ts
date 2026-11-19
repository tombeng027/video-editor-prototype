import { describe, expect, it } from "vitest";
import { resolveShortcut } from "./shortcuts.js";

const key = (k: string, code = k, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("resolveShortcut", () => {
  it("maps the editor keys on a neutral target", () => {
    expect(resolveShortcut(key(" ", "Space"), "BODY")).toBe("toggle-play");
    expect(resolveShortcut(key("s"), "BODY")).toBe("split");
    expect(resolveShortcut(key("S"), "DIV")).toBe("split");
    expect(resolveShortcut(key("Delete"), "BODY")).toBe("delete");
    expect(resolveShortcut(key("Backspace"), "BODY")).toBe("delete");
    expect(resolveShortcut(key("Escape"), "BODY")).toBe("deselect");
    expect(resolveShortcut(key("Escape"), "INPUT")).toBeNull();
  });

  it("leaves every key to text fields", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(resolveShortcut(key("ArrowLeft"), tag)).toBeNull();
      expect(resolveShortcut(key("ArrowRight"), tag)).toBeNull();
      expect(resolveShortcut(key("s"), tag)).toBeNull();
      expect(resolveShortcut(key("Delete"), tag)).toBeNull();
      expect(resolveShortcut(key(" ", "Space"), tag)).toBeNull();
    }
  });

  it("maps unmodified arrows to frame steps, including after a button click", () => {
    for (const tag of ["BODY", "DIV", "BUTTON"]) {
      expect(resolveShortcut(key("ArrowLeft"), tag)).toBe("previous-frame");
      expect(resolveShortcut(key("ArrowRight"), tag)).toBe("next-frame");
    }
    for (const modifier of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      for (const arrow of ["ArrowLeft", "ArrowRight"]) {
        expect(resolveShortcut(key(arrow, arrow, { [modifier]: true }), "BODY")).toBeNull();
      }
    }
  });

  it("keeps S and Delete working after a button click, but leaves Space to the button", () => {
    expect(resolveShortcut(key("s"), "BUTTON")).toBe("split");
    expect(resolveShortcut(key("Delete"), "BUTTON")).toBe("delete");
    expect(resolveShortcut(key(" ", "Space"), "BUTTON")).toBeNull();
  });

  it("ignores modified keys", () => {
    expect(resolveShortcut(key("s", "KeyS", { ctrlKey: true }), "BODY")).toBeNull();
    expect(resolveShortcut(key("s", "KeyS", { metaKey: true }), "BODY")).toBeNull();
    expect(resolveShortcut(key("Delete", "Delete", { altKey: true }), "BODY")).toBeNull();
  });

  it("maps platform undo and redo shortcuts without intercepting text entry", () => {
    expect(resolveShortcut(key("z", "KeyZ", { ctrlKey: true }), "BODY")).toBe("undo");
    expect(resolveShortcut(key("z", "KeyZ", { metaKey: true }), "DIV")).toBe("undo");
    expect(resolveShortcut(key("z", "KeyZ", { ctrlKey: true, shiftKey: true }), "BODY")).toBe("redo");
    expect(resolveShortcut(key("y", "KeyY", { ctrlKey: true }), "BODY")).toBe("redo");
    expect(resolveShortcut(key("z", "KeyZ", { ctrlKey: true }), "INPUT")).toBeNull();
  });
});
