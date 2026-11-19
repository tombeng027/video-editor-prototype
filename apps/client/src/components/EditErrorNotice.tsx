import { OPERATION_LABELS, editErrorCopy, type ErrorContext } from "@ve/schema";

export function EditErrorNotice({ context, detail, fileName }: { context: ErrorContext; detail: string; fileName?: string }) {
  const copy = editErrorCopy(context);
  return <section className="recovery-notice" role="alert" aria-label={context.operation.startsWith("export") ? "Export problem" : context.operation.startsWith("preview") ? "Preview problem" : context.operation === "import" ? "Import problem" : "Edit problem"}>
    <strong>{copy.title}</strong>
    {fileName && <p>File: {fileName}</p>}
    <p>{copy.catalogued ? `While ${OPERATION_LABELS[context.operation]}: ` : ""}{copy.explanation}</p>
    <p>{copy.impact}</p>
    <p>{copy.next}</p>
    <details>
      <summary>Error details</summary>
      <p>Code: {context.code} | Stage: {context.stage} | Outcome: {context.outcome}</p>
      {context.diagnosticId && <p>Diagnostic ID: {context.diagnosticId}</p>}
      <p>{detail}</p>
      {!copy.catalogued && <p>This problem has no matching help definition yet. A local development follow-up is being recorded; recording failures are shown separately.</p>}
    </details>
  </section>;
}
