import { describe, expect, it } from "vitest";
import { isTrustedSender, sanitizeTitle } from "./ipc.js";

describe("ipc guard", () => {
  const client = "http://127.0.0.1:5173";
  it("trusts only the client origin", () => {
    expect(isTrustedSender("http://127.0.0.1:5173/some/page", client)).toBe(true);
    expect(isTrustedSender("http://evil.example/", client)).toBe(false);
    expect(isTrustedSender("http://127.0.0.1:9999/", client)).toBe(false);
    expect(isTrustedSender(undefined, client)).toBe(false);
    expect(isTrustedSender("not a url", client)).toBe(false);
  });

  it("sanitises dialog titles", () => {
    expect(sanitizeTitle("  Open  ", "x")).toBe("Open");
    expect(sanitizeTitle(42, "fallback")).toBe("fallback");
    expect(sanitizeTitle("a".repeat(300), "x")).toHaveLength(100);
  });
});
