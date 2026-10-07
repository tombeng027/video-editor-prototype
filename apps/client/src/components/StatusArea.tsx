import type { HealthResult } from "../engine.js";

const LABELS = { engine: "Engine", ffmpeg: "FFmpeg", ollama: "Ollama", vision: "Vision" } as const;

export function StatusArea({ result }: { result: HealthResult | null }) {
  if (!result) return <div className="status">Checking components…</div>;
  if (result.state === "error") {
    return (
      <div className="status" role="status">
        <span className="dot bad" /> Engine: {result.message}
      </div>
    );
  }
  return (
    <div className="status" role="status">
      {result.health.components.map((c) => (
        <span
          key={c.name}
          className="status-item"
          title={[c.detail, c.hint].filter(Boolean).join(" - ") || undefined}
        >
          <span className={`dot ${c.status === "ok" ? "ok" : c.status === "unknown" ? "unknown" : "bad"}`} />
          {LABELS[c.name]}
        </span>
      ))}
    </div>
  );
}
