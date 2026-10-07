import type { Rational } from "@ve/schema";

export type FpsPreset = { label: string; value: Rational };

export const FPS_PRESETS: FpsPreset[] = [
  { label: "23.976", value: { num: 24000, den: 1001 } },
  { label: "24", value: { num: 24, den: 1 } },
  { label: "25", value: { num: 25, den: 1 } },
  { label: "29.97", value: { num: 30000, den: 1001 } },
  { label: "30", value: { num: 30, den: 1 } },
  { label: "50", value: { num: 50, den: 1 } },
  { label: "59.94", value: { num: 60000, den: 1001 } },
  { label: "60", value: { num: 60, den: 1 } },
];

export const DEFAULT_FPS_INDEX = 4;

export const RESOLUTION_PRESETS = [
  { label: "1920 × 1080 (landscape)", width: 1920, height: 1080 },
  { label: "1280 × 720 (landscape)", width: 1280, height: 720 },
  { label: "3840 × 2160 (4K)", width: 3840, height: 2160 },
  { label: "1080 × 1920 (vertical)", width: 1080, height: 1920 },
  { label: "1080 × 1080 (square)", width: 1080, height: 1080 },
] as const;

export type NewProjectForm = {
  name: string;
  folder: string;
  fpsIndex: number;
  matchFirstImport: boolean;
  resolutionIndex: number;
};

export function validateNewProject(form: NewProjectForm): string | null {
  if (!form.name.trim()) return "Enter a project name.";
  if (!form.folder.trim()) return "Choose a folder for the project.";
  return null;
}

/** Joins a parent folder and a project name using the parent's own separator style. */
export function projectFolderFor(parent: string, name: string): string {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  const cleaned = [...name.trim()]
    .map((ch) => (ch.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(ch) ? "-" : ch))
    .join("")
    .replace(/[. ]+$/g, "");
  const safe = cleaned || "project";
  return `${parent.replace(/[\\/]+$/, "")}${sep}${safe}`;
}
