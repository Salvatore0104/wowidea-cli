import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError, ExitCode } from "./errors.js";

export const guideVersion = "0.8.0";
export const guideRegistry = [
  ["design-tasks", "Design task routing"],
  ["production-rounds", "Creative rounds"], ["recipe-authoring", "Recipe authoring"],
  ["creative-direction", "Creative direction"], ["vj-recipes", "Stage and VJ methods"],
  ["project-workflow", "Project records"], ["reference-planning", "Reference roles and order"],
  ["visual-review", "Purpose-specific review"], ["seedance-20", "Seedance 2.0"],
  ["seedance-25", "Seedance 2.5"], ["minimax-h3", "MiniMax H3 / H3-Max"],
  ["nano-banana", "Nano Banana"], ["gpt-image", "GPT Image 2"], ["gpt-image-25", "GPT Image 2.5 prompt routing"], ["image-parameters", "Image request parameters"],
  ["midjourney", "Midjourney v8.2"],
  ["google-omni", "Google Omni"], ["wan", "Wan3.0"],
  ["seedance-gate", "Seedance approval and execution"], ["storyboard-quality", "Storyboard quality"],
  ["image-case-index", "Curated image methods"], ["sources", "Sources and licences"], ["workflow", "Execution and recovery"],
].map(([id, title]) => ({ id: id!, title: title!, guide: `references/${id}.md`, version: guideVersion }));
export const promptSkills: Record<string, string> = { "gpt-image-25": "gpt-image-25-prompt" };
export function guideInfo(id: string) {
  const entry = guideRegistry.find(g => g.id === id);
  if (!entry) throw new CliError("Unknown guide; use guides list.", ExitCode.Usage);
  // Both src and bundled dist are one level below the package root. Never use cwd or a mutable installed Skill copy.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../skill");
  const promptSkill = promptSkills[id];
  return { ...entry, path: resolve(root, "wowidea", entry.guide), promptSkill, promptSkillPath: promptSkill ? resolve(root, promptSkill, "SKILL.md") : undefined };
}
export async function showGuide(id: string) {
  const info = guideInfo(id);
  return { ...info, content: await readFile(info.path, "utf8") };
}
