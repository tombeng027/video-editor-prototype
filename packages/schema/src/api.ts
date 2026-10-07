import { z } from "zod";

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
