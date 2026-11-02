import { randomUUID } from "node:crypto";

type DiagnosticCode = "ENGINE_UNEXPECTED_ERROR" | "PROJECT_PREPARATION_FAILED" | "PROJECT_OPERATION_FAILED";
type Context = { method?: string; route?: string };
const errorNames = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "AggregateError"]);
const ioCodes = new Set(["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EISDIR", "EEXIST", "ENOSPC", "EROFS",
  "EIO", "EMFILE", "ENFILE", "EBUSY", "EXDEV", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND"]);

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
  console.error(JSON.stringify({ time: new Date().toISOString(), level: "error", code, diagnosticId,
    ...context, causes }));
  return diagnosticId;
}
