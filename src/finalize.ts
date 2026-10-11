import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EasyAiApi } from "./api.js";
import { configDir } from "./config.js";
import { CliError, ExitCode } from "./errors.js";
import { writeJson } from "./storage.js";
import { taskStatus } from "./submission.js";
import { isFinalizeModel } from "./task-router.js";

const SUCCESS = new Set(["completed", "succeeded", "success", "1"]);
const DRAFT_MODEL = /seedance[-_. ]?2[.]?5|doubao-seedance-2-5|seedance25/i;

export interface FinalizationRecord {
  sourceResultId: string;
  draftTaskId: string;
  finalTaskId: string;
  targetResolution: string;
  idempotencyKey: string;
  estimatedPoints: number | null;
  createdAt: string;
}

export interface FinalizationPreview {
  submitted: false;
  deduped: boolean;
  eligible: boolean;
  sourceResultId?: string;
  draftTaskId?: string;
  targetResolution?: string;
  estimatedPoints: number | null;
  reason: string;
  existingTaskId?: string;
  taskId?: string;
  requiredFlag: "--yes";
  command: string;
}

function statePath(): string { return join(configDir(), "video-finalizations.json"); }

export async function readFinalizations(): Promise<Record<string, FinalizationRecord>> {
  try {
    const value = JSON.parse(await readFile(statePath(), "utf8")) as { items?: Record<string, FinalizationRecord> };
    return value.items || {};
  } catch { return {}; }
}

async function writeFinalizations(items: Record<string, FinalizationRecord>): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeJson(statePath(), { schemaVersion: "wowidea.finalizations/v1", items });
}

function asRecord(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

export function findVideoGeneration(value: unknown): Record<string, any> | undefined {
  const seen = new Set<unknown>();
  const visit = (item: unknown): Record<string, any> | undefined => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    const record = item as Record<string, any>;
    const direct = asRecord(record.videoGeneration) || asRecord(record.video_generation);
    if (direct && (direct.resultId || direct.result_id || direct.stage)) return direct;
    for (const nested of Object.values(record)) {
      const found = visit(nested);
      if (found) return found;
    }
  };
  return visit(value);
}

function modelOf(task: unknown, generation: Record<string, any> | undefined): string {
  const record = asRecord(task) || {};
  const params = asRecord(record.params) || asRecord(record.data?.params) || {};
  return String(generation?.model || record.model || params.model || record.data?.model || "");
}

function resultIdOf(generation: Record<string, any> | undefined, fallback: string): string {
  return String(generation?.resultId || generation?.result_id || fallback);
}

function unwrap<T>(value: any): T {
  return (value?.data && !Array.isArray(value.data) ? value.data : value) as T;
}

export interface FinalizeInput { draftId: string; yes?: boolean; resolution?: string; }

export async function finalizeDraft(api: EasyAiApi, input: FinalizeInput): Promise<FinalizationPreview | { submitted: true; deduped: boolean; taskId: string; sourceResultId: string; targetResolution: string; estimatedPoints: number | null; idempotencyKey: string }> {
  const draftId = input.draftId.trim();
  if (!draftId) throw new CliError("Draft id is required.", ExitCode.Usage);
  let task: unknown;
  try { task = await api.get(`/v1/tasks/${encodeURIComponent(draftId)}`); } catch { task = undefined; }
  const generation = findVideoGeneration(task);
  const model = modelOf(task, generation);
  const status = task ? taskStatus(task) : "";
  if (task && !SUCCESS.has(status)) throw new CliError(`Draft task ${draftId} is ${status || "unfinished"}. Wait until it succeeds before finalizing.`, ExitCode.Usage);
  if (isFinalizeModel(model) || generation?.stage === "final") throw new CliError("This id is already a final render, not a Seedance 2.5 draft.", ExitCode.Usage);
  if (model && !DRAFT_MODEL.test(model)) throw new CliError(`Task model "${model}" is not a Seedance 2.5 draft. Refusing to finalize.`, ExitCode.Usage);
  if (!model && generation?.stage !== "draft") throw new CliError("Could not verify that this task is a Seedance 2.5 draft. Refusing to finalize.", ExitCode.Usage);
  const sourceResultId = resultIdOf(generation, draftId);
  const preview = unwrap<Record<string, any>>(await api.get(`/v1/video/results/${encodeURIComponent(sourceResultId)}/finalization`));
  const targetResolution = input.resolution || preview.targetResolutions?.[0] || generation?.finalResolutions?.[0] || "1440p";
  if (!["1080p", "1440p"].includes(String(targetResolution))) throw new CliError(`Unsupported final resolution ${targetResolution}.`, ExitCode.Usage);
  const items = await readFinalizations();
  const saved = items[sourceResultId];
  const existingTaskId = String(preview.existingTaskId || saved?.finalTaskId || "");
  if (existingTaskId) {
    return { submitted: false, deduped: true, eligible: true, sourceResultId, draftTaskId: draftId, targetResolution: String(targetResolution), estimatedPoints: saved?.estimatedPoints ?? null, reason: "This draft was already finalized.", existingTaskId, taskId: existingTaskId, requiredFlag: "--yes", command: `wowidea video finalize ${draftId} --yes` };
  }
  if (preview.eligible === false) throw new CliError(preview.reason || "This draft is not eligible for a final render.", ExitCode.Usage);
  const expires = Number(generation?.finalizeExpiresAt || preview.finalizeExpiresAt || 0);
  if (expires && expires <= Date.now()) throw new CliError("The draft has expired. Generate a new Seedance 2.5 draft.", ExitCode.Usage);
  const quote = unwrap<Record<string, any>>(await api.post("/v1/integration-platform/models/estimatedBilling", { params: { operation: "video.finalize", sourceResultId, targetResolution } }));
  const estimatedPoints = Number(quote.amount ?? quote.estimatedPower);
  if (!Number.isFinite(estimatedPoints) || estimatedPoints < 0) throw new CliError("Could not estimate the final-render cost. Nothing was submitted.", ExitCode.Service);
  const command = `wowidea video finalize ${draftId} --yes`;
  if (!input.yes) {
    return { submitted: false, deduped: false, eligible: true, sourceResultId, draftTaskId: draftId, targetResolution: String(targetResolution), estimatedPoints, reason: `成片预计 ${estimatedPoints} 点。确认后才会提交。`, requiredFlag: "--yes", command };
  }
  const idempotencyKey = `video.finalize:${sourceResultId}`;
  const body = { sourceResultId, targetResolution, outputFormat: "mp4", watermark: false, returnLastFrame: false, idempotencyKey };
  const created = unwrap<Record<string, any>>(await api.post("/v1/video/finalizations", body, { "Idempotency-Key": idempotencyKey, "x-async": "true" }));
  const taskId = String(created.task_id || created.taskId || "");
  if (!taskId) throw new CliError("Finalization returned no task id. Retry the same command; the idempotency key is stable.", ExitCode.Service);
  items[sourceResultId] = { sourceResultId, draftTaskId: draftId, finalTaskId: taskId, targetResolution: String(targetResolution), idempotencyKey, estimatedPoints, createdAt: new Date().toISOString() };
  await writeFinalizations(items);
  return { submitted: true, deduped: false, taskId, sourceResultId, targetResolution: String(targetResolution), estimatedPoints, idempotencyKey };
}
