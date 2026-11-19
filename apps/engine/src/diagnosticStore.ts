import { randomUUID } from "node:crypto";
import { appendFileSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";

const MAX_FILE_BYTES = 1024 * 1024;
const FILES_PER_RUN = 3;
const RETENTION_DAYS = 14;
const SOFT_BUDGET_BYTES = 10 * 1024 * 1024;
const RUN_FILE = /^engine-(\d{8}T\d{9}Z)-(\d+)-([0-9a-f-]{36})\.([0-2])\.jsonl$/;

type StorePolicy = {
  maxFileBytes: number;
  filesPerRun: number;
  retentionDays: number;
  softBudgetBytes: number;
};

const defaultPolicy: StorePolicy = {
  maxFileBytes: MAX_FILE_BYTES,
  filesPerRun: FILES_PER_RUN,
  retentionDays: RETENTION_DAYS,
  softBudgetBytes: SOFT_BUDGET_BYTES,
};

type RunFile = { name: string; run: string; pid: number; startedAt: number; size: number };

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

function runStartedAt(stamp: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(stamp);
  if (!match) return 0;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]), Number(match[7]));
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class DiagnosticStore {
  private readonly directory: string;
  private readonly runId = randomUUID();
  private readonly startedAt = new Date();
  private readonly prefix: string;
  private totalBytes = 0;
  private budgetExceeded = false;

  constructor(dataDir: string, private readonly policy: StorePolicy = defaultPolicy) {
    this.directory = path.join(dataDir, "diagnostics");
    const stamp = this.startedAt.toISOString().replace(/[-:.]/g, "");
    this.prefix = `engine-${stamp}-${process.pid}-${this.runId}`;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const directoryStat = lstatSync(this.directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error("Diagnostic directory is not a regular directory.");
    }
    this.totalBytes = this.prune();
    this.budgetExceeded = this.totalBytes > this.policy.softBudgetBytes;
  }

  append(line: string): void {
    const data = `${line}\n`;
    const dataBytes = Buffer.byteLength(data);
    if (dataBytes > this.policy.maxFileBytes) {
      throw new Error("Diagnostic record exceeds the configured file limit.");
    }
    const current = this.filePath(0);
    const currentSize = this.regularFileSize(current);
    if (currentSize + dataBytes > this.policy.maxFileBytes) this.totalBytes -= this.rotate();
    appendFileSync(this.filePath(0), data, { encoding: "utf8", mode: 0o600 });
    this.totalBytes += dataBytes;
    if (this.totalBytes > this.policy.softBudgetBytes && !this.budgetExceeded) {
      this.totalBytes = this.prune();
      this.budgetExceeded = this.totalBytes > this.policy.softBudgetBytes;
    }
  }

  get exceedsSoftBudget(): boolean {
    return this.budgetExceeded;
  }

  private filePath(index: number): string {
    return path.join(this.directory, `${this.prefix}.${index}.jsonl`);
  }

  private existingFileSize(file: string): number | undefined {
    try {
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Diagnostic file is not a regular file.");
      return info.size;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  private regularFileSize(file: string): number {
    return this.existingFileSize(file) ?? 0;
  }

  private rotate(): number {
    let removedBytes = 0;
    for (let index = this.policy.filesPerRun - 1; index > 0; index--) {
      const source = this.filePath(index - 1);
      const destination = this.filePath(index);
      if (this.existingFileSize(source) === undefined) continue;
      const destinationSize = this.existingFileSize(destination);
      if (destinationSize !== undefined) {
        removedBytes += destinationSize;
        unlinkSync(destination);
      }
      renameSync(source, destination);
    }
    return removedBytes;
  }

  private readRunFiles(): RunFile[] {
    const result: RunFile[] = [];
    for (const name of readdirSync(this.directory)) {
      const match = RUN_FILE.exec(name);
      if (!match) continue;
      const stamp = match[1];
      const pid = match[2];
      const id = match[3];
      if (!stamp || !pid || !id) continue;
      const file = path.join(this.directory, name);
      let info;
      try {
        info = lstatSync(file);
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      if (!info.isFile() || info.isSymbolicLink()) continue;
      result.push({
        name,
        run: `${stamp}-${pid}-${id}`,
        pid: Number(pid),
        startedAt: runStartedAt(stamp),
        size: info.size,
      });
    }
    return result;
  }

  private prune(): number {
    const files = this.readRunFiles();
    const groups = new Map<string, RunFile[]>();
    for (const file of files) groups.set(file.run, [...(groups.get(file.run) ?? []), file]);
    const currentRunId = this.prefix.slice("engine-".length);
    const runs = [...groups.entries()].map(([id, entries]) => ({
      id,
      entries,
      pid: entries[0]!.pid,
      startedAt: entries[0]!.startedAt,
      active: id === currentRunId || isProcessAlive(entries[0]!.pid),
    })).sort((a, b) => a.startedAt - b.startedAt);
    const cutoff = Date.now() - this.policy.retentionDays * 24 * 60 * 60 * 1000;
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const run of runs) {
      const pastRetention = run.startedAt > 0 && run.startedAt < cutoff;
      const overBudget = total > this.policy.softBudgetBytes;
      if (run.active || (!pastRetention && !overBudget)) continue;
      for (const file of run.entries) {
        try {
          unlinkSync(path.join(this.directory, file.name));
          total -= file.size;
        } catch (error) {
          if (!missing(error)) throw error;
        }
      }
    }
    return total;
  }
}
