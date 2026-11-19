import { useRef, useState } from "react";
import { ANIMATION_CATALOG, EDIT_ERROR_DEFINITIONS, OPERATION_LABELS } from "@ve/schema";
import type { HealthResult } from "../engine.js";
import { APP_VERSION, CREDIT_NAME, FEATURE_GROUPS, HELP_GUIDES, OPEN_SOURCE_CREDITS, SUPPORT_LINKS } from "../helpContent.js";
import { Modal } from "./Modal.js";

const TABS = ["About", "How to use", "Current features", "Animation catalog", "Errors & troubleshooting"] as const;
type Tab = typeof TABS[number];

export function HelpDialog({ health, onClose }: { health: HealthResult | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("About");
  const [query, setQuery] = useState("");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const search = query.trim().toLowerCase();
  const definitions = EDIT_ERROR_DEFINITIONS.filter((item) =>
    [item.code, item.title, item.explanation, item.next, ...(item.operations?.map((op) => OPERATION_LABELS[op]) ?? [])]
      .join(" ").toLowerCase().includes(search));
  return <Modal label="Help" dismissible onClose={onClose}>
    <div className="help-dialog">
      <div className="row"><h1>Help</h1><span className="spacer" /><button onClick={onClose}>Close help</button></div>
      <div role="tablist" aria-label="Help sections" className="help-tabs">
        {TABS.map((name, index) => <button key={name} ref={(el) => { tabs.current[index] = el; }}
          role="tab" id={`help-tab-${index}`} aria-controls="help-panel" aria-selected={tab === name}
          tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % TABS.length
              : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
                : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
            if (next === null) return;
            event.preventDefault();
            setTab(TABS[next]!);
            tabs.current[next]?.focus();
          }}>{name}</button>)}
      </div>
      <section id="help-panel" role="tabpanel" aria-labelledby={`help-tab-${TABS.indexOf(tab)}`} tabIndex={0} className="help-panel">
        {tab === "About" && <>
          <h2>Video Editor Prototype</h2>
          <p>Client version: {APP_VERSION}. Development prototype.</p>
          <p>Editing engine version: {health?.state === "ok" ? health.health.version : "Unavailable - engine connection not confirmed."}</p>
          <p>A Windows-first local video editor with manual timeline editing and a planned AI assistant.</p>
          <p>Project files, media processing and export run locally. This Help window works offline and sends no requests. Unknown-error follow-ups stay local with no automatic upload.</p>
          <p>Build identifier: not supplied in this development build. Version alone does not identify a source revision.</p>
          <h2>Credits and support</h2>
          <p>Built by {CREDIT_NAME}.</p>
          <p>Thank you to everyone who tries, tests, shares feedback or supports this project. It means a lot.</p>
          <ul>{SUPPORT_LINKS.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a></li>)}</ul>
          <p>Made possible by open-source software: {OPEN_SOURCE_CREDITS.join(", ")}. See each project for its licence.</p>
        </>}
        {tab === "How to use" && HELP_GUIDES.map((guide) => <section key={guide.title}>
          <h2>{guide.title}</h2><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
        </section>)}
        {tab === "Current features" && FEATURE_GROUPS.map((group) => <section key={group.title}>
          <h2>{group.title}</h2><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>)}
        {tab === "Animation catalog" && <>
          <h2>Entrance and exit animation catalog</h2>
          <p>Choose an animation in Properties, set its length with the slider or − / + buttons and Apply animations. None removes that end's effect. Length is a percentage of the clip (default about 0.5 seconds) with smooth start/stop.</p>
          <p>Entrance and exit together can use up to 100% of the clip, and lengths rescale when you trim or change speed. Split keeps entrance on the left and exit on the right at the same on-screen length. Visual animations do not fade audio or move neighboring clips.</p>
          {(["entrance", "exit"] as const).map((phase) => <section key={phase}>
            <h3>{phase === "entrance" ? "Entrance presets" : "Exit presets"}</h3>
            {ANIMATION_CATALOG.filter((item) => item.phase === phase).map((item) => <article key={item.id}>
              <h4>{item.name}</h4><p>{item.description}</p>
              <p className="muted">{item.id}, version {item.version}; default about {item.defaultSeconds} seconds of the clip.</p>
            </article>)}
          </section>)}
          <p>This shared built-in catalog can grow. Custom animation editing and neighboring crossfades are future features, not available controls.</p>
        </>}
        {tab === "Errors & troubleshooting" && <>
          <h2>Edit/save, import, preview and export error catalog</h2>
          <p>Match the code, operation and outcome in Error details. For imports, a file failure does not mean other selected files failed. A code alone never proves whether an operation completed.</p>
          <label>Search errors<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Code, cause or next step" /></label>
          <p role="status">{definitions.length} matching definitions</p>
          {definitions.length === 0 && <p>No catalog match. Follow the actual notice's safe actions. An unknown edit, import, preview or export error creates a temporary local development follow-up when recording is available.</p>}
          {definitions.map((item) => <article key={`${item.code}:${item.outcomes.join()}:${item.operations?.join()}`} className="help-error">
            <h3>{item.title} <code>{item.code}</code></h3>
            <p>{item.explanation}</p><p><strong>Next step:</strong> {item.next}</p>
            <p className="muted">Applies when: {item.outcomes.map((outcome) => outcome === "not-applied" ? "confirmed not applied" : outcome === "unavailable" ? "preview unavailable or status stale" : outcome === "failed" ? "render failed with no verified finished file" : "result unconfirmed").join(" or ")}.
              {" "}Stage: {item.stages.join(", ")}.
              {item.operations && ` Operation: ${item.operations.map((op) => OPERATION_LABELS[op]).join(", ")}.`}</p>
          </article>)}
          <h3>If the error is not listed</h3>
          <p>Confirmed rejection: the edit was not applied; inspect the cause before trying again. Unconfirmed result: do not resend it. Use Check whether edit saved, then load the saved project for review only if needed.</p>
          <p>For imports, use Check import result; if the receipt is unavailable, Load Assets for review and check which files are already present before continuing. Retry only failed or missing files.</p>
          <p>Preview problems do not mean a timeline edit failed. Refresh preview status, relink offline originals or explicitly retry playback as directed. Check job status before repeating preparation or cancellation; optimization is optional for supported originals.</p>
          <p>For export, use Check export status after a lost start response, or Retry status check after progress updates fail. A cancellation acknowledgement is not completion: wait for confirmed cleanup. Leftover files from failed cleanup are not verified exports.</p>
          <p>Development follow-ups are separate from normal help: expand Development: unknown-error follow-ups in the editor to load sanitized local task reports. Generic engine/FFmpeg failures still need investigation; a catalog is not proof every root cause is fixed.</p>
        </>}
      </section>
    </div>
  </Modal>;
}
