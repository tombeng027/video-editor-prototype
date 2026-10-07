import type { HealthResult } from "../engine.js";
import { StatusArea } from "./StatusArea.js";

type Props = { health: HealthResult | null; onCreate: () => void };

export function Landing({ health, onCreate }: Props) {
  return (
    <main className="landing">
      <h1>Video Editor Prototype</h1>
      <div className="actions">
        <button className="primary" onClick={onCreate}>Create new project</button>
        <button disabled title="Available in M2">Open project…</button>
      </div>
      <section aria-label="Recent projects">
        <h2>Recent projects</h2>
        <p className="placeholder">No recent projects yet. Saving and opening arrive in M2.</p>
      </section>
      <StatusArea result={health} />
    </main>
  );
}
