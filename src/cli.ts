#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { EasyAiApi, downloadUrls, findUrls } from "./api.js";
import { accessToken, authStatus, browserLogin, logout, useApiKey } from "./auth.js";
import { getProfile, creativeDefaults } from "./config.js";
import { CliError, ExitCode, isNotFound, redact } from "./errors.js";
import { emit, OutputOptions } from "./output.js";
import { localQuote, payloadHash, Quote, saveQuote } from "./preflight.js";
import { approveManifest, creativeHash, readManifest, seedancePayload, uploadReferences, validateManifest, validateStoryboardQc } from "./seedance.js";
import { submitAsyncWithRecovery, submitImageWithRecovery, listSubmissions, recoverSubmission, readGeneration, taskStatus, taskRows, generationSubmitTimeoutMs } from "./submission.js";
import { findModel, matchesModelType, registryEntry, routeModel, validateCapabilities } from "./models.js";
import { initProject, readProject, recordCreation } from "./project.js";
import { guideRegistry, guideInfo, showGuide } from "./guides.js";
import { prepareVideoPayload, withOmniContent } from "./video-payload.js";

import { setupProject } from './setup.js';
import { usageResult } from './usage.js';
import { loadPrices, importPrices, estimate, syncPrices, platformEstimate } from './pricing.js';
import { autoRoute, applyPlatformEstimates } from './routing.js';
import { normalizeRequest } from './request-normalization.js';
import { prepareReferences, uploadMedia, writeRun, refreshRun, referenceIdentity, runFile } from './media.js';
import { mediaInput } from './media-input.js';
import { bindCanvasProject, canvasProjectUrl, ensureCanvasBinding, readCanvasBinding, verifyCanvasBinding } from './canvas-binding.js';
import { generateOnCanvas } from './canvas-generation.js';
import { capabilitiesDocument } from './capabilities.js';
import { loadModelCatalog } from './catalog.js';
import { parseManifest, runBatch, type BatchClient } from './batch.js';
import { keyImage } from './chroma.js';
import { finalizeDraft } from './finalize.js';
import { planLayers, renderLayers } from './layers.js';
import { applyDraftContract, canFallback, endpointFor, isFinalizeModel, resolveTask } from './task-router.js';

interface GlobalOptions extends OutputOptions { profile?: string; canvasProfile?: string; baseUrl?: string; timeout: string; noColor?: boolean; apiKey?: string; apiKeyStdin?: boolean }
const program = new Command();
program.name("wowidea").description("Images, video, and layers on wowidea.top. Start: wowidea capabilities --json").version("0.8.0")
  .addHelpText("after", `
Examples:
  wowidea capabilities --json
  wowidea models by-task direction --json
  wowidea image generate --task typography --prompt "海报标题" --json --direct
  wowidea video generate --task video --prompt "缓慢推近" --duration 5 --json --direct
  wowidea video finalize <draftId> --yes
  wowidea batch run --manifest jobs.json --concurrency 6 --json
  wowidea key ./subject.png --out ./cutout.png
`)
  .option("--profile <name>", "configuration profile")
  .option("--canvas-profile <name>", "separate Canvas OAuth profile")
  .option("--base-url <url>", "EasyAI server URL")
  .option("--json", "stable JSON output")
  .option("--jsonl", "one JSON object per line")
  .option("--output <file>", "write large JSON response to a file")
  .option("--api-key <key>", "use an API key for this invocation; prefer --api-key-stdin")
  .option("--api-key-stdin", "read an API key from stdin for this invocation")
  .option("--timeout <ms>", "request timeout", "30000")
  .option("--no-color", "disable color output")
  .showHelpAfterError();

const globals = (cmd: Command): GlobalOptions => cmd.optsWithGlobals() as GlobalOptions;
const output = (value: unknown, cmd: Command) => { const o = globals(cmd); return emit(value, { json: o.json, jsonl: o.jsonl, output: o.output }); };
async function apiFor(cmd: Command): Promise<EasyAiApi> {
  const opts = globals(cmd); const profile = await getProfile(opts.profile, opts.baseUrl); const timeoutMs = Number(opts.timeout);
  const token = opts.apiKeyStdin ? await readStdinApiKey() : opts.apiKey?.trim() || await accessToken(profile.name, profile.config.baseUrl, timeoutMs);
  if (!token) throw new CliError("API key cannot be empty.", ExitCode.Auth);
  return new EasyAiApi({ baseUrl: profile.config.baseUrl, token, timeoutMs });
}
async function jsonInput(opts: { data?: string; file?: string }): Promise<Record<string, unknown>> {
  if (opts.data && opts.file) throw new CliError("Use either --data or --file, not both.", ExitCode.Usage);
  try { const value = JSON.parse(opts.data ?? (opts.file ? await readFile(resolve(opts.file), "utf8") : "{}")); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required'); return value; }
  catch { throw new CliError("Input must be valid JSON.", ExitCode.Usage); }
}
function dataOptions(command: Command): Command { return command.option("--data <json>", "JSON request body").option("--file <path>", "JSON request body file"); }
const enc = encodeURIComponent;

program.command('doctor').description('Check authentication and website read-only interfaces; no generation').action(async (_o, c) => {
  const checks: Record<string, unknown> = {};
  try {
    const api = await apiFor(c);
    for (const [name, path] of [['models', '/v1/models'], ['balance', '/v1/balance'], ['tasks', '/v1/tasks?page=1&page_size=1']]) {
      try {
        const value = await api.get<any>(path!);
        const body = value?.data ?? value;
        const valid = name === 'balance' ? typeof body?.total === 'number' : Array.isArray(body) || ['items','tasks','results'].some(field => Array.isArray(body?.[field]));
        if (!valid) throw new CliError(`Unexpected ${name} response; HTTP success did not establish interface compatibility.`, ExitCode.Service);
        checks[name!] = { ok: true, ...(name === 'models' ? { count: taskRows(value).length } : {}) };
      } catch (error) { checks[name!] = { ok: false, error: String((error as Error).message) }; }
    }
  } catch (error) { checks.authentication = { ok: false, error: String((error as Error).message) }; }
  const ok = Object.values(checks).every((check: any) => check.ok);
  await output({ ok, checks }, c); if (!ok) process.exitCode = ExitCode.Service;
});

const localProject = program.command("project").description("Local programme preferences and creation records; no API calls");
localProject.command("init").option("--dir <path>", "programme directory", ".").option("--name <name>", "programme name", "").action(async (o, c) => output(await initProject(o.dir, o.name), c));
localProject.command("show").option("--dir <path>", "programme directory", ".").action(async (o, c) => output(await readProject(o.dir), c));
localProject.command("validate").option("--dir <path>", "programme directory", ".").action(async (o, c) => { const result = await readProject(o.dir); await output({ valid: true, ...result }, c); });
localProject.command("record").requiredOption("--file <path>", "creation JSON").option("--dir <path>", "programme directory", ".").action(async (o, c) => output(await recordCreation(o.dir, await jsonInput(o)), c));
localProject.command('setup').option('--dir <path>', 'project directory', '.').option('--name <name>', 'local and remote Canvas project name').option('--update', 'explicitly update managed runtime and unmodified skills').option('--no-canvas', 'install files without creating a remote Canvas binding').action(async (o,c) => output(await setupProject(o.dir, o.update, undefined, o.name, globals(c).canvasProfile, o.canvas),c));
const projectCanvas = localProject.command('canvas').description('Show, verify, or explicitly replace this directory Canvas binding');
projectCanvas.command('show').option('--dir <path>', 'project directory', '.').action(async(o,c)=>{ const binding=await readCanvasBinding(o.dir); await output({...binding,canvasUrl:canvasProjectUrl(binding.projectId)},c); });
projectCanvas.command('verify').option('--dir <path>', 'project directory', '.').action(async(o,c)=>{ const binding=await verifyCanvasBinding(o.dir,globals(c).canvasProfile); await output({...binding,canvasUrl:canvasProjectUrl(binding.projectId)},c); });
projectCanvas.command('open').description('Return the bound Canvas URL for a Codex side panel; never launches a browser').option('--dir <path>', 'project directory', '.').action(async(o,c)=>{ const binding=await verifyCanvasBinding(o.dir,globals(c).canvasProfile); await output({projectId:binding.projectId,projectName:binding.projectName,canvasUrl:canvasProjectUrl(binding.projectId),presentation:'codex-right-sidebar'},c); });
for (const action of ['bind','switch'] as const) projectCanvas.command(action).argument('<projectId>').option('--dir <path>', 'project directory', '.').action(async(id,o,c)=>output(await bindCanvasProject(o.dir,id,globals(c).canvasProfile || 'default',action==='switch'),c));
const prices = program.command('prices');
prices.command('sync').requiredOption('--url <https-url>', 'verified public wowidea.prices/v1 snapshot URL').action(async(o,c)=>output(await syncPrices(o.url),c));
prices.command('show').action(async (_o,c) => output(await loadPrices() || { available: false, reason: 'Import a website price snapshot; public price endpoint not verified.' },c));
prices.command('import').argument('<file>').action(async (f,_o,c) => output(await importPrices(resolve(f)),c));
const files = program.command('files');
files.command('upload').argument('<file>').option('--project-dir <path>', 'project root', '.').action(async(f,o,c) => output(await uploadMedia(await apiFor(c),f,o.projectDir),c));
const guides = program.command("guides").description("Bundled versioned creative resources; works offline");
guides.command("list").action(async (_o, c) => output(guideRegistry.map(g => guideInfo(g.id)), c));
guides.command("show").argument("<id>").action(async (id, _o, c) => output(await showGuide(id), c));

const auth = program.command("auth").description("Manage CLI authentication");
auth.command("login").action(async (_o, c) => { const g = globals(c); await output(await browserLogin(g.profile, g.baseUrl, Number(g.timeout)), c); });
auth.command("logout").action(async (_o, c) => { const g = globals(c); await output(await logout(g.profile, g.baseUrl), c); });
auth.command("status").action(async (_o, c) => { const g = globals(c); await output(await authStatus(g.profile, g.baseUrl), c); });
auth.command("use-key").argument("[key]").option("--key-stdin", "read key from stdin").option("--prompt", "hidden local terminal input").action(async (key: string | undefined, o, c) => {
  const value = o.prompt ? await hiddenKey() : o.keyStdin ? await readStdin() : key; if (!value) throw new CliError("Provide --prompt or --key-stdin.", ExitCode.Usage);
  const g = globals(c); await output(await useApiKey(value, g.profile, g.baseUrl), c);
});

const keys = program.command("api-key").description("Manage account-level automation keys");
keys.command("create").requiredOption("--name <name>").option("--note <text>").option("--expires-at <iso>").action(async o => {
  const api = await apiFor(keys); await outputApiKeyOnce(await api.post("/auth-token", { name: o.name, remark: o.note, expiresAt: o.expiresAt }), keys);
});
keys.command("list").action(async () => output(await (await apiFor(keys)).get("/auth-token"), keys));
keys.command("revoke").argument("<id>").action(async id => output(await (await apiFor(keys)).delete(`/auth-token/${enc(id)}`), keys));

const models = program.command("models");
models.command("list").option("--type <type>", "image, video, or a raw platform modelType").action(async (o, c) => {
  const result = await (await apiFor(c)).get<any>("/v1/models");
  // The platform accepts but currently ignores ?type=, so filter locally and keep the flag honest.
  const rows = taskRows(result);
  if (!o.type) { await output(result, c); return; }
  const filtered = rows.filter((row: any) => matchesModelType(row, o.type));
  await output({ ...(result && typeof result === "object" ? result : {}), data: filtered, total: filtered.length }, c);
});
models.command("show").argument("<id>").action(async (id, _o, c) => {
  const result = await (await apiFor(c)).get<unknown>("/v1/models");
  const found = findModel(result, id);
  if (!found) { await output({ found: false, id }, c); return; }
  const entry = registryEntry(found);
  await output(entry ? { ...found, guide: entry.guide, guideInfo: guideInfo(entry.guide.replace(/^references\//, "").replace(/\.md$/, "")) } : found, c);
});
dataOptions(models.command('route')).requiredOption('--kind <image|video>').option('--model <name>').option('--purpose <text>').option('--stage <preview|final|edit|refine>').option('--speed').option('--prices <file>').action(async(o,c) => { const api = await apiFor(c); const catalog = await api.get('/v1/models'); const routed = autoRoute(catalog,{kind:o.kind, model:o.model, purpose:o.purpose, stage:o.stage, speed:o.speed, payload:await jsonInput(o)},await (o.prices ? loadPrices(o.prices) : syncPrices())); await output(routed.needsInput ? routed : await applyPlatformEstimates(api, routed), c); });
const tasks = program.command("tasks").description("Persisted submissions; recovery never submits another task");
tasks.command("list").action(async (_o, c) => output(await listSubmissions(await apiFor(c)), c));
tasks.command("remote").description("List this account's tasks from the server (read-only)").option("--page <n>", "page number", "1").option("--page-size <n>", "rows per page", "20").action(async (o, c) => {
  const page = Number(o.page), size = Number(o.pageSize);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 200) throw new CliError("--page must be a positive integer and --page-size must be between 1 and 200.", ExitCode.Usage);
  await output(await (await apiFor(c)).get(`/v1/tasks?page=${page}&page_size=${size}`), c);
});
tasks.command("resume").argument("<idempotencyKey>").option('--wait', 'wait and download the existing task').option('--dir <path>', 'download directory', 'wowidea-output').action(async (key, o, c) => {
  const api = await apiFor(c), prior = (await listSubmissions(api)).find(row => row.idempotencyKey === key);
  if (!prior) throw new CliError('Unknown local request key. Use image/video status with a known task ID.', ExitCode.Usage);
  const recovered = await recoverSubmission(api, key);
  const result = await usageResult(api, o.wait ? await completeGeneration(api, recovered, prior.kind, o.dir) : recovered);
  await refreshRun(prior.runPath, result); await output({ ...result, idempotencyKey: key }, c);
});
program.command("balance").action(async (_o, c) => output(await (await apiFor(c)).get("/v1/balance"), c));

function taskCommands(parent: Command, media: "image" | "video") {
  parent.command("status").argument("<taskId>").action(async (id, _o, c) => (async()=>{const api=await apiFor(c);await output(await usageResult(api,await readGeneration(api,id)),c)})());
  parent.command("download").argument("<taskId>").option("--dir <path>", "download directory", ".").action(async (id, o, c) => { const api=await apiFor(c); const value = await readGeneration(api, id); await output(await usageResult(api,{ taskId: id, task:value, paths: await downloadUrls(findUrls(value), resolve(o.dir,id)) }), c); });
  parent.command("watch").argument("<taskId>").option("--interval <ms>", "poll interval", "2000").action(async (id, o, c) => watchTask(await apiFor(c), id, Number(o.interval), c));
  if (media === "video") {
    parent.command("cancel").argument("<taskId>").action(async (id, _o, c) => output(await (await apiFor(c)).post(`/v1/tasks/${enc(id)}/cancel`), c));
  }
}
const image = program.command('image');
dataOptions(image.command('preflight')).action(async(o,c)=>output(await preflight(await apiFor(c),'image','/v1/images/preflight',await jsonInput(o)),c));
registerMedia(image, 'image');
taskCommands(image,'image');

async function preflight(api: EasyAiApi, kind: Quote["kind"], path: string, payload: Record<string, unknown>): Promise<Quote> {
  if (kind === "image" || kind === "video") payload = normalizeRequest(payload, kind);
  if (kind === "video") payload = prepareVideoPayload(payload);
  if (kind === "image") { const selected = routeModel(await api.get("/v1/models"), "image", payload.model ? String(payload.model) : (await creativeDefaults()).image); payload.model = selected.model; validateCapabilities(selected, payload); }
  if (kind === "video") validateCapabilities(routeModel(await api.get("/v1/models"), "video", String(payload.model || "")), payload);
  try {
    const response = await api.post<any>(path, payload);
    const server = response.data && !response.quoteId ? response.data : response;
    const normalized = server.normalizedRequest || payload; const computedHash = payloadHash(normalized);
    if (!server.quoteId || !server.expiresAt || !Number.isFinite(Date.parse(server.expiresAt)) || (server.payloadHash && server.payloadHash !== computedHash)) throw new CliError("Server returned an invalid preflight quote.", ExitCode.Service);
    const quote: Quote = { quoteId: String(server.quoteId), serverQuoteId: String(server.quoteId), kind, payloadHash: computedHash, payload: normalized, estimatedCost: server.estimatedCost ?? null, currency: server.currency || "points", createdAt: new Date().toISOString(), expiresAt: server.expiresAt, source: "server" };
    quote.scope = api.scope;
    quote.submissionPath = kind === "video" ? "/v1/video/generations" : kind === "image" ? "/v1/images/generations" : path.replace(/\/preflight$/, "");
    await saveQuote(quote); return quote;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    const quote = localQuote(kind, payload); await saveQuote(quote); return quote;
  }
}
async function submitOnce(api: EasyAiApi, path: string, payload: Record<string, unknown>, key: string, allowDuplicatePayload = false): Promise<unknown> {
  const kind = path.includes("video") ? "video" : "image";
  return submitAsyncWithRecovery(api, path, payload, key, kind, { submitTimeoutMs: generationSubmitTimeoutMs, recoveryWaitMs: 90_000, allowDuplicatePayload });
}
async function submitDirect(api: EasyAiApi, path: string, payload: Record<string, unknown>, opts: { idempotencyKey?: string; allowReroll?: boolean; requestHash?: string; runPath?: string; onPrepared?: () => Promise<void> }): Promise<unknown> {
  const key = opts.idempotencyKey || randomUUID();
  const kind = path.includes("video") ? "video" : "image";
  return submitAsyncWithRecovery(api, path, payload, key, kind, { submitTimeoutMs: generationSubmitTimeoutMs, recoveryWaitMs: 90_000, allowDuplicatePayload: opts.allowReroll, requestHash: opts.requestHash, runPath: opts.runPath, onPrepared: opts.onPrepared });
}
const video = program.command('video');
dataOptions(video.command('preflight')).action(async(o,c)=>output(await preflight(await apiFor(c),'video','/v1/video/preflight',await jsonInput(o)),c));
registerMedia(video, 'video');
taskCommands(video,'video');
video.addHelpText("after", `
Examples:
  wowidea video generate --task video --prompt "缓慢推近" --duration 5 --json --direct
  wowidea video finalize <draftId>
  wowidea video finalize <draftId> --yes --json
`);
video.command("finalize").description("Seedance 2.5 成片 from a successful draft id. Prints the cost, then submits only with --yes.").argument("<draftId>").option("--yes", "submit the paid final render").option("--resolution <1080p|1440p>", "final resolution").option("--dir <path>", "download directory", "wowidea-output").option("--no-wait", "return the task id without waiting").action(async (draftId: string, o, c) => {
  const api = await apiFor(c);
  const result = await finalizeDraft(api, { draftId, yes: Boolean(o.yes), resolution: o.resolution });
  if (!result.submitted && !result.deduped) { await output(result, c); process.exitCode = ExitCode.Usage; return; }
  if (result.submitted && o.wait !== false) {
    const completed = await usageResult(api, await completeGeneration(api, { taskId: result.taskId }, "video", o.dir));
    await output({ ...result, ...completed }, c); return;
  }
  await output(result, c);
});

function registerMedia(parent: Command, kind: 'image'|'video') {
  const collect = (value: string, prior: string[]) => [...prior, value];
  for (const action of ['generate','edit'] as const) dataOptions(parent.command(action).description(`${kind} ${action}. Example: wowidea ${kind} ${action} --prompt "..." ${kind === "video" && action === "generate" ? "--task video --duration 5 " : ""}--json --direct`)).option('--direct', 'use the legacy non-Canvas generation API explicitly').option('--idempotency-key <key>', 'optional request key; automatically persisted when omitted').option('--manifest <path>')
    .option('--prompt <text>').option('--model <name>').option('--resolution <value>').option('--ratio <value>').option('--duration <seconds>', 'video duration', Number).option('--mode <value>', 'website generation mode')
    .option('--audio', 'enable video audio').option('--no-audio', 'disable video audio').option('--quality <value>').option('--format <value>')
    .option('--reference <path-or-url>', 'image reference; repeat for multiple images', collect, []).option('--video-reference <path-or-url>', 'video reference', collect, []).option('--audio-reference <path-or-url>', 'audio reference', collect, [])
    .option('--dir <path>', 'download directory','wowidea-output').option('--project-dir <path>', 'record directory','.').option('--parent <taskId>', 'source version task ID').option('--change <text>', 'revision summary').option('--purpose <text>').option('--stage <preview|final|edit|refine>').option('--task <task>', 'pick a model from the routing table').option('--fast', 'prefer the fast model for --task').option('--prices <file>').option('--no-wait').option('--allow-reroll').action(async(o,c) => {
    const api = await apiFor(c), startedAt = new Date().toISOString();
    let payload = await jsonInput(o);
    if(o.manifest) { if(o.file || o.data) throw new CliError('Use manifest or request JSON, not both.',ExitCode.Usage); const m = await readManifest(resolve(o.manifest)); await validateManifest(m, true); payload = seedancePayload(m); }
    payload = mediaInput(o, payload, kind);
    const plan = o.task ? resolveTask(String(o.task), { fast: Boolean(o.fast), stage: o.stage }) : undefined;
    if (plan?.finalizeOnly) throw new CliError(plan.message || '成片请使用 wowidea video finalize <draftId> --yes', ExitCode.Usage);
    if (plan && !payload.model) payload.model = plan.model;
    if (isFinalizeModel(String(payload.model || ''))) throw new CliError('Seedance 2.5 成片不能重新提交提示词。运行 wowidea video finalize <draftId> --yes', ExitCode.Usage);
    const chain = plan ? [...new Set([String(payload.model || plan.model), ...plan.chain])] : [String(payload.model || '')];
    if (!o.direct) {
      const canvasKey = o.idempotencyKey || (o.allowReroll ? randomUUID() : `canvas-${payloadHash({ kind, action, payload })}`);
      const result = await generateOnCanvas({ api, kind, action, payload, projectDir: o.projectDir, outputDir: o.dir, profile: globals(c).canvasProfile, wait: o.wait, requestKey: canvasKey });
      await output(result,c); return;
    }
    const basePayload = { ...payload };
    const explicitKey = o.idempotencyKey as string | undefined;
    const attempts = (o.task ? chain : [String(basePayload.model || "")]).filter((name, index, all) => Boolean(name) && all.indexOf(name) === index);
    let lastError: unknown;
    for (let index = 0; index < Math.max(attempts.length, 1); index++) {
      payload = { ...basePayload, ...(attempts[index] ? { model: attempts[index] } : {}) };
      o.idempotencyKey = index === 0 ? explicitKey : `${explicitKey || "task"}:fb:${index}`;
    try {
    const requestHash = payloadHash({ kind, action, purpose: o.purpose, stage: o.stage, payload: await referenceIdentity(payload, o.projectDir) });
    o.idempotencyKey ||= o.allowReroll ? randomUUID() : `auto-${requestHash}`;
    const prior = (await listSubmissions(api)).find(r => r.idempotencyKey === o.idempotencyKey);
    if (prior?.requestHash) {
      if (prior.requestHash !== requestHash || prior.kind !== kind) throw new CliError('Idempotency key already belongs to a different request.', ExitCode.Conflict);
      const recovered = await recoverSubmission(api, o.idempotencyKey);
      const result = await usageResult(api, o.wait ? await completeGeneration(api, recovered, kind, o.dir) : recovered);
      await refreshRun(prior.runPath, result);
      await output({ ...result, idempotencyKey: o.idempotencyKey, recordPath: prior.runPath }, c); return;
    }
    const prepared = await prepareReferences(api,payload,o.projectDir); payload=prepared.payload;
    if(action==='edit') {
      if(kind==='image' && !Array.isArray(payload.image_urls)) throw new CliError('Image editing requires image/image_urls references.',ExitCode.Usage);
      if(kind==='image' && !(payload.image_urls as any[]).length) throw new CliError('Image editing requires a source image.',ExitCode.Usage);
      if(kind==='video') { if(!(payload.video_urls as any[])?.length) throw new CliError('Video editing requires video_urls.',ExitCode.Usage); payload.mode ??= 'video_edit'; }
    }
    const catalog = await api.get('/v1/models'); const book = await loadPrices(o.prices);
    let routing: any;
    if(o.stage || o.purpose) {
      routing = autoRoute(catalog,{kind, model:payload.model as string, stage:o.stage || (action==='edit'?'edit':undefined), purpose:o.purpose, payload},book);
      if(routing.needsInput) { await output(routing,c); return; }
      if (routing.finalizeOnly) throw new CliError(routing.reason || "成片请使用 wowidea video finalize <draftId> --yes", ExitCode.Usage);
      payload=routing.payload;
    }
    const selected=routeModel(catalog,kind,payload.model ? String(payload.model) : (await creativeDefaults())[kind]);
    payload.model=selected.model;
    if (kind === 'video') {
      const has = (field: string) => Array.isArray(payload[field]) && (payload[field] as unknown[]).length > 0;
      payload.mode ??= has('video_urls') ? 'video_reference' : has('image_urls') ? 'image_reference' : has('audio_urls') ? 'audio_reference' : 'text_to_video';
      payload = applyDraftContract(payload, selected.id);
    }
    const allCapabilities = selected.capabilities.capabilities || {};
    const baseCapability = kind === 'image' ? allCapabilities[payload.image_urls ? 'image_edit' : 'image_generate'] || {} : allCapabilities.omni_video || allCapabilities[payload.mode === 'text_to_video' ? 'video_generate' : 'image_to_video'] || {};
    if (kind === 'video' && action === 'edit' && baseCapability.omni_reference_task_type?.constraints?.edit) payload.omni_reference_task_type = 'edit';
    const capability = { ...baseCapability, ...baseCapability.mode_constraints?.[String(payload.mode)], ...baseCapability.omni_reference_task_type?.constraints?.[String(payload.omni_reference_task_type)] };
    if (!payload.resolution) payload.resolution = (kind === 'image' ? ['4K','2K','1K'] : ['480p','720p','1080p','1440p']).find(r => capability.output_resolutions?.includes(r));
    payload.aspect_ratio ??= capability.forced_aspect_ratio || (capability.aspect_ratio_allowed?.includes('1:1') && kind === 'image' ? '1:1' : '16:9');
    if (kind === 'video') {
      payload.duration ??= capability.forced_duration ?? (capability.duration_options?.includes(5) ? 5 : capability.duration_options?.[0] ?? Math.max(5, capability.duration_range?.[0] || 5));
      payload.audio ??= capability.output_audio_mode === 'always';
    }
    if(kind==='video') { payload=prepareVideoPayload(payload); if(allCapabilities.omni_video && !payload.draft) payload=withOmniContent(payload); }
    payload=normalizeRequest(payload,kind); validateCapabilities(selected,payload);
    if(kind==='image' && payload.image_urls) { payload.image=payload.image_urls; delete payload.image_urls; }
    const offlinePricing=estimate(book,selected.model,kind,payload);
    const livePricing=await platformEstimate(api,payload);
    const pricing=livePricing?{...offlinePricing,estimatedPoints:livePricing.estimatedPoints,rawEstimatedPoints:livePricing.raw,reason:livePricing.reason,source:livePricing.source,discount:livePricing.discount}:offlinePricing;
    const record:any={schemaVersion:'wowidea.run/v1',idempotencyKey:o.idempotencyKey,kind,action,startedAt,parentTaskId:o.parent||null,change:o.change||null,stage:o.stage||action,purpose:o.purpose||null,routing,model:selected.model,payload,references:prepared.sources,pricing,qc:{verdict:'not_reviewed'},state:'prepared'};
    // Only the process that atomically claims submission may initialize its log.
    const runKey = `${api.scope}:${o.idempotencyKey}`;
    const recordPath = prior?.runPath || runFile(o.projectDir, runKey);
    let ownsSubmission = false;
    try {
      if (!globals(c).json && !globals(c).jsonl) process.stderr.write(`Request ${o.idempotencyKey}: submitting to website; provider failover is handled by the website.\n`);
      const submitted=await submitDirect(api,kind==='image'?'/v1/images/generations':'/v1/video/generations',payload,{...o,requestHash:prior && !prior.requestHash ? undefined : requestHash,runPath:recordPath,onPrepared:async()=>{ ownsSubmission = true; await writeRun(o.projectDir,runKey,record); }});
      record.taskId=findTaskId(submitted);record.state='submitted';if (ownsSubmission) await writeRun(o.projectDir,runKey,record);
      const result=await usageResult(api,o.wait?await completeGeneration(api,submitted,kind,o.dir):submitted);
      Object.assign(record,{state:taskStatus(result),result,elapsedMs:Date.now()-Date.parse(startedAt)});
      if (ownsSubmission) await writeRun(o.projectDir,runKey,record); else if (prior?.runPath) await refreshRun(prior.runPath,result);
      await output({...result,pricing,recordPath,idempotencyKey:o.idempotencyKey},c);
    } catch(error) { record.state='interrupted';record.error=String((error as Error).message);if (ownsSubmission) await writeRun(o.projectDir,runKey,record).catch(()=>{});throw error; }
      return;
    } catch (error) {
      lastError = error;
      if (!o.task || index === attempts.length - 1 || !canFallback(error)) throw error;
    }
    }
    throw lastError;
  });
}

async function watchTask(api: EasyAiApi, id: string, interval: number, cmd: Command) {
  if (!Number.isFinite(interval) || interval < 250) throw new CliError("Poll interval must be at least 250ms.", ExitCode.Usage);
  const deadline = Date.now() + 30 * 60_000;
  let cursor = "";
  while (Date.now() < deadline) {
    const task = await readGeneration(api, id); const status = taskStatus(task);
    const terminal = ["completed", "succeeded", "success", "failed", "error", "cancelled", "canceled"].includes(status);
    if (globals(cmd).jsonl) await output(terminal ? await usageResult(api, { taskId: id, status, task }) : { taskId: id, status, cursor }, cmd);
    if (terminal) { if (!globals(cmd).jsonl) await output(await usageResult(api, task), cmd); return; }
    await new Promise(r => setTimeout(r, Math.max(250, interval)));
  }
  throw new CliError(`Watch deadline reached; resume status/watch for task ${id}. No new task was submitted.`, ExitCode.Service);
}

async function completeGeneration(api: EasyAiApi, submitted: unknown, kind: "image" | "video", directory: string): Promise<unknown> {
  const id = findTaskId(submitted);
  let task: any = submitted;
  let status = taskStatus(task);
  let urls = findUrls(task);
  const terminal = () => ["completed", "succeeded", "success", "failed", "error", "cancelled", "canceled"].includes(status);
  const successful = () => ["completed", "succeeded", "success"].includes(status);
  if (id && (!terminal() || (successful() && !urls.length))) {
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      task = await readGeneration(api, id); status = taskStatus(task); urls = findUrls(task);
      if (terminal() && (!successful() || urls.length)) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!terminal() || (successful() && !urls.length)) throw new CliError(`Task ${id} did not expose a downloadable ${kind} within 30 minutes. Resume status/download for this same task; do not submit again.`, ExitCode.Service);
  }
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return { taskId: id, status, paths: [], task };
  if (!urls.length) throw new CliError(`Task ${id || "response"} reported ${status || "success"} but returned no downloadable ${kind} URL. Query this task again; do not resubmit.`, ExitCode.Service);
  const target = resolve(directory, id || `${kind}-${Date.now()}`);
  return { taskId: id, status: status === "unknown" ? "completed" : status, paths: await downloadUrls(urls, target), task };
}

const seedance = program.command("seedance").description("Validate and approve Seedance manifests without submitting paid tasks");
seedance.command("payload").argument("<manifest>").requiredOption("--file <path>").action(async (p, o, c) => { const m = await readManifest(resolve(p)); await validateManifest(m, true); const path = resolve(o.file); await writeFile(path, JSON.stringify(seedancePayload(m), null, 2), { mode: 0o600 }); await output({ path }, c); });
seedance.command("validate").argument("<manifest>").option("--verify-remote").option("--for-approval", "require completed storyboard visual QC").action(async (p, o, c) => { const m = await readManifest(resolve(p)); await validateManifest(m, o.verifyRemote); if (o.forApproval) validateStoryboardQc(m); await output({ valid: true, approvalReady: Boolean(o.forApproval), state: m.state, creativeHash: creativeHash(m), referenceCount: m.references.length, storyboardQc: m.storyboardQc, watermark: m.watermark }, c); });
seedance.command("approve").argument("<manifest>").requiredOption("--confirmation <text>").action(async (p, o, c) => output(await approveManifest(resolve(p), o.confirmation), c));
seedance.command("upload-references").argument("<manifest>").action(async (p, _o, c) => output(await uploadReferences(resolve(p)), c));
seedance.command("finalize").argument("<manifest>").requiredOption("--dir <path>").description("Download the submitted task and create ledger and QC artifacts").action(async (p, o, c) => {
  const manifestPath = resolve(p); const manifest = await readManifest(manifestPath);
  if (!manifest.taskId) throw new CliError("Manifest has no submitted task ID.", ExitCode.Approval);
  const task = await (await apiFor(c)).get<any>(`/v1/tasks/${enc(manifest.taskId)}`); const status = String(task.status || task.data?.status || "unknown").toLowerCase();
  const outDir = resolve(o.dir); await mkdir(outDir, { recursive: true }); let paths: string[] = []; const qc: Record<string, unknown> = { status: "not-run", manualReviewRequired: true };
  if (["completed", "succeeded", "success"].includes(status)) {
    paths = await downloadUrls(findUrls(task), outDir); const videoPath = paths.find(x => /\.(mp4|mov|webm)$/i.test(x));
    if (videoPath) {
      const contact = resolve(outDir, "contact-sheet.jpg"), tail = resolve(outDir, "final-frame.png"), corner = resolve(outDir, "bottom-right-sample.png");
      const madeContact = await runFfmpeg(["-y", "-i", videoPath, "-vf", "fps=1,scale=480:-1,tile=4x3", contact]);
      const madeTail = await runFfmpeg(["-y", "-sseof", "-0.1", "-i", videoPath, "-frames:v", "1", tail]);
      const madeCorner = await runFfmpeg(["-y", "-i", videoPath, "-vf", "fps=1,crop=iw/3:ih/3:iw*2/3:ih*2/3,scale=320:-1,tile=4x3", "-frames:v", "1", corner]);
      Object.assign(qc, { status: madeContact && madeTail && madeCorner ? "artifacts-ready" : "ffmpeg-unavailable", contactSheet: madeContact ? contact : null, finalFrame: madeTail ? tail : null, bottomRightSample: madeCorner ? corner : null });
    }
    manifest.state = "completed";
  } else if (["failed", "cancelled", "canceled"].includes(status)) manifest.state = "failed";
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const ledger = { schemaVersion: "easyai.seedance-ledger/v1", taskId: manifest.taskId, status, model: manifest.model, duration: manifest.duration, aspectRatio: manifest.aspectRatio, resolution: manifest.resolution, audio: manifest.audio, watermark: false, mode: manifest.mode, lastFrameRequested: manifest.lastFrameRequested, referenceCounts: manifest.referenceCounts, references: manifest.references.map(r => ({ type: r.type, role: r.role, localPath: r.localPath, objectKey: r.objectKey, sha256: r.sha256 })), prompt: manifest.prompt, manifestPath, paths, qc, recordedAt: new Date().toISOString() };
  const ledgerPath = resolve(outDir, "task-ledger.json"); await writeFile(ledgerPath, JSON.stringify({ ...ledger }, null, 2) + "\n", "utf8"); await output({ taskId: manifest.taskId, status, paths, ledgerPath, qc }, c);
});

function openExternal(url: string) { const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open"; const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]; spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true }).unref(); }
async function readStdin(): Promise<string> { const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks).toString("utf8").trim(); }
let directApiKeyPromise: Promise<string> | undefined;
function readStdinApiKey(): Promise<string> { return directApiKeyPromise ||= readStdin(); }
async function outputApiKeyOnce(value: unknown, cmd: Command): Promise<void> { const options = globals(cmd); if (options.output) throw new CliError("--output is disabled for API key creation because the plaintext is shown only once.", ExitCode.Usage); process.stderr.write("The account-level API key is shown once. Store it in an OS credential manager and revoke it immediately if exposed.\n"); process.stdout.write(JSON.stringify(options.json ? { schemaVersion: "easyai.cli/v1", data: value } : value, null, 2) + "\n"); }
function findTaskId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, any>; const id = row.taskId || row.task_id || row.id;
  if (typeof id === "string") return id;
  for (const key of ["data", "result", "task"]) { const nested = findTaskId(row[key]); if (nested) return nested; }
}
async function hiddenKey(): Promise<string> {
  if (!process.stdin.isTTY) throw new CliError("--prompt requires a local interactive terminal.", ExitCode.Usage);
  process.stderr.write("Account API Key (hidden): ");
  return new Promise((done, reject) => {
    let value = ""; process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener("data", listener); process.stderr.write("\n"); };
    const listener = (chunk: string) => { for (const ch of chunk) {
      if (ch === "\u0003") { finish(); reject(new CliError("Input cancelled", ExitCode.Auth)); return; }
      if (ch === "\r" || ch === "\n") { finish(); done(value.trim()); return; }
      if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1); else if (ch >= " ") value += ch;
    } }; process.stdin.on("data", listener);
  });
}
async function runFfmpeg(args: string[]): Promise<boolean> { return new Promise(resolveResult => { const child = spawn("ffmpeg", args, { stdio: "ignore", windowsHide: true }); child.on("error", () => resolveResult(false)); child.on("exit", code => resolveResult(code === 0)); }); }

program.command("capabilities").description("Offline routing table, commands, and schemas. Example: wowidea capabilities --json").action(async (_o, c) => output(capabilitiesDocument(), c));

async function describeTask(task: string, fast: boolean, cmd: Command) {
  let catalog: unknown;
  try { catalog = (await loadModelCatalog(await apiFor(cmd))).catalog; } catch { catalog = undefined; }
  const resolved = resolveTask(task, { fast, catalog });
  const generate = resolved.media === "video" ? "video" : resolved.media === "speech" ? "speech" : resolved.media === "music" ? "music" : resolved.media === "3d" ? "mesh" : "image";
  return {
    task: resolved.task, label: resolved.label, media: resolved.media, model: resolved.model, chain: resolved.chain,
    finalizeOnly: resolved.finalizeOnly, source: resolved.source, endpoint: endpointFor(resolved.media),
    command: resolved.command || `wowidea ${generate} generate --task ${resolved.task} --prompt "..." --json --direct`,
    message: resolved.message,
    entries: resolved.entries.map(entry => ({ alias: entry.alias, display: entry.display, requestModel: entry.requestModel, quality: entry.quality, speed: entry.speed, fallback: entry.fallback, draft: Boolean(entry.draft), finalizeOnly: Boolean(entry.finalizeOnly) })),
  };
}
models.option("--by-task <task>", "same as: models by-task <task>").option("--fast", "with --by-task, prefer the fast model");
models.command("by-task").description("Resolve a task to a model and fallback chain. Example: wowidea models by-task direction --json").argument("<task>").option("--fast", "prefer the fast model").action(async (task: string, o, c) => output(await describeTask(task, Boolean(o.fast), c), c));
models.action(async (o, c) => {
  if (!o.byTask) throw new CliError("Use models list, models show <id>, models by-task <task>, or models --by-task <task>.", ExitCode.Usage);
  await output(await describeTask(String(o.byTask), Boolean(o.fast), c), c);
});

const batch = program.command("batch").description("Concurrent resumable jobs. Never submits a final video.");
batch.command("run").description("Run a JSON, CSV, or simple YAML manifest. Example: wowidea batch run --manifest jobs.json --concurrency 6 --json").requiredOption("--manifest <file>", "jobs file").option("--concurrency <n>", "global in-flight limit", "6").option("--per-model <n>", "in-flight limit per model", "2").option("--out <dir>", "download directory", "wowidea-output/batch").option("--state <file>", "resume file").action(async (o, c) => {
  const api = await apiFor(c);
  const jobs = parseManifest(await readFile(resolve(o.manifest), "utf8"), o.manifest);
  const client: BatchClient = {
    async submit(job) {
      let payload: Record<string, unknown> = { prompt: job.prompt, model: job.model, ...(job.params || {}) };
      if (job.input && job.kind === "image") payload.image = [job.input];
      if (job.kind === "video") payload = prepareVideoPayload(applyDraftContract(payload, job.model));
      const response = await api.post(job.endpoint, payload, { "Idempotency-Key": job.idempotencyKey, "x-async": "true" });
      return { taskId: findTaskId(response), status: taskStatus(response), urls: findUrls(response) };
    },
    async poll(taskId) { const task = await readGeneration(api, taskId); return { status: taskStatus(task), urls: findUrls(task) }; },
    download: (urls, directory) => downloadUrls(urls, directory),
  };
  const result = await runBatch({ jobs, outDir: o.out, statePath: o.state, concurrency: Number(o.concurrency), perModel: Number(o.perModel), client, onProgress: event => { if (!globals(c).json && !globals(c).jsonl) process.stderr.write(`${event.id || ""} ${event.status || ""}\n`); } });
  await output(result, c);
  if (!result.ok) process.exitCode = ExitCode.Service;
});

program.command("layers").description("Transparent PNG layers. Example: wowidea layers --layer subject --from ./green.png --out ./layers --json").option("--layer <name>", "layer name; repeat for more", (value: string, prior: string[]) => [...prior, value], [] as string[]).option("--scene <text>", "shared scene description", "").option("--out <dir>", "output directory", "wowidea-output/layers").option("--key <color>", "auto or #RRGGBB", "auto").option("--from <image>", "key this image instead of generating").option("--task <task>", "routing task when generating", "layering").action(async (o, c) => {
  const names = o.layer as string[];
  if (!names.length) throw new CliError("Pass at least one --layer.", ExitCode.Usage);
  const generate = o.from
    ? async () => readFile(resolve(o.from))
    : async (request: { name: string; prompt: string }) => {
      const api = await apiFor(c);
      const routed = resolveTask(String(o.task), { catalog: (await loadModelCatalog(api)).catalog });
      if (routed.finalizeOnly) throw new CliError(routed.message || "Refusing to generate a final video as a layer.", ExitCode.Usage);
      const submitted = await submitDirect(api, endpointFor(routed.media), { model: routed.model, prompt: request.prompt, n: 1 }, { idempotencyKey: `layer-${payloadHash(request)}` });
      const completed = await completeGeneration(api, submitted, "image", o.out);
      const path = (completed as { paths?: string[] }).paths?.[0];
      if (!path) throw new CliError(`Layer ${request.name} returned no image.`, ExitCode.Service);
      return readFile(path);
    };
  const rendered = await renderLayers({ layers: names.map(name => ({ name })), scene: o.scene, outDir: resolve(o.out), key: o.key, generate });
  await output({ layers: rendered.layers.map(({ key, ...layer }) => ({ ...layer, keyColor: key })) }, c);
});

program.command("key").description("Cut a flat-color background to a transparent PNG. Example: wowidea key ./subject.png --out ./cutout.png --json").argument("<image>").option("--out <png>", "output PNG").option("--key <color>", "auto or #RRGGBB", "auto").action(async (image: string, o, c) => {
  const keyed = await keyImage(await readFile(resolve(image)), { key: o.key });
  const path = resolve(o.out || image.replace(/\.\w+$/, "") + ".cutout.png");
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, keyed.png);
  await output({ path, keyColor: keyed.key, method: keyed.method, width: keyed.width, height: keyed.height }, c);
});

program.exitOverride();
program.parseAsync().catch(async error => {
  if (error?.code === "commander.helpDisplayed" || error?.code === "commander.version") { process.exitCode = ExitCode.Success; return; }
  const cliError = error instanceof CliError ? error : error?.code?.startsWith("commander.") ? new CliError(error.message, ExitCode.Usage) : new CliError(error instanceof Error ? error.message : String(error), ExitCode.Service);
  process.stderr.write(JSON.stringify(redact({ error: cliError.message, code: cliError.exitCode, details: cliError.details })) + "\n"); process.exitCode = cliError.exitCode;
});
