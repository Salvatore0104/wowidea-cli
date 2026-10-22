import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CliError, ExitCode } from "./errors.js";

export interface CreativeReference {
  type: "image" | "video" | "audio";
  role: string;
  source: string;
  scope: string;
  preserve: string[];
  change: string[];
}
export interface ShowProject {
  schemaVersion: "wowidea.project/v1";
  name: string;
  theme: string;
  audience: string;
  stage: { screens: Array<{ name: string; width: number; height: number; safeArea: string }>; viewingDistance: string; deliveryNotes: string };
  preferences: { styles: string[]; preserve: string[]; avoid: string[]; approvedDirections: Array<{ description: string; confirmation: string; confirmedAt: string }> };
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === "string");
function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new CliError(message, ExitCode.Usage); }
export function validateProject(value: unknown): asserts value is ShowProject {
  const p = value as ShowProject;
  requireValue(p && p.schemaVersion === "wowidea.project/v1", "Expected wowidea.project/v1.");
  requireValue(typeof p.name === "string" && typeof p.theme === "string" && typeof p.audience === "string", "Project name, theme and audience must be strings; blank templates are allowed.");
  requireValue(p.stage && typeof p.stage.viewingDistance === "string" && typeof p.stage.deliveryNotes === "string" && Array.isArray(p.stage.screens), "Project stage settings are required.");
  for (const s of p.stage.screens) requireValue(s && typeof s.name === "string" && Number.isInteger(s.width) && s.width > 0 && Number.isInteger(s.height) && s.height > 0 && typeof s.safeArea === "string", "Each stage screen needs name, positive pixel dimensions and safeArea.");
  requireValue(p.preferences && strings(p.preferences.styles) && strings(p.preferences.preserve) && strings(p.preferences.avoid) && Array.isArray(p.preferences.approvedDirections), "Project preferences must contain string arrays and approvedDirections.");
  for (const d of p.preferences.approvedDirections) requireValue(d && typeof d.description === "string" && d.description.trim() && typeof d.confirmation === "string" && d.confirmation.trim() && Number.isFinite(Date.parse(d.confirmedAt)), "Accepted directions need the user's confirmation and date.");
}
export function referencePlan(refs: CreativeReference[]) {
  requireValue(Array.isArray(refs), "references must be an array.");
  const counts = { image: 0, video: 0, audio: 0 }; const roles = new Set<string>();
  const references = refs.map(ref => {
    requireValue(ref && ["image", "video", "audio"].includes(ref.type) && typeof ref.role === "string" && ref.role.trim() && !roles.has(ref.role), "References need unique roles and a valid media type.");
    requireValue(typeof ref.source === "string" && ref.source.trim() && typeof ref.scope === "string" && ref.scope.trim() && strings(ref.preserve) && strings(ref.change), "Each reference needs source, scope, preserve and change.");
    roles.add(ref.role);
    const index = ++counts[ref.type];
    return { ...ref, index, label: `${ref.type}${index}` };
  });
  return { references, referenceCounts: { images: counts.image, videos: counts.video, audio: counts.audio } };
}
export async function initProject(dir: string, name = "") {
  const path = join(resolve(dir), ".wowidea", "project.json");
  const project: ShowProject = { schemaVersion: "wowidea.project/v1", name, theme: "", audience: "", stage: { screens: [], viewingDistance: "", deliveryNotes: "" }, preferences: { styles: [], preserve: [], avoid: [], approvedDirections: [] } };
  await mkdir(join(resolve(dir), ".wowidea"), { recursive: true });
  try { await writeFile(path, JSON.stringify(project, null, 2) + "\n", { flag: "wx" }); }
  catch (e: any) { if (e.code === "EEXIST") throw new CliError("Project already exists; init never overwrites programme preferences.", ExitCode.Conflict); throw e; }
  return { path, project };
}
export async function readProject(dir: string) {
  const path = join(resolve(dir), ".wowidea", "project.json");
  let project: unknown;
  try { project = JSON.parse(await readFile(path, "utf8")); }
  catch { throw new CliError("Project missing or invalid JSON; use project init --dir first.", ExitCode.Usage); }
  validateProject(project); return { path, project };
}
export async function requireProject(dir: string) {
  const path = join(resolve(dir), ".wowidea", "project.json");
  try { await readFile(path, "utf8"); }
  catch { throw new CliError(`该目录尚未初始化。每次使用前请先运行：wowidea project init --dir ${resolve(dir)}`, ExitCode.Usage); }
  return readProject(dir);
}
export async function recordCreation(dir: string, value: unknown) {
  await readProject(dir);
  const r = value as any;
  requireValue(r && r.schemaVersion === "wowidea.creation/v1" && typeof r.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(r.id), "Creation needs wowidea.creation/v1 and a safe unique id.");
  requireValue(typeof r.prompt === "string" && r.prompt.trim() && typeof r.model === "string" && r.model.trim() && typeof r.mode === "string" && r.mode.trim(), "Creation needs prompt, model and explicit mode.");
  requireValue(r.settings && typeof r.settings === "object" && !Array.isArray(r.settings) && strings(r.outputs) && (r.taskId === null || typeof r.taskId === "string"), "Creation needs settings, outputs and taskId (null for drafts).");
  requireValue(r.qc && ["not_reviewed", "pass", "revise"].includes(r.qc.verdict) && strings(r.qc.evidence), "QC needs a verdict and evidence array.");
  requireValue(r.qc.verdict === "not_reviewed" || (r.outputs.length && r.qc.evidence.some((s: string) => s.trim()) && Number.isFinite(Date.parse(r.qc.reviewedAt))), "Reviewed QC needs outputs, dated visual observations.");
  const plan = referencePlan(r.references);
  // Store an explicit allowlist. Executable requests and signed URLs belong in private run files.
  for (const ref of plan.references) requireValue(!/^https?:\/\/[^\s]*[?#]/i.test(ref.source), "Use a local source path or stable URL in shared records; signed URLs belong in private manifests.");
  const record = { schemaVersion: r.schemaVersion, id: r.id, prompt: r.prompt, model: r.model, mode: r.mode, settings: r.settings, ...plan, taskId: r.taskId, outputs: r.outputs, qc: r.qc, recordedAt: new Date().toISOString() };
  const root = join(resolve(dir), ".wowidea", "creations"); await mkdir(root, { recursive: true });
  const path = join(root, `${r.id}.json`);
  try { await writeFile(path, JSON.stringify(record, null, 2) + "\n", { flag: "wx" }); }
  catch (e: any) { if (e.code === "EEXIST") throw new CliError("Creation id exists; use a new revision id. Programme preferences were not changed.", ExitCode.Conflict); throw e; }
  return { path, record };
}
