import { z } from "zod";
import { CommandSchema } from "./commands.js";
import { ProjectSchema, RationalSchema } from "./project.js";

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
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const TOKEN_HEADER = "x-engine-token";
export const TOKEN_QUERY = "token";

export const CreateProjectRequestSchema = z.object({
  folder: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  fps: RationalSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fpsFromFirstImport: z.boolean().optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const OpenProjectRequestSchema = z.object({ folder: z.string().min(1) });
export type OpenProjectRequest = z.infer<typeof OpenProjectRequestSchema>;

export const ProjectResponseSchema = z.object({
  folder: z.string(),
  project: ProjectSchema,
  recoveredFromBackup: z.boolean(),
});
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

export const CommandsRequestSchema = z.object({ commands: z.array(CommandSchema).min(1) });
export type CommandsRequest = z.infer<typeof CommandsRequestSchema>;

export const CommandsResponseSchema = z.object({
  project: ProjectSchema,
  inverse: z.array(CommandSchema),
});
export type CommandsResponse = z.infer<typeof CommandsResponseSchema>;

export const RecentProjectSchema = z.object({
  folder: z.string(),
  name: z.string(),
  openedAt: z.string(),
  exists: z.boolean(),
});
export type RecentProject = z.infer<typeof RecentProjectSchema>;

export const RecentProjectsResponseSchema = z.object({ projects: z.array(RecentProjectSchema) });
export type RecentProjectsResponse = z.infer<typeof RecentProjectsResponseSchema>;