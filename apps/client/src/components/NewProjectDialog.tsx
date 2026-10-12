import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ProjectResponse } from "@ve/schema";
import { getBridge } from "../desktop.js";
import type { EngineConfig } from "../engine.js";
import { createProject, getDefaultFolder } from "../projectApi.js";
import { Modal } from "./Modal.js";
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
  const [locationWarning, setLocationWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const pending = useRef(false);
  const locationEdited = useRef(false);
  const pickFolder = getBridge()?.pickFolder;

  // Start in the app's sample-projects folder unless the user already typed a location.
  useEffect(() => {
    let active = true;
    void getDefaultFolder(config).then((result) => {
      if (!active) return;
      if (result.ok) {
        if (!pending.current && !locationEdited.current) setForm((f) => (f.folder ? f : { ...f, folder: result.data.folder }));
      }
      else setLocationWarning(`[${result.code}] Could not load the default location: ${result.message} Choose a location manually.`);
    });
    return () => { active = false; };
  }, [config]);

  const update = <K extends keyof NewProjectForm>(key: K, value: NewProjectForm[K]) => {
    if (pending.current) return;
    if (key === "folder") locationEdited.current = true;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const browse = async () => {
    if (pending.current || !pickFolder) return;
    pending.current = true;
    setPicking(true);
    setError(null);
    try {
      const parent = await pickFolder("Choose where to create the project");
      if (parent) {
        locationEdited.current = true;
        setForm((f) => ({ ...f, folder: parent }));
      }
    } catch (error) {
      setError(`[FOLDER_PICK_FAILED] ${error instanceof Error ? error.message : "Could not choose a folder."} Enter a location manually or retry.`);
    } finally {
      pending.current = false;
      setPicking(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending.current) return;
    const problem = validateNewProject(form);
    if (problem) return setError(problem);
    pending.current = true;
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
    if (!result.ok) {
      pending.current = false;
      setBusy(false);
      return setError(`[${result.code}] ${result.message}`);
    }
    onCreated(result.data);
  };

  const cancel = () => {
    if (!pending.current) onCancel();
  };

  return (
    <Modal label="New project" dismissible={!busy && !picking} onClose={cancel}>
      <form className="modal-form" aria-busy={busy || picking} onSubmit={(e) => void submit(e)}>
        <h2>New project</h2>
        <fieldset disabled={busy || picking}>
          <label>
            Name
            <input value={form.name} onChange={(e) => update("name", e.target.value)} data-modal-initial-focus />
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
          {!form.folder.trim() && locationWarning && <p role="status" className="error">{locationWarning}</p>}
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
        </fieldset>
        {busy && <p role="status">Creating project... Please wait. Creation cannot be cancelled once submitted.</p>}
        {picking && <p role="status">Choosing a folder...</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={cancel} disabled={busy || picking}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || picking}>{busy ? "Creating..." : "Create"}</button>
        </div>
      </form>
    </Modal>
  );
}
