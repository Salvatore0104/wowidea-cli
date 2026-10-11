import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CliError, ExitCode } from "./errors.js";
import { writeJson } from "./storage.js";
import { endpointFor, isFinalizeModel, resolveTask, type TaskSpec } from "./task-router.js";

export interface BatchJob {
  id: string;
  kind?: TaskSpec["media"];
  prompt: string;
  task?: string;
  model?: string;
  input?: string;
  params?: Record<string, unknown>;
}

export interface PreparedJob extends BatchJob {
  kind: TaskSpec["media"];
  model: string;
  chain: string[];
  endpoint: string;
  idempotencyKey: string;
  dedupeKey: string;
}

export interface BatchClient {
  submit(job: PreparedJob): Promise<{ taskId?: string; urls?: string[]; status?: string }>;
  poll(taskId: string): Promise<{ status: string; urls: string[] }>;
  download(urls: string[], directory: string): Promise<string[]>;
}

export interface BatchOptions {
  jobs: BatchJob[];
  outDir: string;
  statePath?: string;
  concurrency?: number;
  perModel?: number;
  gapMs?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  client: BatchClient;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  onProgress?: (event: Record<string, unknown>) => void;
}

export interface JobState {
  id: string;
  status: "pending" | "submitted" | "done" | "failed" | "deduped";
  model?: string;
  taskId?: string;
  attempts: number;
  output: string[];
  error?: string;
  dedupeKey: string;
}

const TERMINAL_OK = new Set(["completed", "succeeded", "success"]);
const TERMINAL_BAD = new Set(["failed", "error", "cancelled", "canceled"]);

export function parseManifest(text: string, filename = "manifest.json"): BatchJob[] {
  const trimmed = text.trim();
  let value: unknown;
  if (filename.endsWith(".csv") || (!trimmed.startsWith("{") && !trimmed.startsWith("[") && trimmed.includes(",") && /^(id|kind|prompt),/i.test(trimmed))) value = parseCsv(trimmed);
  else if (trimmed.startsWith("{") || trimmed.startsWith("[")) value = JSON.parse(trimmed);
  else value = parseSimpleYaml(trimmed);
  const jobs = Array.isArray(value) ? value : (value as { jobs?: unknown })?.jobs;
  if (!Array.isArray(jobs) || !jobs.length) throw new CliError("Manifest needs a jobs array.", ExitCode.Usage);
  return jobs.map((job, index) => normalizeJob(job, index));
}

function normalizeJob(value: unknown, index: number): BatchJob {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const prompt = String(row.prompt || "").trim();
  if (!prompt) throw new CliError(`Job ${index + 1} is missing a prompt.`, ExitCode.Usage);
  const kind = row.kind ? String(row.kind) as TaskSpec["media"] : undefined;
  if (kind && !["image", "video", "3d", "music", "speech"].includes(kind)) throw new CliError(`Job ${row.id || index + 1} has unknown kind ${kind}.`, ExitCode.Usage);
  return { id: String(row.id || `job-${index + 1}`), kind, prompt, task: row.task ? String(row.task) : undefined, model: row.model ? String(row.model) : undefined, input: row.input ? String(row.input) : undefined, params: row.params && typeof row.params === "object" ? row.params as Record<string, unknown> : undefined };
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const headers = splitCsv(lines[0]!).map(cell => cell.trim());
  return lines.slice(1).map(line => Object.fromEntries(splitCsv(line).map((cell, index) => [headers[index] || `col${index}`, cell])));
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "", quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(current); current = ""; }
    else current += char;
  }
  cells.push(current);
  return cells;
}

function parseSimpleYaml(text: string): { jobs: BatchJob[] } {
  const jobs: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim() || /^jobs:\s*$/.test(line.trim())) continue;
    const item = line.match(/^\s*-\s+([^:]+):\s*(.*)$/);
    if (item) {
      if (current) jobs.push(current);
      current = { [item[1]!.trim()]: unquote(item[2] || "") };
      continue;
    }
    const field = line.match(/^\s+([^:]+):\s*(.*)$/);
    if (field && current) current[field[1]!.trim()] = unquote(field[2] || "");
  }
  if (current) jobs.push(current);
  return { jobs: jobs as unknown as BatchJob[] };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function prepare(job: BatchJob): PreparedJob {
  if (isFinalizeModel(job.model) || ["video-final", "成片", "final"].includes(job.task || "")) {
    throw new CliError(`Job ${job.id} asks for a final video. Final renders are never batched. Use wowidea video finalize <draftId> --yes.`, ExitCode.Usage);
  }
  const routed = job.task ? resolveTask(job.task) : undefined;
  if (routed?.finalizeOnly) throw new CliError(`Job ${job.id} resolves to a final render. Refusing to batch it.`, ExitCode.Usage);
  const kind = job.kind || routed?.media || "image";
  const model = job.model || routed?.model;
  if (!model) throw new CliError(`Job ${job.id} needs a task or a model.`, ExitCode.Usage);
  if (isFinalizeModel(model)) throw new CliError(`Job ${job.id} uses ${model}, which cannot be generated from a prompt.`, ExitCode.Usage);
  const chain = [model, ...(routed?.chain || []).filter(name => name !== model && !isFinalizeModel(name))];
  const dedupeKey = digest({ kind, prompt: job.prompt, model, input: job.input || "", params: job.params || {} });
  return { ...job, kind, model, chain, endpoint: endpointFor(kind), idempotencyKey: `batch-${dedupeKey}`, dedupeKey };
}

function retryable(error: unknown): boolean {
  const status = (error as { httpStatus?: number })?.httpStatus;
  if (status && [408, 429, 500, 502, 503, 504].includes(status)) return true;
  return /timeout|temporar|rate|429|503|unavailable/i.test(String((error as Error)?.message || error));
}

function createPool(limit: number, onActive?: (active: number) => void) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>(done => waiting.push(done));
    active += 1;
    onActive?.(active);
    try { return await fn(); }
    finally { active -= 1; waiting.shift()?.(); }
  };
}

export async function runBatch(options: BatchOptions): Promise<{ ok: boolean; outDir: string; statePath: string; maxInFlight: number; jobs: JobState[] }> {
  const concurrency = options.concurrency ?? 6;
  const perModel = options.perModel ?? 2;
  const maxAttempts = options.maxAttempts ?? 3;
  const gapMs = options.gapMs ?? 400;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const sleep = options.sleep ?? (ms => new Promise<void>(done => setTimeout(done, ms)));
  const clock = options.clock ?? (() => Date.now());
  if (concurrency < 1 || perModel < 1 || maxAttempts < 1) throw new CliError("Concurrency, per-model limit and attempts must be at least 1.", ExitCode.Usage);
  const outDir = resolve(options.outDir);
  const statePath = resolve(options.statePath || resolve(outDir, "batch-state.json"));
  await mkdir(dirname(statePath), { recursive: true });
  await mkdir(outDir, { recursive: true });
  const previous = await readFile(statePath, "utf8").then(JSON.parse).catch(() => ({ jobs: {} })) as { jobs?: Record<string, JobState> };
  const states: Record<string, JobState> = { ...previous.jobs };
  const runnable: PreparedJob[] = [];
  for (const [index, job] of options.jobs.entries()) {
    const id = job.id || `job-${index + 1}`;
    try {
      const prepared = prepare({ ...job, id });
      const prior = states[id];
      if (prior?.status === "done" || prior?.status === "deduped") continue;
      states[id] = { id, status: prior?.status === "submitted" && prior.taskId ? "submitted" : "pending", model: prepared.model, taskId: prior?.taskId, attempts: prior?.attempts || 0, output: prior?.output || [], dedupeKey: prepared.dedupeKey };
      if (prior?.taskId) prepared.model = prior.model || prepared.model;
      runnable.push(prepared);
    } catch (error) {
      states[id] = { id, status: "failed", attempts: 0, output: [], dedupeKey: "", error: (error as Error).message };
    }
  }
  const persist = () => writeJson(statePath, { schemaVersion: "wowidea.batch/v1", updatedAt: new Date(clock()).toISOString(), jobs: states });
  await persist();
  let maxInFlight = 0;
  const globalPool = createPool(concurrency, active => { maxInFlight = Math.max(maxInFlight, active); });
  const modelPools = new Map<string, ReturnType<typeof createPool>>();
  const modelPool = (model: string) => {
    let pool = modelPools.get(model);
    if (!pool) { pool = createPool(perModel); modelPools.set(model, pool); }
    return pool;
  };
  const nextAt = new Map<string, number>();
  const results = new Map<string, Promise<JobState>>();

  async function pollUntil(job: PreparedJob, state: JobState): Promise<void> {
    if (!state.taskId) throw new CliError(`Job ${job.id} returned no task.`, ExitCode.Service);
    const deadline = clock() + timeoutMs;
    let polled = await options.client.poll(state.taskId);
    while (!TERMINAL_OK.has(polled.status) && !TERMINAL_BAD.has(polled.status)) {
      if (clock() >= deadline) throw new CliError(`Job ${job.id} timed out.`, ExitCode.Service);
      await sleep(pollIntervalMs);
      polled = await options.client.poll(state.taskId);
    }
    if (TERMINAL_BAD.has(polled.status)) throw new CliError(`Job ${job.id} ${polled.status}.`, ExitCode.Service);
    state.output = polled.urls.length ? await options.client.download(polled.urls, resolve(outDir, job.id)) : [];
    state.status = "done";
  }

  async function doJob(job: PreparedJob): Promise<JobState> {
    const state = states[job.id]!;
    let last: unknown;
    const models = state.taskId ? [state.model || job.model] : job.chain;
    for (const model of models) {
      state.model = model;
      const reserve = () => {
        const now = clock();
        const at = nextAt.get(model) ?? now;
        const start = Math.max(at, now);
        nextAt.set(model, start + gapMs);
        return start - now;
      };
      for (let attempt = state.attempts + 1; attempt <= maxAttempts; attempt++) {
        state.attempts = attempt;
        const wait = reserve();
        if (wait > 0) await sleep(wait);
        try {
          options.onProgress?.({ id: job.id, status: "submit", model, attempt });
          if (state.taskId && state.status === "submitted") { await pollUntil(job, state); return state; }
          const submitted = await options.client.submit({ ...job, model, idempotencyKey: `${job.idempotencyKey}:${model}` });
          state.taskId = submitted.taskId;
          state.status = "submitted";
          if (submitted.urls?.length && (!submitted.status || TERMINAL_OK.has(submitted.status))) {
            state.output = await options.client.download(submitted.urls, resolve(outDir, job.id));
            state.status = "done";
            return state;
          }
          await pollUntil(job, state);
          return state;
        } catch (error) {
          last = error;
          state.error = (error as Error).message || String(error);
          state.taskId = undefined;
          state.status = "pending";
          if (attempt >= maxAttempts || !retryable(error)) break;
          await sleep(200 * 2 ** (attempt - 1));
        }
      }
    }
    state.status = "failed";
    state.error ||= (last as Error)?.message || "failed";
    return state;
  }

  function start(job: PreparedJob): Promise<JobState> {
    const existing = results.get(job.dedupeKey);
    if (existing) return existing.then(winner => {
      const state = states[job.id]!;
      if (winner.status === "done" || winner.status === "deduped") {
        state.status = "deduped"; state.output = winner.output; state.taskId = winner.taskId; state.model = winner.model;
      } else state.status = "failed", state.error = winner.error || state.error;
      return state;
    });
    const run = globalPool(() => modelPool(job.model)(() => doJob(job))).then(state => { states[job.id] = state; return state; });
    results.set(job.dedupeKey, run);
    return run;
  }

  await Promise.all(runnable.map(job => start(job).then(async state => { states[job.id] = state; options.onProgress?.({ ...state }); await persist(); })));
  await persist();
  const jobs = options.jobs.map((job, index) => states[job.id || `job-${index + 1}`]!);
  return { ok: jobs.every(job => job.status === "done" || job.status === "deduped"), outDir, statePath, maxInFlight, jobs };
}
