import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { EasyAiApi } from "./api.js";
import { configDir } from "./config.js";
import { CliError, ExitCode } from "./errors.js";
import { writeJson } from "./storage.js";
import { readGeneration, taskStatus } from "./submission.js";
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
  estimate: true;
  estimateLabel: string;
  basis: string;
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

const FINAL_PER_4S = 149.68;

export function finalizeEstimate(durationSeconds?: number): { estimatedPoints: number; estimate: true; estimateLabel: string; basis: string } {
  const seconds = Number.isFinite(durationSeconds) && durationSeconds! > 0 ? durationSeconds! : 4;
  const estimatedPoints = Math.round(FINAL_PER_4S * (seconds / 4) * 100) / 100;
  const basis = "1080p direct price 149.68 per 4s";
  return {
    estimatedPoints,
    estimate: true,
    basis,
    estimateLabel: `估算，不是成片报价。按 1080p 直接生成价 149.68 积分/4 秒折算（${seconds}s ≈ ${estimatedPoints}）。API key 读不到成片精确价格。`,
  };
}

function isUuid(value: string | undefined): boolean {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export interface FinalizeInput { draftId: string; yes?: boolean; resolution?: string; }

export async function finalizeDraft(api: EasyAiApi, input: FinalizeInput): Promise<FinalizationPreview | { submitted: true; deduped: boolean; taskId: string; sourceResultId: string; targetResolution: string; estimatedPoints: number | null; estimate: true; estimateLabel: string; basis: string; idempotencyKey: string }> {
  const draftId = input.draftId.trim();
  if (!draftId) throw new CliError("Draft id is required.", ExitCode.Usage);
  const taskKey = draftId.split(":")[0] || draftId;
  let task: unknown;
  try { task = await readGeneration(api, taskKey); } catch { task = undefined; }
  const generation = findVideoGeneration(task);
  const model = modelOf(task, generation);
  const status = task ? taskStatus(task) : "";
  if (task && !SUCCESS.has(status)) throw new CliError(`Draft task ${draftId} is ${status || "unfinished"}. Wait until it succeeds before finalizing.`, ExitCode.Usage);
  if (isFinalizeModel(model) || generation?.stage === "final") throw new CliError("This id is already a final render, not a Seedance 2.5 draft.", ExitCode.Usage);
  if (generation?.stage === "direct") throw new CliError("只有已完成的样片可以生成高清成片。Seedance-2.5-Draft 不会生成可成片样片。请用 豆包Seedance-2.5、draft:true、480p。", ExitCode.Usage);
  if (generation?.stage !== "draft") throw new CliError("Could not verify videoGeneration.stage is draft. Refusing to finalize.", ExitCode.Usage);
  if (generation.resolution && String(generation.resolution) !== "480p") throw new CliError("可成片样片是 480p。请重新生成 480p 样片。", ExitCode.Usage);
  if (model && !DRAFT_MODEL.test(model)) throw new CliError(`Task model "${model}" is not a Seedance 2.5 draft. Refusing to finalize.`, ExitCode.Usage);
  const sourceResultId = resultIdOf(generation, draftId.includes(":") ? draftId : `${taskKey}:0`);
  const preview = unwrap<Record<string, any>>(await api.get(`/v1/video/results/${encodeURIComponent(sourceResultId)}/finalization`));
  const targetResolution = "1080p";
  if (input.resolution && input.resolution !== "1080p") throw new CliError("Seedance 2.5 成片固定 1080p。", ExitCode.Usage);
  if (Array.isArray(preview.targetResolutions) && preview.targetResolutions.length && !preview.targetResolutions.includes("1080p")) throw new CliError("This draft does not offer a 1080p final.", ExitCode.Usage);
  const items = await readFinalizations();
  const saved = items[sourceResultId];
  const retryAfterTaskId = String(preview.retryAfterTaskId || "");
  const existingTaskId = retryAfterTaskId ? "" : String(preview.existingTaskId || saved?.finalTaskId || "");
  const duration = Number(generation?.duration || preview.duration || 4);
  const quote = finalizeEstimate(duration);
  if (existingTaskId) {
    return { submitted: false, deduped: true, eligible: true, sourceResultId, draftTaskId: taskKey, targetResolution, estimatedPoints: saved?.estimatedPoints ?? quote.estimatedPoints, estimate: true, estimateLabel: quote.estimateLabel, basis: quote.basis, reason: "This draft was already finalized.", existingTaskId, taskId: existingTaskId, requiredFlag: "--yes", command: `wowidea video finalize ${draftId} --yes` };
  }
  if (preview.eligible === false) throw new CliError(preview.reason || "只有已完成的样片可以生成高清成片。", ExitCode.Usage);
  const expires = Number(preview.expiresAt || generation?.finalizeExpiresAt || preview.finalizeExpiresAt || 0);
  if (expires && expires <= Date.now()) throw new CliError("样片已过期，请重新生成样片。", ExitCode.Usage);
  const command = `wowidea video finalize ${draftId} --yes`;
  if (!input.yes) {
    return { submitted: false, deduped: false, eligible: true, sourceResultId, draftTaskId: taskKey, targetResolution, ...quote, reason: quote.estimateLabel, requiredFlag: "--yes", command };
  }
  const idempotencyKey = !retryAfterTaskId && isUuid(saved?.idempotencyKey) ? saved!.idempotencyKey : randomUUID();
  items[sourceResultId] = { sourceResultId, draftTaskId: taskKey, finalTaskId: saved?.finalTaskId && !retryAfterTaskId ? saved.finalTaskId : "", targetResolution, idempotencyKey, estimatedPoints: quote.estimatedPoints, createdAt: saved?.createdAt || new Date().toISOString() };
  await writeFinalizations(items);
  const body = { sourceResultId, targetResolution, outputFormat: "mp4", watermark: false, returnLastFrame: false, idempotencyKey };
  const created = unwrap<Record<string, any>>(await api.post("/v1/video/finalizations", body, { "Idempotency-Key": idempotencyKey, "x-async": "true" }));
  const taskId = String(created.task_id || created.taskId || "");
  if (!taskId) throw new CliError("Finalization returned no task id. Retry the same command; the saved idempotency key will be reused.", ExitCode.Service);
  items[sourceResultId] = { ...items[sourceResultId]!, finalTaskId: taskId };
  await writeFinalizations(items);
  return { submitted: true, deduped: false, taskId, sourceResultId, targetResolution, ...quote, idempotencyKey };
}
