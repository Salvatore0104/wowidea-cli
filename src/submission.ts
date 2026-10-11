import { EasyAiApi, findUrls } from "./api.js";
import { CliError, ExitCode, isNotFound, redact } from "./errors.js";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "./config.js";
import { payloadHash } from "./preflight.js";
import { writeJson } from './storage.js';

export function taskId(value: any): string | undefined {
  if (!value || typeof value !== "object") return;
  const id = value.taskId || value.task_id || value.id;
  if (typeof id === "string") return id;
  for (const key of ["data", "result", "task"]) {
    const nested = taskId(value[key]);
    if (nested) return nested;
  }
}
function processingNoise(value: any): boolean {
  return /is processing/i.test(`${value?.error || ""} ${value?.errorMessage || ""} ${value?.message || ""}`);
}
export function taskStatus(value: any): string {
  if (!value || typeof value !== "object") return "unknown";
  const direct = value.status || value.task_status;
  if (direct) {
    const status = String(direct).toLowerCase();
    if (processingNoise(value) && ["running", "process", "submitted", "pending", "queued"].includes(status)) return "process";
    return status;
  }
  if (processingNoise(value)) return "process";
  for (const key of ["data", "result", "task"]) {
    const nested = taskStatus(value[key]);
    if (nested !== "unknown") return nested;
  }
  return "unknown";
}
export async function readGeneration(api: EasyAiApi, id: string): Promise<unknown> {
  try { return await api.get(`/v1/ai/result/${encodeURIComponent(id)}`); }
  catch (error) { if (!isNotFound(error)) throw error; return api.get(`/v1/tasks/${encodeURIComponent(id)}`); }
}
function recordDir(api: EasyAiApi) { return join(configDir(), "tasks", api.scope || "test"); }
function recordPath(api: EasyAiApi, key: string) { return join(recordDir(api), `${payloadHash(key)}.json`); }
function rowId(value: unknown): string | undefined { return taskId(value); }
function createdMs(value: any): number | undefined {
  const raw = value?.created ?? value?.created_at ?? value?.createdAt ?? value?.submitted_at;
  if (typeof raw === "number") return raw < 10_000_000_000 ? raw * 1000 : raw;
  if (typeof raw === "string") { const parsed = Date.parse(raw); return Number.isFinite(parsed) ? parsed : undefined; }
}
export async function listSubmissions(api: EasyAiApi) {
  const dir = recordDir(api); await mkdir(dir, { recursive: true });
  return Promise.all((await readdir(dir)).filter(f => f.endsWith(".json")).map(async f => JSON.parse(await readFile(join(dir, f), "utf8"))));
}
export async function recoverSubmission(api: EasyAiApi, key: string): Promise<unknown> {
  const file = recordPath(api, key);
  const record = JSON.parse(await readFile(file, "utf8"));
  if (record.state === "rejected") throw new CliError(`Submission ${key} was rejected before acceptance: ${record.error || "validation failure"}. No recovery or resubmission was attempted.`, ExitCode.Usage);
  if (record.taskId) return readGeneration(api, record.taskId);
  if (record.state === 'completed' && record.result && findUrls(record.result).length) return record.result;
  const found = await api.get(`/v1/tasks?idempotencyKey=${encodeURIComponent(key)}`);
  const rows = taskRows(found);
  const exact = rows.filter((r: any) => (r.idempotencyKey || r.idempotency_key || r.clientMutationId) === key && rowId(r));
  let matches = exact;
  let recovery = "idempotency-key";
  let candidates: any[] = [];
  if (!matches.length && record.baselineCaptured && Array.isArray(record.baselineTaskIds)) {
    const baseline = new Set<string>(record.baselineTaskIds);
    const earliest = Date.parse(record.createdAt) - 2_000;
    // A manually resumed submission must not adopt anything created long after
    // the original attempt: the task can only appear while that POST was in
    // flight (its timeout) plus the recovery poll. Cap "now" against that.
    const grace = (typeof record.submitTimeoutMs === "number" ? record.submitTimeoutMs : 120_000) + 120_000;
    const latest = Math.min(Date.now() + 5_000, Date.parse(record.createdAt) + grace);
    candidates = rows.filter((r: any) => {
      const id = rowId(r), created = createdMs(r);
      if (!id || baseline.has(id) || created === undefined || created < earliest || created > latest) return false;
      // When the platform exposes the execution chain, the recorded model must
      // appear there; otherwise a later task of the same media kind could match.
      const chainModels = Array.isArray(r.execution_chain) ? r.execution_chain.map((c: any) => c?.model).filter(Boolean) : [];
      return !(record.model && chainModels.length && !chainModels.includes(record.model));
    });
    // Candidates are informational only. A nearby task is not proof of ownership.
  }
  if (matches.length !== 1) {
    // Some platforms label an in-flight video task with a different task_type
    // (observed: "image"). Never attach it automatically, but surface the
    // candidates so the owner can confirm and download by task ID.
    const seen = candidates.map((r: any) => `${rowId(r)}(${[r.task_type, r.taskType, r.task_status].filter(Boolean).join("/") || "unknown"})`).slice(0, 5);
    throw new CliError(`Submission ${key} is uncertain; lookup did not identify exactly one matching task. Do not resubmit.${seen.length ? ` New tasks in the submission window: ${seen.join(", ")}. Confirm which one belongs to this request, then download it by task ID.` : ""}`, ExitCode.Service);
  }
  const id = rowId(matches[0]);
  await writeJson(file, { ...record, state: "accepted", taskId: id, recoveredBy: recovery });
  return matches[0];
}

export function taskRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["items", "data", "tasks", "results"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
    if (nested && typeof nested === "object") { const rows = taskRows(nested); if (rows.length) return rows; }
  }
  return [];
}

export const generationSubmitTimeoutMs = 15 * 60_000;
export interface SubmissionOptions { submitTimeoutMs?: number; recoveryWaitMs?: number; allowDuplicatePayload?: boolean; requestHash?: string; runPath?: string; onPrepared?: () => Promise<void>; }
export async function submitAsyncWithRecovery(api: EasyAiApi, path: string, payload: Record<string, unknown>, idempotencyKey: string, kind: "image" | "video" = "image", options: SubmissionOptions = {}): Promise<unknown> {
  let claimPath: string | undefined;
  if (idempotencyKey.startsWith("seedance-")) {
    const claims = join(configDir(), "approvals"); await mkdir(claims, { recursive: true });
    claimPath = join(claims, `${payloadHash(idempotencyKey)}.json`);
    const claim = { scope: api.scope || "test", payloadHash: payloadHash(payload) };
    try { if (!await writeJson(claimPath, claim, true)) throw Object.assign(new Error('exists'), { code: 'EEXIST' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const prior = JSON.parse(await readFile(claimPath, "utf8"));
      if (prior.scope !== claim.scope || prior.payloadHash !== claim.payloadHash) throw new CliError("This Seedance approval was already consumed by another request. Resume the original task.", ExitCode.Approval);
    }
  }
  await mkdir(recordDir(api), { recursive: true });
  const file = recordPath(api, idempotencyKey);
  const requestHash = options.requestHash || payloadHash(payload);
  let payloadClaim: string | undefined;
  let ownsClaim = false;
  if (!options.allowDuplicatePayload) {
    const duplicate = (await listSubmissions(api)).find(row => row.idempotencyKey !== idempotencyKey && row.path === path && (row.requestHash || row.payloadHash) === requestHash && row.state !== 'rejected');
    if (duplicate) throw new CliError(`An identical request already exists under idempotency key ${duplicate.idempotencyKey}${duplicate.taskId ? ` (task ${duplicate.taskId})` : ""}. Resume it instead of submitting again; use --allow-reroll only after the user explicitly requests another generation.`, ExitCode.Conflict);
    const claims = join(recordDir(api), '.payloads'); await mkdir(claims, { recursive: true });
    payloadClaim = join(claims, `${payloadHash({ path, requestHash })}.json`);
    ownsClaim = await writeJson(payloadClaim, { idempotencyKey }, true);
    if (!ownsClaim) {
      const owner = JSON.parse(await readFile(payloadClaim, 'utf8'));
      if (owner.idempotencyKey !== idempotencyKey) throw new CliError(`Identical request already claimed by ${owner.idempotencyKey}. Resume it; no duplicate was submitted.`, ExitCode.Conflict);
    }
  }
  const record = { idempotencyKey, path, kind, model: typeof payload.model === "string" ? payload.model : undefined, submitTimeoutMs: options.submitTimeoutMs, payloadHash: payloadHash(payload), requestHash, runPath: options.runPath, state: "preparing", createdAt: new Date().toISOString(), baselineCaptured: false, baselineTaskIds: [] as string[] };
  try { if (!await writeJson(file, record, true)) throw Object.assign(new Error('exists'), { code: 'EEXIST' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(file, "utf8"));
    if ((previous.requestHash || previous.payloadHash) !== requestHash || previous.path !== path) {
      if (ownsClaim && payloadClaim) await unlink(payloadClaim);
      throw new CliError("Idempotency key already belongs to a different request.", ExitCode.Conflict);
    }
    return recoverSubmission(api, idempotencyKey);
  }
  try {
    await options.onPrepared?.();
    try {
      const before = taskRows(await api.get("/v1/tasks"));
      record.baselineTaskIds = before.map(rowId).filter((id): id is string => Boolean(id));
      record.baselineCaptured = true;
    } catch { /* idempotency-key recovery remains available */ }
    record.state = "uncertain";
    await writeJson(file, record);
    const headers = { "Idempotency-Key": idempotencyKey, "x-async": "true" };
    const result = options.submitTimeoutMs && "postWithTimeout" in api ? await api.postWithTimeout(path, payload, headers, options.submitTimeoutMs) : await api.post(path, payload, headers);
    const id = taskId(result);
    if (!id && !path.includes("images")) throw new CliError("Submission returned no task ID", ExitCode.Service);
    if (!id && !findUrls(result).length) throw new CliError("Submission returned no task ID or output", ExitCode.Service);
    // Private state retains signed output URLs for exact recovery; user-facing
    // run records and output are separately redacted.
    await writeJson(file, { ...record, state: id ? "accepted" : "completed", taskId: id, ...(!id ? { result } : {}) });
    return result;
  }
  catch (error) {
    if (error instanceof CliError && error.exitCode === ExitCode.Usage) {
      // A provider validation rejection created no paid task. Preserve the
      // diagnostic and release the creative claim so a corrected payload can
      // reuse the same approved manifest without another approval ceremony.
      if (claimPath) await unlink(claimPath).catch(() => undefined);
      if (payloadClaim) await unlink(payloadClaim).catch(() => undefined);
      await writeJson(file, { ...record, state: "rejected", error: redact(error.message), errorDetails: redact(error.details), rejectedAt: new Date().toISOString() });
      throw error;
    }
    if (!(error instanceof CliError) || error.exitCode !== ExitCode.Service) throw error;
    const transportUncertain = /timed out|fetch failed|network|socket|econn|connection/i.test(error.message);
    const deadline = Date.now() + (transportUncertain ? options.recoveryWaitMs || 0 : 0);
    let lookupError: unknown;
    do {
      try { return await recoverSubmission(api, idempotencyKey); }
      catch (current) { lookupError = current; }
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, Math.min(3000, Math.max(250, deadline - Date.now()))));
    } while (Date.now() <= deadline);
    throw uncertainSubmission(idempotencyKey, error, kind, lookupError);
  }
}

export async function submitImageWithRecovery(api: EasyAiApi, payload: Record<string, unknown>, idempotencyKey: string, options?: SubmissionOptions): Promise<unknown> {
  return submitAsyncWithRecovery(api, "/v1/images/generations", payload, idempotencyKey, "image", options);
}

function uncertainSubmission(key: string, original: unknown, kind: "image" | "video", lookup?: unknown): CliError {
  const suffix = lookup ? ` Task lookup also failed: ${redact((lookup as Error).message || lookup)}` : " Task lookup returned no matching task.";
  return new CliError(`${kind.charAt(0).toUpperCase()}${kind.slice(1)} submission outcome is uncertain for idempotency key ${key}; no retry was made.${suffix} Original error: ${redact((original as Error).message || original)}`, ExitCode.Service);
}
