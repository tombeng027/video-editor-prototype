import { z } from "zod";

export const EditOperationSchema = z.enum([
  "edit", "clip-speed", "clip-trim", "clip-appearance", "clip-move", "clip-split",
  "clip-delete", "track-edit", "media-edit", "undo", "redo", "import",
  "preview", "preview-prepare", "preview-cancel", "preview-status",
  "export", "export-start", "export-cancel", "export-status",
]);
export type EditOperation = z.infer<typeof EditOperationSchema>;
export const OPERATION_LABELS: Record<EditOperation, string> = {
  edit: "editing the timeline", "clip-speed": "changing clip speed",
  "clip-trim": "trimming a clip", "clip-appearance": "changing clip appearance",
  "clip-move": "moving a clip", "clip-split": "splitting a clip",
  "clip-delete": "deleting a clip", "track-edit": "changing tracks",
  "media-edit": "changing project media", undo: "undoing an edit", redo: "redoing an edit",
  import: "importing media",
  preview: "playing a preview", "preview-prepare": "preparing an optimized preview",
  "preview-cancel": "cancelling preview preparation", "preview-status": "checking preview status",
  export: "rendering an export", "export-start": "starting an export",
  "export-cancel": "cancelling an export", "export-status": "checking export progress",
};
export const ErrorContextSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  stage: z.enum(["submit", "status", "refresh", "file", "picker", "playback", "job"]),
  outcome: z.enum(["not-applied", "unconfirmed", "unavailable", "failed"]),
  operation: EditOperationSchema,
  diagnosticId: z.uuid().optional(),
}).strict();
export type ErrorContext = z.infer<typeof ErrorContextSchema>;
export type ErrorDefinition = {
  code: string;
  stages: ErrorContext["stage"][];
  outcomes: ErrorContext["outcome"][];
  operations?: EditOperation[];
  title: string;
  explanation: string;
  next: string;
};

const rejected = (code: string, title: string, explanation: string, next: string, operations?: EditOperation[]): ErrorDefinition =>
  ({ code, stages: ["submit", "status"], outcomes: ["not-applied"], title, explanation, next, ...(operations ? { operations } : {}) });
const recovery = (code: string, title: string, explanation: string, next: string): ErrorDefinition =>
  ({ code, stages: ["submit", "status", "refresh"], outcomes: ["unconfirmed"], title, explanation, next });

const editDefinitions: readonly ErrorDefinition[] = [
  rejected("INVALID_CAPTION", "These caption values are not supported",
    "Caption cues need nonblank plain text up to 2000 characters, safe whole-frame timing with start before end, and no overlaps on the single caption lane.",
    "Shorten the text, keep the start before the end, and move or trim the cue away from its neighbors."),
  rejected("UNSUPPORTED_PROJECT_VERSION", "This project needs a compatible app version",
    "The project schema version is not supported by this build. No project file should be overwritten or replaced with an older backup.",
    "Open it with a version of the app that supports this project. Keep the original and backup unchanged."),
  rejected("INVALID_ANIMATION", "These animations do not fit this clip",
    "Animations apply only to visual clips, use listed versioned presets and at least two project frames each. Their combined duration cannot exceed the clip length.",
    "Shorten or remove entrance/exit animations before trimming, splitting or speeding up the clip. For a split, entrance stays on the left and exit on the right."),
  rejected("INVALID_ZOOM", "This zoom is not supported",
    "Zoom applies to visual clips only. The start point must come before the end point, and each scale must be 25% to 400%.",
    "Move the zoom points apart or choose scales within that range, then apply the zoom again."),
  rejected("INVALID_VOLUME", "This volume is not supported",
    "Clip volume must be between 0% and 100% of the clip's original sound.",
    "Choose a volume from 0% to 100%, or reset it to 100%."),
  rejected("INVALID_CROP", "These crop values are not supported",
    "Crop applies only to visual clips. Each inset must be 0% to 90%, with more than 5% of the source width and height remaining.",
    "Choose a visual clip and reduce the crop insets, or reset the crop."),
  rejected("INVALID_CANVAS_SIZE", "This canvas size is not supported",
    "Canvas width and height must be positive whole pixel dimensions.",
    "Choose a supported aspect-ratio preset in Preview, then try again."),
  rejected("INVALID_AUDIO_SPLIT", "This clip's audio cannot be split",
    "Only a video clip with a sound track, whose audio has not already been split, can split its audio onto an audio track.",
    "Select a video clip that still plays its own sound. If its audio was already split, edit the clip on the audio track instead."),
  rejected("TRACK_LOCKED", "This track is locked", "Locked tracks cannot be edited.", "Unlock the track, then try the edit again."),
  rejected("INVALID_SPEED", "This clip speed is not supported", "Video and audio clips support forward speeds from 0.25x to 4x. Still images stay at 1x.", "Choose a speed within that range.", ["clip-speed", "edit", "undo", "redo"]),
  rejected("INVALID_TRANSFORM", "These appearance values are not supported", "Appearance applies to visual clips only, with bounded position, zoom and opacity.", "Use position -1000 to 1000%, zoom 1 to 1000%, and opacity 0 to 100%."),
  rejected("INVALID_RANGE", "The clip would extend outside its valid range", "Source bounds or the resulting timeline position are invalid.", "Keep source In before Out and within the video source. Shorten the edit or choose another position."),
  rejected("INVALID_FRAME", "The clip cannot be split at this frame", "A split must be inside the clip and preserve whole-frame source and timeline timing at its saved speed.", "Move the playhead to a nearby frame inside the clip and try again."),
  rejected("OVERLAP", "There is not enough room on this track", "The edit would overlap another clip on the same track.", "Choose another position or track, or shorten the clip."),
  rejected("NOT_FOUND", "An item needed for this edit is no longer available", "The selected clip, track or asset could not be found.", "Check the current timeline and select the item again."),
  rejected("TRACK_KIND_MISMATCH", "This media does not fit the selected track", "Audio and visual tracks accept different kinds of media.", "Choose a compatible track."),
  rejected("DUPLICATE_ID", "This item already exists", "The edit tried to create an item with an existing identifier.", "Inspect the timeline before trying again. If it repeats, restart the app."),
  rejected("DUPLICATE_ORDER", "The track layout changed", "The new track position is already in use.", "Check the track layout and try adding the track again."),
  rejected("INVALID_TRACK_ORDER", "These tracks cannot be reordered this way", "The selected track positions are not compatible with this operation.", "Choose two different compatible tracks."),
  rejected("INVALID_TRACK_NAME", "This track name is not valid", "Track names must contain 1 to 80 characters.", "Enter a shorter non-empty track name."),
  rejected("ASSET_IN_USE", "This media is still used on the timeline", "Removing it would leave clips without their source.", "Remove its timeline clips first, or keep the asset."),
  rejected("TRACK_NOT_EMPTY", "This track still contains clips", "Only empty tracks can be removed.", "Move or remove the clips before removing the track."),
  rejected("PROJECT_NOT_EMPTY", "The frame rate cannot change yet", "A project's frame rate can only change while its timeline has no media clips or caption cues.", "Keep this frame rate or use an empty project."),
  rejected("RELINK_INVALID_FILE", "This replacement file cannot be used", "The selected replacement is not a valid source file.", "Choose the original media file from an accessible location."),
  rejected("RELINK_MISMATCH", "This is not the expected source file", "The replacement does not match the imported media fingerprint.", "Locate the matching original file instead."),
  rejected("SAVE_FAILED", "Your last edit was not saved", "The engine confirmed that saving failed without applying this edit.", "Check free disk space and project-folder permissions, then use Retry edit."),
  rejected("SAVE_CLEANUP_FAILED", "Your last edit was not saved", "The engine could not safely finish the save preparation.", "Check folder permissions and whether another program is locking project files, then use Retry edit."),
  rejected("INVALID_REQUEST", "The editor could not send this edit", "The editing engine rejected the request before applying it. The editor and engine may be out of sync.", "Restart the app to load the latest update. If it repeats, copy the error details for development."),
  rejected("NO_PROJECT", "No project is open in the editing engine", "The edit could not be applied because the engine has no active project.", "Return to Projects and reopen your project."),
  rejected("PROJECT_CHANGED", "The active project changed", "This edit belongs to a project that is no longer active.", "Return to Projects and open the intended project before editing."),
  rejected("COMMAND_OPERATION_BUSY", "The editing engine is busy", "It cannot accept another edit while earlier requests are settling.", "Wait for the current work to finish before trying again."),
  recovery("REQUEST_TIMEOUT", "The save confirmation is taking longer than expected", "The engine did not reply in time. The edit may still be saving.", "Check whether the edit saved. Do not apply it again while its result is unknown."),
  recovery("UNREACHABLE", "The editor lost contact with the editing engine", "The connection failed, so we cannot confirm whether your last edit saved.", "Check whether the edit saved when the engine is available again."),
  recovery("BAD_RESPONSE", "The save reply could not be understood", "The engine replied in a format this editor could not read. This does not tell us whether the edit saved.", "Check whether the edit saved. If this follows an update, the app may need a restart."),
  recovery("OPERATION_UNKNOWN", "The engine no longer has this edit's receipt", "The receipt may have expired or the engine may have restarted. The edit could still be in the saved project.", "Load the saved project for review and check your last edit before continuing."),
  recovery("PROJECT_CHANGED", "A different project may now be open", "The edit's result cannot be checked against this project.", "Confirm the intended project. Loading for review will not replace this editor with a different project."),
  recovery("NO_PROJECT", "The editing engine has no open project", "The last edit cannot be verified against an active project.", "Keep this editor open while checking the engine. Do not resend the edit."),
  recovery("ATTEMPT_EXISTS", "This edit was already received", "The same edit receipt already exists; sending it again could duplicate work.", "Check whether the original edit saved instead of submitting it again."),
  ...["UNAUTHORIZED", "FORBIDDEN_ORIGIN"].map((code): ErrorDefinition => ({
    code, stages: ["submit", "status", "refresh"], outcomes: ["not-applied", "unconfirmed"],
    title: "The editor cannot access the editing engine",
    explanation: "The engine refused this connection's access credentials.",
    next: "Use the desktop app's own connection. If needed, restart the app; do not share its access token.",
  })),
];

const importDefinition = (code: string, stages: ErrorContext["stage"][], outcomes: ErrorContext["outcome"][],
  title: string, explanation: string, next: string): ErrorDefinition =>
  ({ code, stages, outcomes, operations: ["import"], title, explanation, next });
const importDefinitions: readonly ErrorDefinition[] = [
  importDefinition("MEDIA_PICK_FAILED", ["picker"], ["not-applied"],
    "The file chooser could not open", "No import was sent from this selection.",
    "Close any blocked file dialog and choose Import media again. Cancelling the chooser does not import anything."),
  importDefinition("INVALID_REQUEST", ["submit"], ["not-applied"],
    "The import request was not accepted", "Import requires 1 to 50 full file paths and a supported import mode.",
    "Choose up to 50 media files. If valid selections still fail after an update, restart the app."),
  importDefinition("IMPORT_OPERATION_BUSY", ["submit"], ["not-applied"],
    "Another import is still finishing", "This new import was not started because the engine is settling an earlier one.",
    "Wait for the earlier import and check its result before importing again."),
  ...["UNAUTHORIZED", "FORBIDDEN_ORIGIN"].map((code) => importDefinition(code, ["submit", "status", "refresh"],
    ["not-applied", "unconfirmed"], "The editor cannot access the import service",
    "The editing engine refused this connection's access credentials.",
    "Use the desktop app's own connection. Do not share its access token; check the original import before retrying.")),
  importDefinition("UNSUPPORTED", ["file"], ["not-applied"],
    "This file is not supported", "No usable audio, video or supported image data was found in this file.",
    "Choose a supported media file or convert a copy to a supported format, then import only that file."),
  importDefinition("PROBE_FAILED", ["file"], ["not-applied"],
    "The editor could not read this media", "The file's duration, dimensions or media information could not be read.",
    "Check that the file plays and is accessible, and that FFmpeg is available. If needed, convert a copy and retry only this file."),
  importDefinition("ALREADY_IMPORTED", ["file"], ["not-applied"],
    "This file is already in Assets", "Matching media was already imported or appeared earlier in this selection.",
    "Use the existing asset. To edit it, add it to the timeline rather than importing another copy."),
  importDefinition("INVALID_MEDIA_PATH", ["file"], ["not-applied"],
    "Choose a full path to a media file", "The supplied path is relative or points to a folder, not a media file.",
    "Use the file chooser or enter the full path to an individual file."),
  importDefinition("FILE_NOT_FOUND", ["file"], ["not-applied"],
    "This media file could not be found", "The file or its containing folder is no longer available.",
    "Reconnect the drive or locate the file, then import only the missing file."),
  importDefinition("FILE_ACCESS_DENIED", ["file"], ["not-applied"],
    "The editor cannot read or copy this file", "Access to the source file or the copy destination was denied.",
    "Check file and project-folder permissions and whether another program is locking the file. Retry only this file."),
  importDefinition("IMPORT_CLEANUP_FAILED", ["status"], ["not-applied"],
    "The import failed and temporary copies could not be cleaned up", "This import did not add its assets to the project, but copied files may remain.",
    "Check disk space, folder permissions and file locks. Keep originals; review the project media folder before retrying. Do not delete files used by other assets."),
  importDefinition("REQUEST_TIMEOUT", ["submit", "status", "refresh"], ["unconfirmed"],
    "The import confirmation is taking longer than expected", "Reading or copying media may still be running; a timeout does not cancel it.",
    "Check import result before selecting the files again. Large copies can take time."),
  importDefinition("UNREACHABLE", ["submit", "status", "refresh"], ["unconfirmed"],
    "The editor lost contact during import", "We cannot confirm whether media was added to the project.",
    "Check import result when the engine is available again. Do not resend the selection yet."),
  importDefinition("BAD_RESPONSE", ["submit", "status", "refresh"], ["unconfirmed"],
    "The import reply could not be understood", "An unreadable reply does not prove that importing failed.",
    "Check import result. If the receipt cannot be recovered, load Assets for review before importing again."),
  importDefinition("IMPORT_RECEIPT_MISSING", ["status"], ["unconfirmed"],
    "The engine no longer has this import's receipt", "The receipt may have expired or the engine may have restarted. Imported media may still be saved.",
    "Load Assets for review. Check which files are already present before explicitly continuing; do not resend the whole selection."),
  importDefinition("ATTEMPT_EXISTS", ["submit"], ["unconfirmed"],
    "This import was already received", "The same selection receipt already exists; the original import may still complete.",
    "Check import result for the original request rather than submitting it again."),
  importDefinition("PROJECT_CHANGED", ["submit", "status", "refresh"], ["not-applied", "unconfirmed"],
    "The active project changed during import", "This result cannot safely be used in the project displayed here.",
    "Confirm which project is open. Do not import again until the intended project's asset list has been checked."),
  importDefinition("NO_PROJECT", ["submit", "status", "refresh"], ["not-applied", "unconfirmed"],
    "There is no active project for this import", "The engine has no open project against which to verify this selection.",
    "Check the engine and intended project. An unconfirmed import must be reviewed before selecting the files again."),
];

const previewDefinition = (code: string, title: string, explanation: string, next: string,
  operations: EditOperation[] = ["preview"]): ErrorDefinition => ({
  code, stages: operations.every((operation) => operation === "preview") ? ["playback"]
    : operations.every((operation) => operation === "preview-status") ? ["status", "refresh"]
      : ["submit", "job", "status", "refresh"],
  outcomes: ["unavailable", "unconfirmed"], operations, title, explanation, next,
});
const previewOperations: EditOperation[] = ["preview", "preview-prepare", "preview-cancel", "preview-status"];
const previewDefinitions: readonly ErrorDefinition[] = [
  previewDefinition("PREVIEW_OFFLINE", "Media is offline",
    "The original media is unavailable at its saved location.",
    "Right-click the asset in Assets and choose Relink to locate the original file. If you reconnected a drive, refresh preview status."),
  previewDefinition("PREVIEW_READY_TIMEOUT", "Preview is taking too long to load",
    "No decoded video frame became ready within 5 seconds. This does not prove that the file is damaged.",
    "Retry preview, then press Play. For an original video that remains slow or unsupported, prepare an optimized preview in Assets."),
  previewDefinition("PREVIEW_PLAY_BLOCKED", "Playback permission is needed",
    "The browser or desktop media player blocked playback without a permitted user gesture.",
    "Retry preview or Retry audio, then press Play yourself. Check playback permissions if this repeats."),
  previewDefinition("PREVIEW_UNSUPPORTED", "This source cannot play directly",
    "The media player reported an unsupported source or format.",
    "For original video, prepare an optimized preview. For audio or an already optimized video, check the source and try a compatible copy; keep the original."),
  previewDefinition("PREVIEW_NETWORK_FAILED", "Preview could not read media from the engine",
    "The media player reported a network error while loading media.",
    "Refresh preview status and check the engine connection and file access, then retry playback."),
  previewDefinition("PREVIEW_DECODE_FAILED", "The media player could not decode this source",
    "The source was reached but the player reported a decoding failure.",
    "For original video, try an optimized preview. If an optimized video or audio fails, check the original file and diagnostic details."),
  previewDefinition("PREVIEW_ABORTED", "Preview loading or playback was interrupted",
    "The media player reported an aborted media request.",
    "Retry preview or Retry audio, then press Play. If it repeats, refresh preview status before trying again."),
  previewDefinition("PREVIEW_IMAGE_FAILED", "The preview image could not be loaded",
    "The image request failed; this alone cannot distinguish a missing file from an unsupported image or connection problem.",
    "Refresh preview status. Relink offline media in Assets, or check that the image opens in another viewer, then retry preview."),
  previewDefinition("PROBE_FAILED", "The original video cannot be read for preparation",
    "The original path is unavailable, inaccessible or not a file.",
    "Refresh preview status and relink offline media. Check file permissions before preparing again.", ["preview-prepare"]),
  previewDefinition("UNSUPPORTED", "This asset cannot be optimized as a video",
    "Optimized preview preparation requires a video asset with usable frame-rate information.",
    "Select a video asset. Images and audio do not use video optimization.", ["preview-prepare"]),
  previewDefinition("PROJECT_CHANGED", "The project changed during preview work",
    "The engine's active project no longer matches this editor's preview request.",
    "Confirm the intended project before refreshing its status or preparing again.", previewOperations),
  previewDefinition("NO_PROJECT", "No project is open in the preview service",
    "Preview status cannot be checked against an active engine project.",
    "Check the engine and intended project before refreshing status.", previewOperations),
  previewDefinition("NOT_FOUND", "The requested preview asset was not found",
    "The video asset is no longer available in the active project.",
    "Confirm the intended project and select an existing video asset.", ["preview-prepare", "preview-cancel"]),
  ...["UNREACHABLE", "REQUEST_TIMEOUT", "BAD_RESPONSE"].map((code) => previewDefinition(code,
    code === "REQUEST_TIMEOUT" ? "Preview confirmation took too long"
      : code === "UNREACHABLE" ? "The preview service cannot be reached" : "The preview reply could not be understood",
    "The latest preview state could not be confirmed. A preparation or cancellation request may still have reached the engine.",
    "Refresh preview status before requesting preparation or cancellation again. Existing status may be out of date.", previewOperations)),
  ...["UNAUTHORIZED", "FORBIDDEN_ORIGIN"].map((code) => previewDefinition(code,
    "The editor cannot access the preview service", "The engine refused this connection's credentials.",
    "Use the desktop app's own connection. Never share its token. Refresh preview status before requesting a job again.", previewOperations)),
  previewDefinition("PREVIEW_EVENTS_UNAVAILABLE", "Live preview updates are unavailable",
    "This environment cannot open the live status stream.",
    "Refresh preview status to check preparation progress; do not assume cached progress is current.", ["preview-status"]),
  previewDefinition("PREVIEW_EVENTS_DISCONNECTED", "Live preview updates were interrupted",
    "The status stream disconnected. The editor is checking the engine snapshot.",
    "If refreshing fails, refresh preview status again when the engine is available. The job may still be running.", ["preview-status"]),
  previewDefinition("PREVIEW_EVENT_INVALID", "A live preview update could not be read",
    "The event format did not match the expected preview state. The editor is checking the engine snapshot.",
    "Refresh preview status if reconciliation fails. Copy technical details if this repeats.", ["preview-status"]),
];

const exportOperations: EditOperation[] = ["export", "export-start", "export-cancel", "export-status"];
const exportDefinition = (code: string, outcomes: ErrorContext["outcome"][], title: string,
  explanation: string, next: string, operations: EditOperation[] = exportOperations): ErrorDefinition => ({
  code, stages: operations.every((operation) => operation === "export") ? ["job"] : ["submit", "status"],
  outcomes, operations, title, explanation, next,
});
const exportDefinitions: readonly ErrorDefinition[] = [
  exportDefinition("INVALID_EXPORT_SETTINGS", ["not-applied"], "These export settings are not supported",
    "The selected format, frame rate, resolution or quality was rejected before rendering. Your project was not changed.",
    "Choose the listed export presets. If this repeats, close and reopen Export or relaunch after an update.", ["export-start"]),
  exportDefinition("EMPTY_TIMELINE", ["not-applied"], "There is nothing to export",
    "The export plan contains no visual timeline segments.",
    "Close this window and add a visual clip to the timeline before exporting.", ["export-start"]),
  exportDefinition("OFFLINE_MEDIA", ["not-applied"], "Export needs the original media",
    "At least one source used by the timeline is missing or inaccessible. Optimized previews cannot replace originals for export.",
    "Close this window, refresh media status and relink or restore the original files before trying again.", ["export-start"]),
  exportDefinition("TOO_MANY_CUTS", ["not-applied"], "This timeline exceeds the current export limit",
    "The export command would exceed the prototype's supported command-line size.",
    "Export a simpler copy of the project with fewer segments. Keep the original project; restarting will not remove this limit.", ["export-start"]),
  exportDefinition("MISSING_ASSET", ["not-applied"], "An export clip has no matching asset",
    "The timeline references media that is absent from the project's asset list.",
    "Close this window and inspect the affected clips. Keep a project backup and copy the details if the inconsistency repeats.", ["export-start"]),
  exportDefinition("EXPORT_BUSY", ["not-applied"], "Another export is still running or settling",
    "This new export was not started. An earlier export may still be rendering or cleaning up.",
    "Use Check active export to inspect it. Do not start another render until the earlier one settles.", ["export-start"]),
  exportDefinition("EXPORT_CANCELLED", ["not-applied"], "Export stopped before rendering began",
    "Cancellation interrupted the export's initial checks.",
    "Check that the intended project is open before explicitly starting a new export.", ["export-start"]),
  exportDefinition("INVALID_REQUEST", ["not-applied"], "The export request was rejected",
    "The export attempt identifier was not accepted.",
    "Close and reopen Export. If this repeats after an update, relaunch the app.", ["export-start"]),
  ...["NO_PROJECT", "PROJECT_CHANGED"].map((code) => exportDefinition(code, ["not-applied"],
    "The intended project is not available for export", "The project was closed or changed during initial export checks.",
    "Close this window and confirm the intended project before exporting again.", ["export-start"])),
  ...["REQUEST_TIMEOUT", "UNREACHABLE", "BAD_RESPONSE"].map((code) => exportDefinition(code, ["unconfirmed"],
    code === "REQUEST_TIMEOUT" ? "Export confirmation is taking longer than expected"
      : code === "UNREACHABLE" ? "The editor lost contact with the export engine" : "The export reply could not be understood",
    "The engine may still be rendering or processing cancellation. A lost reply does not stop or roll back an export.",
    "Check export status or Retry status check. Do not start another export or repeat cancellation until the matching result is confirmed.")),
  exportDefinition("EXPORT_START_UNCONFIRMED", ["unconfirmed"], "This status does not identify your export",
    "The engine returned an idle state or a different attempt. It cannot confirm this render's result.",
    "Check export status again. Do not resend the start. If the engine restarted, confirm it stopped before reloading the app."),
  ...["UNAUTHORIZED", "FORBIDDEN_ORIGIN"].map((code) => exportDefinition(code, ["unconfirmed"],
    "The editor cannot access export status", "The engine refused this connection's credentials.",
    "Use the desktop app's own connection and check export status. Never share its token or assume the render stopped.")),
  exportDefinition("EXPORT_CLEANUP_FAILED", ["failed"], "Export stopped, but cleanup needs attention",
    "Temporary or unverified output files could not all be removed, including after cancellation.",
    "Check disk space, folder permissions and file locks. Keep original media; do not treat leftover files as a completed export. Use the diagnostic reference before retrying.", ["export"]),
  exportDefinition("EXPORT_DURATION_MISMATCH", ["failed"], "The rendered duration did not match the timeline",
    "The engine rejected the output because its duration exceeded the allowed timing tolerance.",
    "Keep the project and originals. Check the timeline and copy the diagnostic reference; a short isolated export can help investigate the timing problem.", ["export"]),
  exportDefinition("EXPORT_SETTINGS_MISMATCH", ["failed"], "The rendered file did not match your output settings",
    "Verification found a different codec, size or frame rate. The unverified file was discarded rather than published.",
    "Keep your originals and project. Copy the diagnostic reference and try a short isolated export; report the selected settings if it repeats.", ["export"]),
];

export const EDIT_ERROR_DEFINITIONS: readonly ErrorDefinition[] = [
  ...editDefinitions.map((definition) => ({ ...definition,
    operations: definition.operations ?? EditOperationSchema.options.filter((operation) =>
      operation !== "import" && !previewOperations.includes(operation) && !exportOperations.includes(operation)) })),
  ...importDefinitions,
  ...previewDefinitions,
  ...exportDefinitions,
];

export function findErrorDefinition(context: ErrorContext): ErrorDefinition | undefined {
  return EDIT_ERROR_DEFINITIONS.find((item) => item.code === context.code &&
    item.stages.includes(context.stage) && item.outcomes.includes(context.outcome) &&
    (!item.operations || item.operations.includes(context.operation)));
}

export function errorFingerprint(context: ErrorContext): string {
  return `${context.code}:${context.stage}:${context.outcome}:${context.operation}`;
}

export function editErrorCopy(context: ErrorContext) {
  const definition = findErrorDefinition(context);
  const importing = context.operation === "import";
  const previewing = previewOperations.includes(context.operation);
  const exporting = exportOperations.includes(context.operation);
  return {
    catalogued: Boolean(definition),
    title: definition?.title ?? (exporting
      ? context.outcome === "failed" ? "Export could not finish" : context.outcome === "not-applied" ? "Export could not start" : "We could not confirm this export"
      : previewing
      ? context.stage === "job" ? "Optimized preview preparation failed" : "Preview encountered an unexpected problem"
      : importing
      ? context.outcome === "not-applied" ? "This media could not be imported" : "We could not confirm this import"
      : context.outcome === "not-applied" ? "This edit could not be applied" : "We could not confirm your last edit"),
    explanation: definition?.explanation ?? `An unexpected problem occurred while ${OPERATION_LABELS[context.operation]}.`,
    impact: exporting
      ? context.outcome === "not-applied"
        ? "This export request did not start a new render. Previously saved project edits are unchanged."
        : context.outcome === "failed"
          ? "No verified finished file is available from this attempt. Your project edits are unchanged; leftover files are not proof of success."
          : "Export completion or cancellation is unconfirmed. Keep this window open and check status; do not create a duplicate render."
      : previewing
      ? context.outcome === "unconfirmed"
        ? "The preview job's result is unconfirmed. This notice does not mean a timeline edit failed; check preview status before another job request."
        : "This affects preview playback or status, not a timeline edit. Timeline editing remains available unless another operation has paused it; export readiness must be checked separately."
      : importing ? (context.outcome === "unconfirmed"
      ? "The import result remains unconfirmed. Another import is paused to avoid adding the same files twice."
      : context.stage === "file" ? "This file was not added. Other files in the selection may have imported successfully."
        : context.stage === "picker" ? "No files were submitted for import."
          : "This import did not add assets to the project. Previously saved assets remain available.")
      : context.outcome === "not-applied"
      ? "The edit was not applied. Your previously saved project remains available."
      : "We do not yet know whether this edit was saved. Editing and project navigation are paused to prevent duplicate changes.",
    next: definition?.next ?? (exporting
      ? context.outcome === "failed" || context.outcome === "not-applied"
        ? "Check original media, free disk space and project-folder permissions. Inspect Error details and the diagnostic reference before explicitly trying again."
        : "Check export status. Do not resend the start or cancellation while its result remains unknown."
      : previewing
      ? context.stage === "job"
        ? "Refresh preview status, check the original file, disk space and folder permissions, and inspect the diagnostic reference before retrying optimization. Supported originals can still play without optimization."
        : "Refresh preview status and inspect the technical details. Keep original media; do not assume a preparation job failed or resend it before checking its status."
      : importing
      ? context.outcome === "not-applied"
        ? "Review Assets and the technical details before retrying only failed files. Copy the diagnostic reference if the problem repeats."
        : "Check import result. Do not import the selection again until its result is confirmed or you have reviewed the saved asset list."
      : context.outcome === "not-applied"
      ? "Review the timeline before trying again. Copy the details if the problem repeats."
      : "Check whether the edit saved. Do not submit the edit again until its result is confirmed."),
  };
}

export const UnknownErrorRecordSchema = ErrorContextSchema.extend({
  fingerprint: z.string().max(180),
  appVersion: z.string().regex(/^[A-Za-z0-9.+_-]{1,40}$/),
  firstSeen: z.iso.datetime(),
  lastSeen: z.iso.datetime(),
  count: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  task: z.literal("pending-catalog-update"),
}).strict();
export type UnknownErrorRecord = z.infer<typeof UnknownErrorRecordSchema>;
export const UnknownErrorListSchema = z.object({
  records: z.array(UnknownErrorRecordSchema).max(100),
  capacityReached: z.boolean(),
});

// Add exact fingerprints here only after investigation, a definition and regression verification.
export const VERIFIED_ERROR_RESOLUTIONS: readonly string[] = [];
