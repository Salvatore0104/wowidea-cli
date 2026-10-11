import { runCli, type CanvasApiClient, type OutputWriter } from "@easyaigc/canvas-cli";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { downloadUrls, findUrls, type EasyAiApi } from "./api.js";
import { canvasClient, SecureCanvasAuthStore } from "./canvas-auth.js";
import { canvasProjectUrl, readCanvasBinding, verifyCanvasBinding } from "./canvas-binding.js";
import { creativeDefaults } from "./config.js";
import { CliError, ExitCode } from "./errors.js";
import { routeModel, validateCapabilities } from "./models.js";
import { platformEstimate } from "./pricing.js";
import { normalizeRequest } from "./request-normalization.js";
import { payloadHash } from "./preflight.js";
import { writeJson } from "./storage.js";
import { prepareVideoPayload } from "./video-payload.js";
import { usageResult } from "./usage.js";
import { applyDraftContract, isFinalizeModel } from "./task-router.js";

type MediaKind = "image" | "video";
type Json = Record<string, any>;

function nodes(state: any): any[] { return Array.isArray(state?.design?.nodes) ? state.design.nodes : []; }
function taskId(value: any): string | undefined {
  const id = value?.taskId || value?.task_id || value?.id || value?.data?.taskId;
  return typeof id === "string" ? id : undefined;
}
function status(value: any): string { return String(value?.status || value?.taskStatus || value?.data?.status || "unknown").toLowerCase(); }
function terminal(value: any): boolean { return ["success", "succeeded", "completed", "failed", "error", "cancelled", "canceled"].includes(status(value)); }
function success(value: any): boolean { return ["success", "succeeded", "completed"].includes(status(value)); }
function mediaTaskId(value: any): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.mediaTaskId === "string") return value.mediaTaskId;
  for (const nested of Array.isArray(value) ? value : Object.values(value)) { const found = mediaTaskId(nested); if (found) return found; }
}
function taskRows(value: any): any[] {
  if (Array.isArray(value)) return value;
  for (const key of ["items", "tasks", "results", "data"]) {
    if (Array.isArray(value?.[key])) return value[key];
    if (value?.[key] && typeof value[key] === "object") { const nested = taskRows(value[key]); if (nested.length) return nested; }
  }
  return [];
}

async function canvasCommand(args: string[], store: SecureCanvasAuthStore): Promise<unknown[]> {
  const values: unknown[] = [], errors: unknown[] = [];
  const output: OutputWriter = { json: value => values.push(value), ndjson: value => values.push(value), error: value => errors.push(value), text: value => values.push(value) };
  const code = await runCli({ argv: [...args, "--base-url", "https://wowidea.top/api"], output, store });
  if (code !== 0) throw new CliError(`Canvas command failed: ${JSON.stringify(errors[0] || values.at(-1) || { code })}`, code === 3 ? ExitCode.Service : ExitCode.Usage);
  return values;
}

async function withJsonFile<T>(value: unknown, action: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "wowidea-canvas-"));
  const path = join(directory, "input.json");
  try { await writeFile(path, JSON.stringify(value), { encoding: "utf8", mode: 0o600 }); return await action(path); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function newNodeId(before: any, after: any, kind: string): string {
  const prior = new Set(nodes(before).map(node => String(node.id)));
  const created = nodes(after).filter(node => node.type === kind && !prior.has(String(node.id)));
  if (created.length !== 1) throw new CliError(`Canvas mutation did not identify exactly one new ${kind} node.`, ExitCode.Conflict);
  return String(created[0].id);
}

async function addNode(client: CanvasApiClient, store: SecureCanvasAuthStore, profile: string, projectId: string, kind: string, data: Json = {}, bindings: Array<{ slotId: string; sourceNodeId: string; sourcePortId?: string }> = []): Promise<string> {
  const before = await client.request("GET", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/state`);
  await withJsonFile(data, path => canvasCommand(["node", "add", projectId, "--kind", kind, "--file", path, "--profile", profile, ...bindings.flatMap(binding => ["--bind", `${binding.slotId}=${binding.sourceNodeId}:${binding.sourcePortId || "out"}`])], store));
  const after = await client.request("GET", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/state`);
  return newNodeId(before, after, kind);
}

function referenceKind(pathOrUrl: string, declared: "image" | "video" | "audio"): string { return `media.${declared}`; }
function referenceData(url: string, type: "image" | "video" | "audio"): Json {
  const common = { title: basename(new URL(url).pathname) || `${type} reference`, sourceUrl: url, mode: "reference", source: "reference", pathCommitted: "reference" };
  if (type === "image") return { ...common, referenceImageUrls: [url], imageResultUrls: [url], selectedImageUrls: [url] };
  if (type === "video") return { ...common, referenceVideoUrls: [url], videoResultUrls: [url], selectedVideoUrls: [url] };
  return { ...common, referenceAudioUrls: [url] };
}

async function addReference(client: CanvasApiClient, store: SecureCanvasAuthStore, profile: string, projectId: string, source: string, type: "image" | "video" | "audio"): Promise<string> {
  const local = !/^https?:\/\//i.test(source);
  if (local) {
    const path = resolve(source); await access(path);
    const nodeId = await addNode(client, store, profile, projectId, referenceKind(source, type));
    await canvasCommand(["node", "upload", projectId, nodeId, "--file", path, "--profile", profile], store);
    return nodeId;
  }
  return addNode(client, store, profile, projectId, referenceKind(source, type), referenceData(source, type));
}

function referenceSlot(definition: any, type: "image" | "video" | "audio", kind: MediaKind, action: string, mode?: string): string {
  const slots = Array.isArray(definition?.referenceProtocol?.inputSlots) ? definition.referenceProtocol.inputSlots : [];
  const wanted = type === "image" && kind === "video" && mode === "first_last_frame" ? "first_frame" : type === "image" ? "ref_images" : type === "video" ? "ref_video" : "ref_audio";
  const found = slots.find((slot: any) => slot.slotId === wanted && slot.acceptType === type);
  if (!found) throw new CliError(`Live ${definition?.kind || kind} protocol does not expose required ${type} slot ${wanted}.`, ExitCode.Usage);
  if (action === "edit" && type === "image" && kind === "image" && found.slotId !== "ref_images") throw new CliError("Live Canvas protocol does not support non-destructive image editing.", ExitCode.Usage);
  return found.slotId;
}

export function canvasParameters(payload: Json, kind: MediaKind): Json {
  const result: Json = { prompt: payload.prompt, model: payload.model };
  if (payload.aspect_ratio !== undefined) result.aspectRatio = payload.aspect_ratio;
  if (kind === "image") {
    if (payload.resolution !== undefined) result.size = payload.resolution;
    result.count = payload.n || payload.count || 1;
    const extras = { ...payload }; for (const key of ["prompt", "model", "aspect_ratio", "resolution", "n", "count", "image_urls", "video_urls", "audio_urls", "image"]) delete extras[key];
    if (payload.aspect_ratio !== undefined) extras.aspect_ratio = payload.aspect_ratio;
    if (payload.resolution !== undefined) extras.resolution = payload.resolution;
    if (Object.keys(extras).length) result.imageGenParams = extras;
  } else {
    if (payload.resolution !== undefined) result.resolution = payload.resolution;
    if (payload.duration !== undefined) result.duration = payload.duration;
    result.videoGenerateMode = payload.mode;
    const extras = { ...payload }; for (const key of ["prompt", "model", "aspect_ratio", "resolution", "duration", "mode", "image_urls", "video_urls", "audio_urls", "content"]) delete extras[key];
    if (Object.keys(extras).length) result.videoGenParams = extras;
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

export function canvasOutputSpec(node: any, expectedAspectRatio?: string): Json | undefined {
  if (!expectedAspectRatio) return undefined;
  const [expectedWidth, expectedHeight] = expectedAspectRatio.split(":").map(Number);
  const expected = expectedWidth && expectedHeight ? expectedWidth / expectedHeight : undefined;
  const sizes = Array.isArray(node?.data?.imageResultSizes) ? node.data.imageResultSizes.filter((item: any) => Number(item?.width) > 0 && Number(item?.height) > 0) : [];
  if (!expected || !sizes.length) return { status: "unavailable", expectedAspectRatio, sizes };
  const checked = sizes.map((item: any) => ({ width: Number(item.width), height: Number(item.height), actualAspectRatio: Number(item.width) / Number(item.height), matches: Math.abs(Number(item.width) / Number(item.height) - expected) / expected <= 0.02 }));
  return { status: checked.every((item: any) => item.matches) ? "matched" : "mismatch", expectedAspectRatio, sizes: checked };
}

function optionValues(value: any): string[] {
  const rows = Array.isArray(value) ? value : value?.options || value?.items || value?.data || [];
  return Array.isArray(rows) ? rows.flatMap((row: any) => typeof row === "string" ? [row] : [row?.value, row?.id, row?.name].filter((x): x is string => typeof x === "string")) : [];
}

async function waitTask(client: CanvasApiClient, projectId: string, id: string): Promise<any> {
  const path = `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(id)}`;
  const deadline = Date.now() + 30 * 60_000; let cursor = 0; let task: any;
  while (Date.now() < deadline) {
    const replay = await client.request<any>("GET", `${path}/events?after=${cursor}`);
    cursor = Math.max(cursor, Number(replay?.nextCursor || cursor));
    task = await client.request("GET", path);
    if (replay?.terminal === true || terminal(task)) return task;
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new CliError(`Canvas task ${id} timed out. Resume this same task with easyai-canvas run status/events; no new execution was submitted.`, ExitCode.Service);
}

async function finishTask(client: CanvasApiClient, api: EasyAiApi, projectId: string, nodeId: string, id: string, outputDir: string, wait: boolean, expectedAspectRatio?: string): Promise<Json> {
  const canvasUrl = canvasProjectUrl(projectId);
  const task = wait ? await waitTask(client, projectId, id) : await client.request<any>("GET", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(id)}`);
  if (!wait) return { projectId, nodeId, taskId: id, canvasUrl, status: status(task), paths: [], task };
  const latest = await client.request<any>("GET", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/state`);
  const node = nodes(latest).find(row => String(row.id) === nodeId);
  const urls = [...new Set([...findUrls(task), ...findUrls(node)])];
  const paths = success(task) && urls.length ? await downloadUrls(urls, resolve(outputDir, id)) : [];
  const innerId = mediaTaskId(task) || mediaTaskId(node);
  const mediaTask = innerId ? await api.get<any>(`/v1/tasks/${encodeURIComponent(innerId)}`).catch(() => undefined) : undefined;
  const accounted = await usageResult(api, mediaTask || task);
  return { projectId, nodeId, taskId: id, canvasUrl, mediaTaskId: innerId, status: status(task), paths, pointsUsage: accounted.pointsUsage, outputSpec: canvasOutputSpec(node, expectedAspectRatio), task, ...(mediaTask ? { mediaTask } : {}) };
}

export async function generateOnCanvas(input: { api: EasyAiApi; kind: MediaKind; action: "generate" | "edit"; payload: Json; projectDir: string; outputDir: string; profile?: string; wait: boolean; requestKey?: string }): Promise<Json> {
  const binding = await readCanvasBinding(input.projectDir);
  await verifyCanvasBinding(input.projectDir, input.profile || binding.profile);
  const profile = input.profile || binding.profile;
  const { client, store } = await canvasClient(profile);
  const projectId = binding.projectId, nodeKind = `media.${input.kind}`;
  const definition = await client.request<any>("GET", `/v1/canvas-workflow/node-types/${nodeKind}`);
  const catalog = await input.api.get("/v1/models");
  let payload = normalizeRequest({ ...input.payload }, input.kind);
  const selected = routeModel(catalog, input.kind, payload.model ? String(payload.model) : (await creativeDefaults())[input.kind]);
  payload.model = selected.model;
  if (isFinalizeModel(selected.id) || isFinalizeModel(String(input.payload.model || ""))) throw new CliError("Seedance 2.5 成片不能重新提交提示词。运行 wowidea video finalize <draftId> --yes", ExitCode.Usage);
  if (input.kind === "video") { payload.mode ??= payload.video_urls?.length ? "video_edit" : payload.image_urls?.length ? "image_reference" : payload.audio_urls?.length ? "audio_reference" : "text_to_video"; payload.watermark = false; payload = applyDraftContract(payload, selected.id); payload = prepareVideoPayload(payload); }
  validateCapabilities(selected, payload);
  if (input.action === "edit" && input.kind === "image" && !(payload.image_urls?.length || payload.image?.length)) throw new CliError("Image editing requires at least one source image.", ExitCode.Usage);
  if (input.action === "edit" && input.kind === "video" && !payload.video_urls?.length) throw new CliError("Video editing requires at least one source video.", ExitCode.Usage);

  const requestKey = input.requestKey || `canvas-${payloadHash({ projectId, kind: input.kind, action: input.action, payload })}`;
  const recordDirectory = join(resolve(input.projectDir), ".wowidea", "canvas-runs");
  const recordPath = join(recordDirectory, `${payloadHash(requestKey)}.json`);
  await mkdir(recordDirectory, { recursive: true });
  const existing = await readFile(recordPath, "utf8").then(JSON.parse).catch(() => undefined);
  if (existing) {
    if (existing.requestHash !== payloadHash({ projectId, kind: input.kind, action: input.action, payload })) throw new CliError("Canvas request key already belongs to a different request.", ExitCode.Conflict);
    if (!existing.taskId && existing.requestId) {
      const listed = await client.request<any>("GET", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/tasks?clientRequestId=${encodeURIComponent(existing.requestId)}`).catch(() => undefined);
      const exact = taskRows(listed).filter(row => row?.clientRequestId === existing.requestId && taskId(row));
      if (exact.length === 1) { existing.taskId = taskId(exact[0]); await writeJson(recordPath, { ...existing, state: "recovered", updatedAt: new Date().toISOString() }); }
    }
    if (!existing.taskId || !existing.nodeId) throw new CliError(`Canvas request ${requestKey} has no confirmed task ID. Inspect request ${existing.requestId || "unknown"}; no new paid execution was submitted.`, ExitCode.Service);
    const resumed = await finishTask(client, input.api, projectId, existing.nodeId, existing.taskId, input.outputDir, input.wait, input.kind === "image" ? payload.aspect_ratio : undefined);
    await writeJson(recordPath, { ...existing, state: resumed.status, result: resumed, updatedAt: new Date().toISOString() });
    return { ...resumed, requestId: existing.requestId, requestKey, recordPath, resumed: true };
  }
  const requestHash = payloadHash({ projectId, kind: input.kind, action: input.action, payload });
  if (!await writeJson(recordPath, { schemaVersion: "wowidea.canvas-run/v1", requestKey, requestHash, projectId, kind: input.kind, action: input.action, state: "preparing", createdAt: new Date().toISOString() }, true)) throw new CliError(`Canvas request ${requestKey} is already being prepared. No duplicate was created.`, ExitCode.Conflict);

  const references: Array<{ source: string; type: "image" | "video" | "audio" }> = [];
  for (const source of payload.image_urls || payload.image || []) references.push({ source, type: "image" });
  for (const source of payload.video_urls || []) references.push({ source, type: "video" });
  for (const source of payload.audio_urls || []) references.push({ source, type: "audio" });
  const bindings: Array<{ slotId: string; sourceNodeId: string }> = [];
  for (const reference of references) bindings.push({ slotId: referenceSlot(definition, reference.type, input.kind, input.action, payload.mode), sourceNodeId: await addReference(client, store, profile, projectId, reference.source, reference.type) });

  const parameters = canvasParameters(payload, input.kind);
  const writable = new Set(definition?.parameters?.writablePaths || []);
  for (const key of Object.keys(parameters)) if (!writable.has(`/${key}`)) throw new CliError(`Live ${nodeKind} definition does not allow /${key}.`, ExitCode.Usage);
  const nodeId = await addNode(client, store, profile, projectId, nodeKind, {}, bindings);
  await writeJson(recordPath, { schemaVersion: "wowidea.canvas-run/v1", requestKey, requestHash, projectId, nodeId, sourceNodeIds: bindings.map(binding => binding.sourceNodeId), kind: input.kind, action: input.action, state: "configured", createdAt: new Date().toISOString() });
  const options = await client.request<any>("POST", `/v1/canvas-workflow/node-types/${nodeKind}/options`, { projectId, field: "/model", nodeData: {} });
  const available = optionValues(options);
  if (available.length && !available.includes(selected.model)) throw new CliError(`Model ${selected.model} is not available in the live Canvas node options.`, ExitCode.Usage);
  await withJsonFile({ parameters, bindings }, path => canvasCommand(["node", "configure", projectId, nodeId, "--file", path, "--profile", profile], store));
  let inputs = await client.request<any>("GET", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/inputs`);
  const tokens: string[] = [...new Set<string>((Array.isArray(inputs?.references) ? inputs.references : []).map((reference: any) => reference?.token).filter((token: unknown): token is string => typeof token === "string" && /^<<<[^>]+>>>$/.test(token)))];
  if (tokens.some(token => !String(parameters.prompt || "").includes(token))) {
    parameters.prompt = `${parameters.prompt || ""}${parameters.prompt ? "\n" : ""}${tokens.join(" ")}`;
    await withJsonFile({ parameters, bindings }, path => canvasCommand(["node", "configure", projectId, nodeId, "--file", path, "--profile", profile], store));
    inputs = await client.request("GET", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/nodes/${encodeURIComponent(nodeId)}/inputs`);
  }
  if (inputs?.valid === false || inputs?.ready === false || (Array.isArray(inputs?.errors) && inputs.errors.length)) throw new CliError(`Canvas node inputs are invalid: ${JSON.stringify(inputs?.errors || inputs)}`, ExitCode.Usage);

  const requestId = randomUUID();
  const state = await client.request<any>("GET", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/state`);
  await writeJson(recordPath, { schemaVersion: "wowidea.canvas-run/v1", requestKey, requestHash, projectId, nodeId, sourceNodeIds: bindings.map(binding => binding.sourceNodeId), kind: input.kind, action: input.action, requestId, state: "submitting", createdAt: new Date().toISOString() });
  const submitted = await client.request<any>("POST", `/v1/canvas-workflow/projects/${encodeURIComponent(projectId)}/executions`, { clientRequestId: requestId, baseVersion: Number(state?.design?.version || 0), agent: { name: (await store.get(profile))?.agentName, instanceId: (await store.get(profile))?.agentInstance }, target: { type: "node", id: nodeId }, policy: { failFast: true } });
  const id = taskId(submitted);
  if (!id) throw new CliError("Canvas execution returned no task ID. Do not submit again; inspect the request ID.", ExitCode.Service);
  await writeJson(recordPath, { schemaVersion: "wowidea.canvas-run/v1", requestKey, requestHash, projectId, nodeId, sourceNodeIds: bindings.map(binding => binding.sourceNodeId), kind: input.kind, action: input.action, requestId, taskId: id, state: "submitted", createdAt: new Date().toISOString() });
  const result = await finishTask(client, input.api, projectId, nodeId, id, input.outputDir, input.wait, input.kind === "image" ? payload.aspect_ratio : undefined);
  const pricing = await platformEstimate(input.api, payload);
  await writeJson(recordPath, { schemaVersion: "wowidea.canvas-run/v1", requestKey, requestHash, projectId, nodeId, sourceNodeIds: bindings.map(binding => binding.sourceNodeId), kind: input.kind, action: input.action, requestId, taskId: id, state: result.status, result, pricing, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return { ...result, requestId, requestKey, recordPath, pricing, inputs };
}
