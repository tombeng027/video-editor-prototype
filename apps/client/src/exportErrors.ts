import type { ErrorContext } from "@ve/schema";
import { safeErrorContext } from "./editErrors.js";

export function exportProblem(code: string, detail: string, operation: ErrorContext["operation"],
  outcome: ErrorContext["outcome"], diagnosticId?: string) {
  return { context: safeErrorContext(code, operation === "export" ? "job" : operation === "export-status" ? "status" : "submit",
    outcome, operation, diagnosticId), detail };
}
