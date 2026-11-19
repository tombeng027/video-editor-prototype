import { randomUUID } from "node:crypto";
import { DiagnosticStore } from "./diagnosticStore.js";

type DiagnosticCode = "ENGINE_UNEXPECTED_ERROR" | "PROJECT_PREPARATION_FAILED" | "PROJECT_OPERATION_FAILED" | "BACKGROUND_JOB_FAILED" | "IMPORT_FILE_FAILED";
type Context = { method?: string; route?: string };
const errorNames = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AggregateError"]);
const ioCodes = new Set(["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EISDIR", "EEXIST", "ENOSPC", "EROFS",
  "EIO", "EMFILE", "ENFILE", "EBUSY", "EXDEV", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND"]);
let store: DiagnosticStore | undefined;
let storeFailureReported = false;
let budgetWarningReported = false;

function writeSinkWarning(message: string, error: unknown): void {
  const ioCode = error instanceof Error && "code" in error && typeof error.code === "string" && ioCodes.has(error.code)
    ? ` (${error.code})` : "";
  process.stderr.write(`[ENGINE_DIAGNOSTIC_SINK_FAILED] ${message}${ioCode}\n`);
}

export function configureDiagnosticSink(dataDir: string): void {
  try {
    store = new DiagnosticStore(dataDir);
    storeFailureReported = false;
    budgetWarningReported = false;
    if (store.exceedsSoftBudget) {
      budgetWarningReported = true;
      process.stderr.write("[ENGINE_DIAGNOSTIC_STORAGE_LIMIT] Local diagnostic logs exceed the soft storage budget; active logs were preserved.\n");
    }
  } catch (error) {
    store = undefined;
    storeFailureReported = true;
    writeSinkWarning("Could not initialize the local diagnostic log; structured diagnostics remain on stderr.", error);
  }
}

export function closeDiagnosticSink(): void {
  store = undefined;
}

export function reportDiagnostic(code: DiagnosticCode, error: unknown, context: Context = {}): string {
  const diagnosticId = randomUUID();
  const causes: { name: string; ioCode?: string }[] = [];
  let current = error;
  const seen = new Set<unknown>();
  for (let i = 0; i < 3 && current instanceof Error && !seen.has(current); i++) {
    seen.add(current);
    const ioCode = "code" in current && typeof current.code === "string" && ioCodes.has(current.code)
      ? current.code : undefined;
    causes.push({ name: errorNames.has(current.name) ? current.name : "Error", ...(ioCode ? { ioCode } : {}) });
    current = current.cause;
  }
  // Callers supply registered route templates, never raw URLs, params, headers or bodies.
  const record = JSON.stringify({ time: new Date().toISOString(), level: "error", code, diagnosticId, ...context, causes });
  console.error(record);
  if (store) {
    try {
      store.append(record);
      if (store.exceedsSoftBudget && !budgetWarningReported) {
        budgetWarningReported = true;
        process.stderr.write("[ENGINE_DIAGNOSTIC_STORAGE_LIMIT] Local diagnostic logs exceed the soft storage budget; active logs were preserved.\n");
      }
    } catch (sinkError) {
      store = undefined;
      if (!storeFailureReported) {
        storeFailureReported = true;
        writeSinkWarning("Could not append to the local diagnostic log; future records remain on stderr.", sinkError);
      }
    }
  }
  return diagnosticId;
}
