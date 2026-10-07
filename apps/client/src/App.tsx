import { useMemo, useState } from "react";
import type { ProjectResponse } from "@ve/schema";
import { Editor } from "./components/Editor.js";
import { Landing } from "./components/Landing.js";
import { getBridge } from "./desktop.js";
import { resolveEngineConfig } from "./engine.js";
import { closeProject } from "./projectApi.js";
import { useHealth } from "./useHealth.js";

export function App() {
  const config = useMemo(
    () => resolveEngineConfig(getBridge(), import.meta.env as Record<string, string | undefined>),
    [],
  );
  const health = useHealth(config);
  const [opened, setOpened] = useState<ProjectResponse | null>(null);

  if (!opened) return <Landing config={config} health={health} onOpened={setOpened} />;
  return (
    <Editor
      project={opened.project}
      folder={opened.folder}
      health={health}
      onClose={() => {
        void closeProject(config);
        setOpened(null);
      }}
    />
  );
}
