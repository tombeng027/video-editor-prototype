import { useEffect, useState } from "react";
import { findClip } from "@ve/timeline-core";
import type { Project } from "@ve/schema";
import { canLockCrop, editCrop, NO_CROP, type CropControls, type CropSide } from "../cropEdit.js";

export function CropProperties({ project, selectedClipId, controls, disabledReason }: {
  project: Project; selectedClipId: string | null; controls: CropControls; disabledReason?: string;
}) {
  const found = selectedClipId ? findClip(project, selectedClipId) : undefined;
  const asset = project.assets.find((item) => item.id === found?.clip.assetId);
  const saved = found?.clip.crop ?? NO_CROP;
  const crop = controls.draft?.clipId === selectedClipId ? controls.draft.crop : saved;
  const [values, setValues] = useState(crop);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValues(crop); setError(null); }, [crop, selectedClipId]);
  if (!found || found.track.kind === "audio") return null;
  const reason = disabledReason ?? (found.track.locked ? "Unlock the track before cropping."
    : controls.offline?.has(found.clip.assetId) ? "Relink the offline source before cropping."
      : !asset?.width || !asset.height ? "Source dimensions are required for crop editing." : undefined);
  const disabled = Boolean(reason);
  const canLock = Boolean(asset?.width && asset.height && canLockCrop({ width: asset.width, height: asset.height }, project.settings));
  return <form aria-label="Clip crop" onSubmit={(event) => {
    event.preventDefault();
    if (!disabled && !error && (controls.mode !== "locked" || canLock)) controls.onCommit(found.clip.id, values);
  }}><fieldset disabled={disabled} title={reason}>
    <legend>Crop</legend>
    <button type="button" aria-pressed={controls.active} onClick={() => controls.onActive(!controls.active)}>Crop mode</button>
    <label>Crop constraint<select value={controls.mode} disabled={!controls.active}
      title={!controls.active ? "Enter Crop mode to change the crop constraint." : undefined}
      onChange={(event) => { if (controls.active) controls.onMode(event.target.value === "locked" ? "locked" : "free"); }}>
      <option value="free">Free-form</option><option value="locked" disabled={!canLock}>Project aspect locked</option>
    </select></label>
    <p className="muted" aria-label="Crop mode status">{controls.active ? "Crop active" : "Crop off"}: {controls.mode === "free" ? "Free-form" : "Project aspect locked"}</p>
    {(["left", "top", "right", "bottom"] as CropSide[]).map((side) => <label key={side}>Crop {side} (%)
      <input type="number" min={0} max={90} step="any" value={Number((values[side] * 100).toFixed(4))}
        onChange={(event) => {
          if (disabled || !asset?.width || !asset.height) return;
          const value = event.target.valueAsNumber;
          if (!Number.isFinite(value) || value < 0 || value > 90) { setError("Enter a crop percentage from 0 to 90."); return; }
          const opposite = { left: "right", right: "left", top: "bottom", bottom: "top" } as const;
          if (value / 100 + values[opposite[side]] >= 0.95) { setError("Opposing crop edges must retain more than 5% of the source."); return; }
          if (controls.mode === "locked" && !canLock) { setError("The project aspect ratio cannot fit within this source's crop limits. Choose Free-form."); return; }
          const next = editCrop(values, side, value / 100, controls.mode, { width: asset.width, height: asset.height }, project.settings);
          setValues(next); setError(null); controls.onDraft(found.clip.id, next);
        }} />
    </label>)}
    <div className="row"><button type="submit" disabled={Boolean(error)}>Apply crop</button><button type="button" onClick={() => {
      setValues(NO_CROP); setError(null); controls.onCommit(found.clip.id);
    }}>Reset crop</button><button type="button" onClick={() => {
      setValues(saved); setError(null); controls.onDraft(found.clip.id, null);
    }}>Cancel crop draft</button></div>
    <p className="muted">Insets are percentages of the source. Apply saves one Undo step. Aspect lock adjusts the other dimension around its center on the next crop edit. Reset removes crop without changing effects.</p>
    {!canLock && <p className="muted">Project aspect lock is unavailable: this source would exceed the crop limits.</p>}
    {reason && <p className="muted">{reason}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </fieldset></form>;
}
