// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusArea } from "./StatusArea.js";

describe("StatusArea", () => {
  it("shows recovery details inline for unavailable components", () => {
    render(<StatusArea result={{
        state: "ok",
        health: {
          ok: true,
          version: "test",
          components: [
            { name: "engine", status: "ok" },
            { name: "ffmpeg", status: "unavailable", detail: "FFmpeg was not found", hint: "Install FFmpeg or set FFMPEG_PATH." },
            { name: "ollama", status: "unknown", hint: "Start Ollama and pull the model (see docs)." },
            { name: "vision", status: "ok" },
          ],
        },
      }} />);
    expect(screen.getByLabelText("FFmpeg status details").textContent).toBe("FFmpeg was not found - Install FFmpeg or set FFMPEG_PATH.");
    expect(screen.getByLabelText("Ollama status details").textContent).toBe("Start Ollama and pull the model (see docs).");
    expect(screen.queryByLabelText("Vision status details")).toBeNull();
  });
});
