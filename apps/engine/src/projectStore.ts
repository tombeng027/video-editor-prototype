import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { ProjectSchema, type Project } from "@ve/schema";
import { validateProject } from "@ve/timeline-core";

export const PROJECT_FILE = "project.json";
export const BACKUP_FILE = "project.json.bak";
export const PROJECT_SUBFOLDERS = ["media", "proxies", "candidates", "exports"] as const;

export type StoreErrorCode = "ALREADY_EXISTS" | "NOT_FOUND" | "CORRUPT" | "STORE_IO_FAILED" | "SAVE_FAILED" | "SAVE_CLEANUP_FAILED";

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const exists = async (file: string) => {
  try { await stat(file); return true; }
  catch (error) {
    if (missing(error)) return false;
    throw new StoreError("STORE_IO_FAILED", `Cannot inspect ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
};

function parseProject(text: string): { project: Project | null; problem: string } {
  let json: unknown;
  try { json = JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { project: null, problem: "Invalid JSON." };
  }
  const parsed = ProjectSchema.safeParse(json);
  if (!parsed.success) return { project: null, problem: `Invalid project fields: ${parsed.error.issues[0]?.message}` };
  const invalid = validateProject(parsed.data);
  return invalid
    ? { project: null, problem: `${invalid.code}: ${invalid.message}` }
    : { project: parsed.data, problem: "" };
}

async function readCandidate(file: string) {
  let text: string;
  try { text = await readFile(file, "utf8"); }
  catch (error) {
    if (missing(error)) return { project: null, problem: "File is missing.", text: null };
    throw new StoreError("STORE_IO_FAILED", `Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return { ...parseProject(text), text };
}

/** Only a validated main file may replace the known-good backup. */
export async function writeProject(folder: string, project: Project): Promise<void> {
  const validated = parseProject(JSON.stringify(project));
  if (!validated.project) throw new StoreError("CORRUPT", `Refusing to save an invalid project: ${validated.problem}`);
  const target = path.join(folder, PROJECT_FILE);
  const token = randomUUID();
  const temp = path.join(folder, `${PROJECT_FILE}.${token}.tmp`);
  const backupTemp = path.join(folder, `${BACKUP_FILE}.${token}.tmp`);
  try {
    const previous = await readCandidate(target);
    await writeFile(temp, JSON.stringify(validated.project, null, 2), { encoding: "utf8", flag: "wx" });
    if (previous.project && previous.text !== null) {
      await writeFile(backupTemp, previous.text, { encoding: "utf8", flag: "wx" });
      await rename(backupTemp, path.join(folder, BACKUP_FILE));
    }
    await rename(temp, target);
  } catch (error) {
    const cleanupErrors: string[] = [];
    for (const file of [temp, backupTemp]) {
      try { await rm(file, { force: true }); }
      catch (cleanupError) { cleanupErrors.push(`${file}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`); }
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new StoreError(cleanupErrors.length ? "SAVE_CLEANUP_FAILED" : "SAVE_FAILED",
      `Project save failed: ${detail}.${cleanupErrors.length ? ` Temporary-file cleanup failed: ${cleanupErrors.join("; ")}` : ""} The previous main/usable backup has not been replaced with invalid data.`,
      { cause: error });
  }
}

export async function createProjectFolder(folder: string, project: Project): Promise<void> {
  if (await exists(path.join(folder, PROJECT_FILE)) || await exists(path.join(folder, BACKUP_FILE))) {
    throw new StoreError("ALREADY_EXISTS", "That folder already contains a project.");
  }
  await mkdir(folder, { recursive: true });
  for (const sub of PROJECT_SUBFOLDERS) await mkdir(path.join(folder, sub), { recursive: true });
  await writeProject(folder, project);
}

/** Loads and validates a project; falls back to the backup when `project.json` is unreadable. */
export async function readProject(
  folder: string,
): Promise<{ project: Project; recoveredFromBackup: boolean }> {
  const main = path.join(folder, PROJECT_FILE);
  const backup = path.join(folder, BACKUP_FILE);
  const primary = await readCandidate(main);
  if (primary.project) return { project: primary.project, recoveredFromBackup: false };
  const recovered = await readCandidate(backup);
  if (primary.text === null && recovered.text === null) {
    throw new StoreError("NOT_FOUND", "No project was found in that folder.");
  }
  if (recovered.project) return { project: recovered.project, recoveredFromBackup: true };
  throw new StoreError("CORRUPT", `No usable project or backup exists. ${PROJECT_FILE}: ${primary.problem} ${BACKUP_FILE}: ${recovered.problem}`);
}
