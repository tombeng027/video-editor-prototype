import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectSchema, type Project } from "@ve/schema";

export const PROJECT_FILE = "project.json";
export const BACKUP_FILE = "project.json.bak";
export const PROJECT_SUBFOLDERS = ["media", "proxies", "candidates", "exports"] as const;

export type StoreErrorCode = "ALREADY_EXISTS" | "NOT_FOUND" | "CORRUPT";

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const exists = (p: string) => stat(p).then(() => true, () => false);

/** Writes `project.json` atomically (temp file then rename), keeping the previous version as `.bak`. */
export async function writeProject(folder: string, project: Project): Promise<void> {
  const target = path.join(folder, PROJECT_FILE);
  const temp = path.join(folder, `${PROJECT_FILE}.tmp`);
  await writeFile(temp, JSON.stringify(project, null, 2), "utf8");
  if (await exists(target)) await copyFile(target, path.join(folder, BACKUP_FILE));
  await rename(temp, target);
}

export async function createProjectFolder(folder: string, project: Project): Promise<void> {
  if (await exists(path.join(folder, PROJECT_FILE))) {
    throw new StoreError("ALREADY_EXISTS", "That folder already contains a project.");
  }
  await mkdir(folder, { recursive: true });
  for (const sub of PROJECT_SUBFOLDERS) await mkdir(path.join(folder, sub), { recursive: true });
  await writeProject(folder, project);
}

async function tryParse(file: string): Promise<Project | null> {
  try {
    const parsed = ProjectSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Loads and validates a project; falls back to the backup when `project.json` is unreadable. */
export async function readProject(
  folder: string,
): Promise<{ project: Project; recoveredFromBackup: boolean }> {
  const main = path.join(folder, PROJECT_FILE);
  const backup = path.join(folder, BACKUP_FILE);
  const hasMain = await exists(main);
  if (!hasMain && !(await exists(backup))) {
    throw new StoreError("NOT_FOUND", "No project was found in that folder.");
  }
  const project = hasMain ? await tryParse(main) : null;
  if (project) return { project, recoveredFromBackup: false };
  const recovered = await tryParse(backup);
  if (recovered) return { project: recovered, recoveredFromBackup: true };
  throw new StoreError("CORRUPT", "The project file is damaged and no usable backup exists.");
}
