import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { RecentProject } from "@ve/schema";
import { readProject, StoreError } from "./projectStore.js";

const MAX_RECENT = 10;

const StoredSchema = z.array(z.object({ folder: z.string(), name: z.string(), openedAt: z.string() }));

export class RecentError extends Error {
  constructor(readonly code: "RECENT_INDEX_INVALID" | "RECENT_UNAVAILABLE", message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class RecentProjects {
  constructor(private readonly file: string) {}

  private async load(): Promise<z.infer<typeof StoredSchema>> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw new RecentError("RECENT_UNAVAILABLE", `Cannot read recent-project index ${this.file}. Open projects by folder; check permissions.`, { cause: error });
    }
    let json: unknown;
    try { json = JSON.parse(text); }
    catch (error) { throw new RecentError("RECENT_INDEX_INVALID", `Recent-project index ${this.file} is damaged. Open projects by folder; preserve or rename the index before rebuilding it.`, { cause: error }); }
    const parsed = StoredSchema.safeParse(json);
    if (!parsed.success) throw new RecentError("RECENT_INDEX_INVALID", `Recent-project index ${this.file} has invalid fields. Open projects by folder; preserve or rename the index before rebuilding it.`, { cause: parsed.error });
    return parsed.data;
  }

  async list(): Promise<RecentProject[]> {
    const items = await this.load();
    return Promise.all(
      items.map(async (item) => {
        try {
          await readProject(item.folder);
          return { ...item, exists: true };
        } catch (error) {
          if (error instanceof StoreError && (error.code === "NOT_FOUND" || error.code === "CORRUPT")) return { ...item, exists: false };
          throw new RecentError("RECENT_UNAVAILABLE", `Cannot inspect recent project ${item.folder}. Open it by folder and check permissions.`, { cause: error });
        }
      }),
    );
  }

  async add(folder: string, name: string, now = new Date().toISOString()): Promise<void> {
    const rest = (await this.load()).filter((i) => i.folder !== folder);
    const next = [{ folder, name, openedAt: now }, ...rest].slice(0, MAX_RECENT);
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(next, null, 2), { encoding: "utf8", flag: "wx" });
      await rename(temp, this.file);
    } catch (error) {
      let cleanup = "";
      try { await rm(temp, { force: true }); }
      catch (cleanupError) { cleanup = ` Cleanup of ${temp} failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`; }
      throw new RecentError("RECENT_UNAVAILABLE", `Cannot update recent-project index ${this.file}. Open projects by folder and check permissions/free space.${cleanup}`, { cause: error });
    }
  }
}
