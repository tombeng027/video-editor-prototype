import { z } from "zod";
import { CommandSchema } from "./commands.js";
import { ProjectSchema, RationalSchema } from "./project.js";
import { ExportSettingsSchema, ResolvedExportSettingsSchema } from "./exportSettings.js";

export const ComponentStatusSchema = z.object({
  name: z.enum(["engine", "ffmpeg", "ollama", "vision"]),
  status: z.enum(["ok", "unavailable", "unknown"]),
  detail: z.string().optional(),
  hint: z.string().optional(),
});
export type ComponentStatus = z.infer<typeof ComponentStatusSchema>;

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  components: z.array(ComponentStatusSchema),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), diagnosticId: z.uuid().optional() }),
  outcome: z.literal("not-applied").optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const TOKEN_HEADER = "x-engine-token";
export const TOKEN_QUERY = "token";

export const CreateProjectRequestSchema = z.object({
  attemptId: z.uuid().optional(),
  folder: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  fps: RationalSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fpsFromFirstImport: z.boolean().optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const OpenProjectRequestSchema = z.object({ folder: z.string().min(1), attemptId: z.uuid().optional() });
export type OpenProjectRequest = z.infer<typeof OpenProjectRequestSchema>;

export const CloseProjectRequestSchema = z.object({
  expectedProject: z.object({ id: z.string().min(1), folder: z.string().min(1) }).optional(),
});
export type CloseProjectRequest = z.infer<typeof CloseProjectRequestSchema>;

export const ProjectResponseSchema = z.object({
  folder: z.string(),
  project: ProjectSchema,
  recoveredFromBackup: z.boolean(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
});
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

export const ProjectOperationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending"), attemptId: z.uuid() }),
  z.object({ state: z.literal("done"), attemptId: z.uuid(), response: ProjectResponseSchema }),
  z.object({ state: z.literal("failed"), attemptId: z.uuid(), error: ApiErrorSchema.shape.error }),
]);
export type ProjectOperation = z.infer<typeof ProjectOperationSchema>;

export const CommandsRequestSchema = z.object({ attemptId: z.uuid().optional(), commands: z.array(CommandSchema).min(1) });
export type CommandsRequest = z.infer<typeof CommandsRequestSchema>;

export const CommandsResponseSchema = z.object({
  project: ProjectSchema,
  inverse: z.array(CommandSchema),
});
export type CommandsResponse = z.infer<typeof CommandsResponseSchema>;

export const CommandOperationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending"), attemptId: z.uuid() }),
  z.object({ state: z.literal("done"), attemptId: z.uuid(), response: CommandsResponseSchema }),
  z.object({ state: z.literal("failed"), attemptId: z.uuid(), error: ApiErrorSchema.shape.error }),
  z.object({ state: z.literal("unknown"), attemptId: z.uuid(), error: ApiErrorSchema.shape.error }),
]);
export type CommandOperation = z.infer<typeof CommandOperationSchema>;

export const RecentProjectSchema = z.object({
  folder: z.string(),
  name: z.string(),
  openedAt: z.string(),
  exists: z.boolean(),
});
export type RecentProject = z.infer<typeof RecentProjectSchema>;

export const RecentProjectsResponseSchema = z.object({ projects: z.array(RecentProjectSchema) });
export type RecentProjectsResponse = z.infer<typeof RecentProjectsResponseSchema>;
export const DefaultFolderResponseSchema = z.object({ folder: z.string() });

export const ImportRequestSchema = z.object({
  attemptId: z.uuid().optional(),
  paths: z.array(z.string().min(1)).min(1).max(50),
  mode: z.enum(["reference", "copy"]),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const ImportResponseSchema = z.object({
  project: ProjectSchema,
  imported: z.array(z.object({ assetId: z.string(), name: z.string() })),
  failed: z.array(z.object({ path: z.string(), code: z.string(), message: z.string(), diagnosticId: z.uuid().optional() })),
});
export type ImportResponse = z.infer<typeof ImportResponseSchema>;

export const ImportOperationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending"), attemptId: z.uuid() }),
  z.object({ state: z.literal("done"), attemptId: z.uuid(), response: ImportResponseSchema }),
  z.object({ state: z.literal("failed"), attemptId: z.uuid(), error: ApiErrorSchema.shape.error }),
  z.object({ state: z.literal("unknown"), attemptId: z.uuid(), error: ApiErrorSchema.shape.error }),
]);
export type ImportOperation = z.infer<typeof ImportOperationSchema>;

export const ProxyStateSchema = z.object({
  assetId: z.string(),
  state: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  percent: z.number().min(0).max(100),
  message: z.string().optional(),
  diagnosticId: z.uuid().optional(),
});
export type ProxyState = z.infer<typeof ProxyStateSchema>;
export const PreviewJobRequestSchema = z.object({
  assetId: z.string().min(1),
  action: z.enum(["prepare", "cancel"]),
  expectedProject: z.object({ id: z.string().min(1), folder: z.string().min(1) }),
});
export type PreviewJobRequest = z.infer<typeof PreviewJobRequestSchema>;

export const ProxyListResponseSchema = z.object({ proxies: z.array(ProxyStateSchema) });
export type ProxyListResponse = z.infer<typeof ProxyListResponseSchema>;
export const OfflineAssetSchema = z.object({ assetId: z.string(), name: z.string(), path: z.string() });
export type OfflineAsset = z.infer<typeof OfflineAssetSchema>;

export const MediaStatusResponseSchema = z.object({ projectId: z.string().min(1), offline: z.array(OfflineAssetSchema) });
export type MediaStatusResponse = z.infer<typeof MediaStatusResponseSchema>;

export const StartExportRequestSchema = z.strictObject({
  attemptId: z.uuid().optional(),
  settings: ExportSettingsSchema.optional(),
});

export const ExportStateSchema = z.object({
  attemptId: z.uuid().optional(),
  settings: ResolvedExportSettingsSchema.optional(),
  state: z.enum(["idle", "running", "done", "failed", "cancelled"]),
  percent: z.number().min(0).max(100),
  outputPath: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  diagnosticId: z.uuid().optional(),
});
export type ExportState = z.infer<typeof ExportStateSchema>;