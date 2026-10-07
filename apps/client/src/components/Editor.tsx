import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@ve/schema";
import { DEFAULT_SIZES, clampSize, loadSizes, saveSizes, type PaneSizes } from "../layout.js";
import type { HealthResult } from "../engine.js";
import { Splitter } from "./Splitter.js";
import { StatusArea } from "./StatusArea.js";

type Props = { project: Project; health: HealthResult | null; onClose: () => void };

export function Editor({ project, health, onClose }: Props) {
  const [sizes, setSizes] = useState<PaneSizes>(() => loadSizes(localStorage));
  const dragStart = useRef<PaneSizes>(sizes);

  useEffect(() => saveSizes(localStorage, sizes), [sizes]);

  const beginDrag = useCallback(() => {
    dragStart.current = sizes;
  }, [sizes]);

  const setNumeric = (key: "assetsWidth" | "assistantWidth" | "timelineHeight", value: number) =>
    setSizes((s) => ({ ...s, [key]: clampSize(key, value) }));

  const { assetsWidth, assistantWidth, timelineHeight, assistantOpen } = sizes;

  return (
    <div className="editor">
      <header className="topbar">
        <button onClick={onClose}>← Projects</button>
        <strong>{project.name}</strong>
        <span className="muted">Not saved (prototype)</span>
        <span className="spacer" />
        <button disabled title="Available in M3">Undo</button>
        <button disabled title="Available in M3">Redo</button>
        <button disabled title="Available in M2">Export</button>
        <button onClick={() => setSizes((s) => ({ ...s, assistantOpen: !s.assistantOpen }))}>
          {assistantOpen ? "Hide assistant" : "Show assistant"}
        </button>
        <button onClick={() => setSizes({ ...DEFAULT_SIZES, assistantOpen })}>Reset layout</button>
      </header>

      <div className="workspace">
        <div className="upper" style={{ gridTemplateColumns: `${assetsWidth}px 6px 1fr ${assistantOpen ? `6px ${assistantWidth}px` : ""}` }}>
          <section className="pane" aria-label="Assets">
            <h2>Assets</h2>
            <p className="placeholder">Imported media will appear here (M2).</p>
          </section>
          <Splitter
            orientation="vertical"
            label="Resize assets pane"
            onDragStart={beginDrag}
            onDrag={(d) => setNumeric("assetsWidth", dragStart.current.assetsWidth + d)}
            onNudge={(d) => setNumeric("assetsWidth", assetsWidth + d)}
          />
          <section className="pane" aria-label="Preview">
            <h2>Preview</h2>
            <div className="preview-frame">
              <span className="placeholder">
                {project.settings.width}×{project.settings.height} @ {project.settings.fps.num}/{project.settings.fps.den} fps
              </span>
            </div>
          </section>
          {assistantOpen && (
            <>
              <Splitter
                orientation="vertical"
                label="Resize assistant pane"
                onDragStart={beginDrag}
                onDrag={(d) => setNumeric("assistantWidth", dragStart.current.assistantWidth - d)}
                onNudge={(d) => setNumeric("assistantWidth", assistantWidth - d)}
              />
              <section className="pane" aria-label="AI Assistant">
                <h2>AI Assistant</h2>
                <p className="placeholder">Chat and quick actions arrive in M4-M6.</p>
              </section>
            </>
          )}
        </div>

        <Splitter
          orientation="horizontal"
          label="Resize timeline"
          onDragStart={beginDrag}
          onDrag={(d) => setNumeric("timelineHeight", dragStart.current.timelineHeight - d)}
          onNudge={(d) => setNumeric("timelineHeight", timelineHeight - d)}
        />
        <section className="pane timeline" style={{ height: timelineHeight }} aria-label="Timeline">
          <h2>Timeline</h2>
          <p className="placeholder">Ruler, tracks and playhead (M2-M3).</p>
        </section>
      </div>

      <footer className="statusbar">
        <StatusArea result={health} />
      </footer>
    </div>
  );
}
