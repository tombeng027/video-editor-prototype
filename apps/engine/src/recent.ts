import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { RecentProject } from "@ve/schema";

const MAX_RECENT = 10;

const StoredSchema = z.array(z.object({ folder: z.string(), name: z.string(), openedAt: z.string() }));

export class RecentProjects {
  constructor(private readonly file: string) {}

  private async load(): Promise<z.infer<typeof StoredSchema>> {
    try {
      const parsed = StoredSchema.safeParse(JSON.parse(await readFile(this.file, "utf8")));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }

  async list(): Promise<RecentProject[]> {
    const items = await this.load();
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        exists: await stat(path.join(item.folder, "project.json")).then(() => true, () => false),
      })),
    );
  }

  async add(folder: string, name: string, now = new Date().toISOString()): Promise<void> {
    const rest = (await this.load()).filter((i) => i.folder !== folder);
    const next = [{ folder, name, openedAt: now }, ...rest].slice(0, MAX_RECENT);
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(next, null, 2), "utf8");
    await rename(temp, this.file);
  }
}
