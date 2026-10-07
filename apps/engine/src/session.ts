import path from "node:path";
import {
  applyCommands,
  createEmptyProject,
} from "@ve/timeline-core";
import type {
  Command,
  CommandError,
  CreateProjectRequest,
  Project,
  ProjectResponse,
} from "@ve/schema";
import { createProjectFolder, readProject, writeProject } from "./projectStore.js";
import type { RecentProjects } from "./recent.js";

export class SessionError extends Error {
  constructor(
    readonly code: "NO_PROJECT" | "INVALID_PATH",
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
  private current: { folder: string; project: Project } | null = null;
  private queue: Promise<unknown> = Promise.resolve();

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
      ? { folder: this.current.folder, project: this.current.project, recoveredFromBackup: false }
      : null;
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
      this.current = { folder, project };
      await this.recent.add(folder, project.name);
      return { folder, project, recoveredFromBackup: false };
    });
  }

  openFolder(rawFolder: string): Promise<ProjectResponse> {
    return this.run(async () => {
      const folder = ProjectSession.resolveFolder(rawFolder);
      const { project, recoveredFromBackup } = await readProject(folder);
      this.current = { folder, project };
      await this.recent.add(folder, project.name);
      return { folder, project, recoveredFromBackup };
    });
  }

  /** Applies commands atomically and autosaves; an invalid batch changes nothing. */
  apply(commands: Command[]): Promise<CommandOutcome> {
    return this.run(async () => {
      const { folder, project } = this.require();
      const result = applyCommands(project, commands);
      if (!result.ok) return result;
      const next = { ...result.project, updatedAt: new Date().toISOString() };
      await writeProject(folder, next);
      this.current = { folder, project: next };
      return { ok: true, project: next, inverse: result.inverse };
    });
  }

  save(): Promise<void> {
    return this.run(async () => {
      const { folder, project } = this.require();
      await writeProject(folder, project);
    });
  }

  close(): Promise<void> {
    return this.run(async () => {
      this.current = null;
    });
  }
}
