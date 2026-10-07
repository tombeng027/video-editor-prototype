import { describe, expect, it } from "vitest";
import { resolveShortcut } from "./shortcuts.js";

const key = (k: string, code = k, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe("resolveShortcut", () => {
  it("maps the editor keys on a neutral target", () => {
    expect(resolveShortcut(key(" ", "Space"), "BODY")).toBe("toggle-play");
    expect(resolveShortcut(key("s"), "BODY")).toBe("split");
    expect(resolveShortcut(key("S"), "DIV")).toBe("split");
    expect(resolveShortcut(key("Delete"), "BODY")).toBe("delete");
    expect(resolveShortcut(key("Backspace"), "BODY")).toBe("delete");
  });

  it("leaves every key to text fields", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(resolveShortcut(key("s"), tag)).toBeNull();
      expect(resolveShortcut(key("Delete"), tag)).toBeNull();
      expect(resolveShortcut(key(" ", "Space"), tag)).toBeNull();
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
});
