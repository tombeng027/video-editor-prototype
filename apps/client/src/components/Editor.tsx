import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Asset, Project } from "@ve/schema";
import { PlayheadClock } from "../clock.js";
import type { EngineConfig } from "../engine.js";
import { getProject, sendCommands } from "../projectApi.js";
import { planAddToTimeline, planDelete, planSplit, type Plan } from "../timelineOps.js";
import { Preview } from "./Preview.js";
import { Timeline } from "./Timeline.js";
import { useProxyStatus } from "../useProxyStatus.js";
import { AssetsPane } from "./AssetsPane.js";
import { DEFAULT_SIZES, clampSize, loadSizes, saveSizes, type PaneSizes } from "../layout.js";
import type { HealthResult } from "../engine.js";
import { Splitter } from "./Splitter.js";
import { StatusArea } from "./StatusArea.js";

type Props = { config: EngineConfig; project: Project; folder: string; health: HealthResult | null; onClose: () => void };

export function Editor({ config, project: initialProject, folder, health, onClose }: Props) {
  const [project, setProject] = useState(initialProject);
  const proxyStates = useProxyStatus(config, () => {
    void getProject(config).then((r) => r.ok && setProject(r.data.project));
  });
  const clock = useMemo(() => new PlayheadClock(), []);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => () => clock.dispose(), [clock]);

  // The engine stays the single source of truth: send the batch, then adopt its project.
  const run = useCallback(
    async (plan: Plan): Promise<boolean> => {
      if (!plan.ok) {
        setEditMessage(plan.message);
        return false;
      }
      const result = await sendCommands(config, plan.commands);
      if (!result.ok) {
        setEditMessage(result.message);
        return false;
      }
      setEditMessage(null);
      setProject(result.data.project);
      return true;
    },
    [config],
  );

  const addToTimeline = useCallback((asset: Asset) => void run(planAddToTimeline(projectRef.current, asset)), [run]);
  const split = useCallback(
    () => void run(planSplit(projectRef.current, clock.frame, selectedClipId)),
    [run, clock, selectedClipId],
  );
  const remove = useCallback(() => {
    const plan = planDelete(projectRef.current, selectedClipId);
    void run(plan).then((ok) => ok && setSelectedClipId(null));
  }, [run, selectedClipId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        clock.toggle();
      } else if (e.key === "s" || e.key === "S") split();
      else if (e.key === "Delete" || e.key === "Backspace") remove();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, split, remove]);

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
        <span className="muted" title={folder}>Autosaved</span>
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
          <AssetsPane config={config} project={project} proxyStates={proxyStates} onProject={setProject} onAddToTimeline={addToTimeline} />
          <Splitter
            orientation="vertical"
            label="Resize assets pane"
            onDragStart={beginDrag}
            onDrag={(d) => setNumeric("assetsWidth", dragStart.current.assetsWidth + d)}
            onNudge={(d) => setNumeric("assetsWidth", assetsWidth + d)}
          />
          <section className="pane" aria-label="Preview">
            <h2>Preview</h2>
            <Preview config={config} project={project} clock={clock} />
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
          <Timeline
            project={project}
            clock={clock}
            selectedClipId={selectedClipId}
            message={editMessage}
            onSelect={setSelectedClipId}
            onSplit={split}
            onDelete={remove}
          />
        </section>
      </div>

      <footer className="statusbar">
        <StatusArea result={health} />
      </footer>
    </div>
  );
}
