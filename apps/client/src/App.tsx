import { useMemo, useState } from "react";
import type { Project } from "@ve/schema";
import { createEmptyProject } from "@ve/timeline-core";
import { Editor } from "./components/Editor.js";
import { Landing } from "./components/Landing.js";
import { resolveEngineConfig } from "./engine.js";
import { useHealth } from "./useHealth.js";

const bridge = (window as unknown as { veDesktop?: Parameters<typeof resolveEngineConfig>[0] }).veDesktop;

export function App() {
  const config = useMemo(
    () => resolveEngineConfig(bridge, import.meta.env as Record<string, string | undefined>),
    [],
  );
  const health = useHealth(config);
  const [project, setProject] = useState<Project | null>(null);

  if (!project) {
    return (
      <Landing
        health={health}
        onCreate={() =>
          setProject(
            createEmptyProject({
              id: crypto.randomUUID(),
              name: "Untitled project",
              fps: { num: 30, den: 1 },
              width: 1920,
              height: 1080,
            }),
          )
        }
      />
    );
  }
  return <Editor project={project} health={health} onClose={() => setProject(null)} />;
}
