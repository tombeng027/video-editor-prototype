import { useState } from "react";
import { OPERATION_LABELS, type UnknownErrorRecord } from "@ve/schema";
import type { EngineConfig } from "../engine.js";
import { getUnknownEditErrors } from "../projectApi.js";

export function UnknownErrorInbox({ config, recordingError }: { config: EngineConfig; recordingError: string | null }) {
  const [records, setRecords] = useState<UnknownErrorRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capacityReached, setCapacityReached] = useState(false);
  const load = async () => {
    setLoading(true);
    const result = await getUnknownEditErrors(config);
    setLoading(false);
    if (!result.ok) {
      setError("The local development inbox could not be read. Check the engine connection and local diagnostic storage.");
      return;
    }
    setRecords(result.data.records);
    setCapacityReached(result.data.capacityReached);
    setLoaded(true);
    setError(null);
  };
  return <details className="development-inbox">
    <summary>Development: unknown-error follow-ups</summary>
    <p>Temporary local tasks for the next development pass. No automatic upload; no media or project paths are included.</p>
    <button onClick={() => void load()} disabled={loading}>{loading ? "Loading follow-ups..." : "Load local follow-ups"}</button>
    {(recordingError || error) && <p role="alert">{recordingError ?? error}</p>}
    {capacityReached && <p>The inbox is full (100 groups). Existing tasks were kept; new groups cannot be recorded until verified resolutions free space.</p>}
    {loaded && records.length === 0 && <p>No uncatalogued edit, import, preview or export errors are awaiting development.</p>}
    {records.map((record) => <details key={record.fingerprint}>
      <summary>Pending: investigate {record.code} while {OPERATION_LABELS[record.operation]} ({record.count} occurrences)</summary>
      <p>Next development: investigate the cause, add a matching catalog definition and regression test, verify recovery, then add this exact fingerprint to verified resolutions.</p>
      <label>Development task report (select and copy)
        <textarea readOnly rows={10} value={JSON.stringify(record, null, 2)} />
      </label>
    </details>)}
  </details>;
}
