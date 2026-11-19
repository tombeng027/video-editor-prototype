import { describe, expect, it } from "vitest";
import { COMMAND_ERROR_CODES } from "./commands.js";
import { EDIT_ERROR_DEFINITIONS, ErrorContextSchema, editErrorCopy, errorFingerprint, findErrorDefinition, type ErrorContext } from "./errorCatalog.js";

const context: ErrorContext = { code: "TRACK_LOCKED", stage: "submit", outcome: "not-applied", operation: "clip-speed" };
describe("edit error catalog", () => {
  it("covers every reducer rejection with readable cause, impact and next action", () => {
    for (const code of COMMAND_ERROR_CODES) {
      const copy = editErrorCopy({ ...context, code, operation: "edit" });
      expect(copy.catalogued).toBe(true);
      expect(copy.title.length).toBeGreaterThan(5);
      expect(copy.explanation.length).toBeGreaterThan(10);
      expect(copy.next.length).toBeGreaterThan(10);
      expect(copy.impact).toContain("not applied");
    }
    expect(EDIT_ERROR_DEFINITIONS.length).toBeGreaterThan(20);
  });
  it("matches stage, outcome and relevant operation rather than code alone", () => {
    expect(findErrorDefinition(context)).toBeDefined();
    expect(findErrorDefinition({ ...context, stage: "refresh" })).toBeUndefined();
    expect(findErrorDefinition({ ...context, outcome: "unconfirmed" })).toBeUndefined();
    expect(findErrorDefinition({ ...context, code: "INVALID_SPEED", operation: "media-edit" })).toBeUndefined();
    expect(errorFingerprint(context)).not.toBe(errorFingerprint({ ...context, stage: "status" }));
    expect(editErrorCopy({ ...context, code: "OPERATION_UNKNOWN", outcome: "unconfirmed", stage: "status" }).next).toContain("review");
  });
  it("does not mistake generic unexpected-error envelopes for catalogued root causes", () => {
    for (const code of ["NEW_FAILURE", "ENGINE_UNEXPECTED_ERROR", "HTTP_500"]) {
      const unknown = editErrorCopy({ ...context, code, outcome: "unconfirmed" });
      expect(unknown.catalogued).toBe(false);
      expect(unknown.impact).toContain("do not yet know");
      expect(unknown.impact).not.toContain("not applied");
      expect(unknown.explanation).toContain("changing clip speed");
      expect(editErrorCopy({ ...context, code }).impact).toContain("not applied");
    }
  });
  it("rejects payloads with raw messages, paths, tokens or invalid diagnostic references", () => {
    for (const field of ["message", "path", "token", "stack", "projectId"]) {
      expect(ErrorContextSchema.safeParse({ ...context, [field]: "private" }).success).toBe(false);
    }
    expect(ErrorContextSchema.safeParse({ ...context, code: "C:\\Private\\file" }).success).toBe(false);
    expect(ErrorContextSchema.safeParse({ ...context, diagnosticId: "private" }).success).toBe(false);
  });
  it("separates import causes and file results from timeline-edit guidance", () => {
    const importing: ErrorContext = { ...context, operation: "import", code: "ALREADY_IMPORTED", stage: "file" };
    expect(editErrorCopy(importing).title).toContain("already in Assets");
    expect(editErrorCopy(importing).impact).toContain("Other files");
    expect(findErrorDefinition({ ...importing, operation: "edit" })).toBeUndefined();
    expect(findErrorDefinition({ ...importing, code: "TRACK_LOCKED", stage: "submit" })).toBeUndefined();
    expect(editErrorCopy({ ...importing, code: "PROJECT_CHANGED", stage: "refresh", outcome: "unconfirmed" }).impact).not.toContain("did not add");
    for (const code of ["IMPORT_FAILED", "IMPORT_OUTCOME_UNKNOWN", "ENGINE_UNEXPECTED_ERROR"]) {
      const copy = editErrorCopy({ ...importing, code });
      expect(copy.catalogued).toBe(false);
      expect(copy.title).toContain("media");
      expect(copy.next).toContain("only failed files");
    }
    expect(editErrorCopy({ ...importing, code: "IMPORT_RECEIPT_MISSING", stage: "status", outcome: "unconfirmed" }).next).toContain("Load Assets");
  });
  it("keeps preview availability and uncertain jobs separate from edit/save outcomes", () => {
    const preview: ErrorContext = { code: "PREVIEW_READY_TIMEOUT", stage: "playback", outcome: "unavailable", operation: "preview" };
    expect(editErrorCopy(preview).catalogued).toBe(true);
    expect(editErrorCopy(preview).impact).toContain("not a timeline edit");
    expect(editErrorCopy(preview).impact).not.toContain("edit was not applied");
    expect(findErrorDefinition({ ...preview, stage: "submit" })).toBeUndefined();
    expect(findErrorDefinition({ ...preview, code: "TRACK_LOCKED" })).toBeUndefined();
    expect(findErrorDefinition({ ...context, code: "PREVIEW_READY_TIMEOUT" })).toBeUndefined();
    const pending = editErrorCopy({ ...preview, operation: "preview-cancel", code: "REQUEST_TIMEOUT", stage: "submit", outcome: "unconfirmed" });
    expect(pending.catalogued).toBe(true);
    expect(pending.impact).toContain("job's result is unconfirmed");
    expect(pending.impact).not.toContain("Editing and project navigation are paused");
    for (const code of ["PREVIEW_JOB_FAILED", "PREVIEW_PLAYBACK_FAILED", "PREVIEW_MEDIA_FAILED", "ENGINE_UNEXPECTED_ERROR"]) {
      expect(editErrorCopy({ ...preview, code }).catalogued).toBe(false);
    }
  });
  it("matches export stage and outcome without reusing timeline-edit claims", () => {
    const start: ErrorContext = { code: "OFFLINE_MEDIA", stage: "submit", outcome: "not-applied", operation: "export-start" };
    for (const code of ["EMPTY_TIMELINE", "OFFLINE_MEDIA", "TOO_MANY_CUTS", "MISSING_ASSET", "EXPORT_BUSY", "EXPORT_CANCELLED", "NO_PROJECT", "PROJECT_CHANGED", "INVALID_REQUEST", "INVALID_EXPORT_SETTINGS"]) {
      expect(editErrorCopy({ ...start, code }).catalogued).toBe(true);
      expect(editErrorCopy({ ...start, code }).impact).toContain("did not start a new render");
    }
    expect(findErrorDefinition({ ...start, operation: "edit" })).toBeUndefined();
    expect(findErrorDefinition({ ...start, code: "TRACK_LOCKED" })).toBeUndefined();
    expect(findErrorDefinition({ ...start, outcome: "unconfirmed" })).toBeUndefined();
    for (const code of ["EXPORT_CLEANUP_FAILED", "EXPORT_DURATION_MISMATCH", "EXPORT_SETTINGS_MISMATCH"]) {
      const copy = editErrorCopy({ ...start, code, operation: "export", stage: "job", outcome: "failed" });
      expect(copy.catalogued).toBe(true);
      expect(copy.impact).toContain("No verified finished file");
      expect(copy.impact).not.toContain("edit was not applied");
    }
    const unknown = editErrorCopy({ ...start, code: "EXPORT_FAILED", operation: "export", stage: "job", outcome: "failed" });
    expect(unknown.catalogued).toBe(false);
    expect(unknown.title).toBe("Export could not finish");
    const cancel = editErrorCopy({ ...start, code: "REQUEST_TIMEOUT", operation: "export-cancel", outcome: "unconfirmed" });
    expect(cancel.catalogued).toBe(true);
    expect(cancel.impact).toContain("cancellation is unconfirmed");
  });
});
