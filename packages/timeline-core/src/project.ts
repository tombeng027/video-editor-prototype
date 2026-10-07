import { SCHEMA_VERSION, type Project, type Rational } from "@ve/schema";

export function createEmptyProject(opts: {
  id: string;
  name: string;
  fps: Rational;
  width: number;
  height: number;
  fpsFromFirstImport?: boolean;
  now?: string;
}): Project {
  const now = opts.now ?? new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id,
    name: opts.name,
    settings: {
      fps: opts.fps,
      width: opts.width,
      height: opts.height,
      fpsFromFirstImport: opts.fpsFromFirstImport ?? false,
    },
    assets: [],
    tracks: [],
    createdAt: now,
    updatedAt: now,
  };
}
