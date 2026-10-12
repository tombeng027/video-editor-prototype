import path from "node:path";
import {
  applyCommands,
  createEmptyProject,
} from "@ve/timeline-core";
import type {
  Command,
  CommandError,
  CloseProjectRequest,
  CreateProjectRequest,
  Project,
  ProjectResponse,
} from "@ve/schema";
import { createProjectFolder, readProject, writeProject } from "./projectStore.js";
import type { RecentProjects } from "./recent.js";

export class SessionError extends Error {
  constructor(
    readonly code: "NO_PROJECT" | "INVALID_PATH" | "PROJECT_CHANGED",
    message: string,
  ) {
    super(message);
  }
}

export type CommandOutcome =
  | { ok: true; project: Project; inverse: Command[] }
  | { ok: false; error: CommandError };

/** Owns the single open project: the engine copy is the source of truth for `project.json`. */
export class ProjectSession {
  private current: ProjectResponse | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;

  constructor(private readonly recent: RecentProjects) {}

  /** Serialises operations so overlapping saves never interleave. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private static resolveFolder(folder: string): string {
    if (!path.isAbsolute(folder)) throw new SessionError("INVALID_PATH", "The project folder must be an absolute path.");
    return path.resolve(folder);
  }

  private require() {
    if (!this.current) throw new SessionError("NO_PROJECT", "No project is open.");
    return this.current;
  }

  get open(): ProjectResponse | null {
    return this.current
      ? { ...this.current }
      : null;
  }

  private async updateRecent(folder: string, name: string): Promise<NonNullable<ProjectResponse["warnings"]>> {
    try {
      await this.recent.add(folder, name);
      return [];
    } catch (error) {
      return [{ code: "RECENT_UPDATE_FAILED", message: `The project is open and saved, but its recent-list entry could not be updated. ${error instanceof Error ? error.message : String(error)}` }];
    }
  }

  get version(): number {
    return this.generation;
  }

  assertVersion(version: number): void {
    if (version !== this.generation || !this.current) {
      throw new SessionError("PROJECT_CHANGED", "The project changed while this operation was running. Retry in the intended project.");
    }
  }

  create(req: CreateProjectRequest): Promise<ProjectResponse> {
    return this.run(async () => {
      const folder = ProjectSession.resolveFolder(req.folder);
      const project = createEmptyProject({
        id: crypto.randomUUID(),
        name: req.name,
        fps: req.fps,
        width: req.width,
        height: req.height,
        fpsFromFirstImport: req.fpsFromFirstImport,
      });
      await createProjectFolder(folder, project);
      this.current = { folder, project, recoveredFromBackup: false };
      this.generation++;
      this.current.warnings = await this.updateRecent(folder, project.name);
      return { ...this.current };
    });
  }

  openFolder(rawFolder: string): Promise<ProjectResponse> {
    return this.run(async () => {
      const folder = ProjectSession.resolveFolder(rawFolder);
      const { project, recoveredFromBackup } = await readProject(folder);
      this.current = { folder, project, recoveredFromBackup };
      this.generation++;
      this.current.warnings = await this.updateRecent(folder, project.name);
      return { ...this.current };
    });
  }

  /** Applies commands atomically and autosaves; an invalid batch changes nothing. */
  apply(commands: Command[] | ((project: Project) => Command[]), version?: number): Promise<CommandOutcome> {
    return this.run(async () => {
      if (version !== undefined) this.assertVersion(version);
      const { folder, project } = this.require();
      const result = applyCommands(project, typeof commands === "function" ? commands(project) : commands);
      if (!result.ok) return result;
      const next = { ...result.project, updatedAt: new Date().toISOString() };
      await writeProject(folder, next);
      this.current = { ...this.require(), project: next, recoveredFromBackup: false };
      return { ok: true, project: next, inverse: result.inverse };
    });
  }

  save(): Promise<void> {
    return this.run(async () => {
      const { folder, project } = this.require();
      await writeProject(folder, project);
      this.current = { ...this.require(), recoveredFromBackup: false };
    });
  }

  close(expectedProject?: CloseProjectRequest["expectedProject"]): Promise<void> {
    return this.run(async () => {
      if (expectedProject && this.current && (
        this.current.project.id !== expectedProject.id ||
        this.current.folder !== ProjectSession.resolveFolder(expectedProject.folder)
      )) {
        throw new SessionError("PROJECT_CHANGED", "A different project is open. Check the active project before retrying close.");
      }
      this.current = null;
      this.generation++;
    });
  }
}
