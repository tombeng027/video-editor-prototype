import { ErrorContextSchema, type Command, type EditOperation, type ErrorContext } from "@ve/schema";

export function editOperation(commands: Command[], action: "record" | "undo" | "redo"): EditOperation {
  if (action !== "record") return action;
  const command = commands.length === 1 ? commands[0] : undefined;
  if (!command) return "edit";
  switch (command.type) {
    case "SetClipSpeed": return "clip-speed";
    case "SetClipTransform": case "SetClipAnimations": case "SetClipZoom": return "clip-appearance";
    case "TrimClip": return "clip-trim";
    case "MoveClip": return "clip-move";
    case "SplitClip": return "clip-split";
    case "RemoveClip": return "clip-delete";
    case "AddTrack": case "RemoveTrack": case "SetTrackLocked": case "SetTrackName":
    case "SetTrackMuted": case "SwapTrackOrder": return "track-edit";
    case "AddAsset": case "RemoveAsset": case "RelinkAsset": case "SetAssetProxy": return "media-edit";
    default: return "edit";
  }
}

export function safeErrorContext(code: string, stage: ErrorContext["stage"], outcome: ErrorContext["outcome"],
  operation: EditOperation, diagnosticId?: string): ErrorContext {
  const diagnostic = ErrorContextSchema.shape.diagnosticId.safeParse(diagnosticId);
  return ErrorContextSchema.parse({
    code: /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "UNRECOGNIZED_CODE", stage, outcome, operation,
    ...(diagnostic.success && diagnostic.data ? { diagnosticId: diagnostic.data } : {}),
  });
}
