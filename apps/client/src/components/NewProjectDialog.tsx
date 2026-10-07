import { useState, type FormEvent } from "react";
import type { ProjectResponse } from "@ve/schema";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { createProject } from "../projectApi.js";
import {
  DEFAULT_FPS_INDEX,
  FPS_PRESETS,
  RESOLUTION_PRESETS,
  projectFolderFor,
  validateNewProject,
  type NewProjectForm,
} from "../presets.js";

type Props = {
  config: EngineConfig;
  onCancel: () => void;
  onCreated: (response: ProjectResponse) => void;
};

export function NewProjectDialog({ config, onCancel, onCreated }: Props) {
  const [form, setForm] = useState<NewProjectForm>({
    name: "Untitled project",
    folder: "",
    fpsIndex: DEFAULT_FPS_INDEX,
    matchFirstImport: false,
    resolutionIndex: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pickFolder = getBridge()?.pickFolder;

  const update = <K extends keyof NewProjectForm>(key: K, value: NewProjectForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const browse = async () => {
    const parent = await pickFolder?.("Choose where to create the project");
    if (parent) update("folder", parent);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validateNewProject(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const res = RESOLUTION_PRESETS[form.resolutionIndex]!;
    const result = await createProject(config, {
      folder: projectFolderFor(form.folder, form.name),
      name: form.name.trim(),
      fps: FPS_PRESETS[form.fpsIndex]!.value,
      width: res.width,
      height: res.height,
      fpsFromFirstImport: form.matchFirstImport,
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onCreated(result.data);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" role="dialog" aria-modal="true" aria-label="New project" onSubmit={(e) => void submit(e)}>
        <h2>New project</h2>
        <label>
          Name
          <input value={form.name} onChange={(e) => update("name", e.target.value)} autoFocus />
        </label>
        <label>
          Location
          <span className="row">
            <input
              value={form.folder}
              placeholder="Parent folder, e.g. C:\Videos"
              onChange={(e) => update("folder", e.target.value)}
            />
            {pickFolder && <button type="button" onClick={() => void browse()}>Browse…</button>}
          </span>
        </label>
        <label>
          Resolution
          <select value={form.resolutionIndex} onChange={(e) => update("resolutionIndex", Number(e.target.value))}>
            {RESOLUTION_PRESETS.map((r, i) => (
              <option key={r.label} value={i}>{r.label}</option>
            ))}
          </select>
        </label>
        <label>
          Frame rate
          <select value={form.fpsIndex} onChange={(e) => update("fpsIndex", Number(e.target.value))}>
            {FPS_PRESETS.map((f, i) => (
              <option key={f.label} value={i}>{f.label} fps</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.matchFirstImport}
            onChange={(e) => update("matchFirstImport", e.target.checked)}
          />
          Match the first imported video
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>Create</button>
        </div>
      </form>
    </div>
  );
}
