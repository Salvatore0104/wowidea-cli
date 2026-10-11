import { CliError, ExitCode } from "./errors.js";
import { readDataFile } from "./load-data.js";
import { findModel } from "./models.js";

export interface ModelCard {
  alias: string;
  display: string;
  upstream: string;
  purposes: string[];
  quality: "draft" | "standard" | "high" | "final";
  speed: "fast" | "medium" | "slow";
  reliability: string;
  fallback: string[];
  nativeTransparency: boolean;
  draft?: boolean;
  finalizeOnly?: boolean;
}

export interface TaskSpec {
  label: string;
  media: "image" | "video" | "3d" | "music" | "speech";
  models: string[];
  finalizeOnly?: boolean;
}

export interface RoutingTable {
  schemaVersion: string;
  defaults: { image: string; video: string; videoFinal: string };
  tasks: Record<string, TaskSpec>;
  aliases: Record<string, string>;
  models: Record<string, Omit<ModelCard, "alias">>;
}

export interface ResolvedTask {
  task: string;
  label: string;
  media: TaskSpec["media"];
  model: string;
  chain: string[];
  finalizeOnly: boolean;
  message?: string;
  command?: string;
  source: "table" | "live" | "static-fallback";
  entries: ModelCard[];
}

let cached: RoutingTable | undefined;
export function routingTable(): RoutingTable {
  return cached ||= readDataFile<RoutingTable>("model-routing.json");
}

export function modelCard(alias: string): ModelCard | undefined {
  const row = routingTable().models[alias];
  return row ? { alias, ...row } : undefined;
}

export function listTasks(): Array<{ id: string; label: string; media: string; model: string; finalizeOnly: boolean }> {
  const table = routingTable();
  return Object.entries(table.tasks).map(([id, task]) => ({
    id, label: task.label, media: task.media, model: task.models[0] || "", finalizeOnly: Boolean(task.finalizeOnly),
  }));
}

function canonicalTask(task: string): string {
  const table = routingTable();
  const raw = task.trim();
  if (table.tasks[raw]) return raw;
  const alias = table.aliases[raw] || table.aliases[raw.toLowerCase()];
  if (alias && table.tasks[alias]) return alias;
  throw new CliError(`Unknown task "${task}". Known: ${Object.keys(table.tasks).join(", ")}.`, ExitCode.Usage);
}

function chainFor(alias: string, extras: string[] = []): string[] {
  const card = modelCard(alias);
  const names = [alias, ...(card?.fallback || []), ...extras];
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const name of names) {
    if (!name || seen.has(name) || modelCard(name)?.finalizeOnly) continue;
    seen.add(name);
    chain.push(name);
  }
  return chain;
}

export function isFinalizeModel(alias: string | undefined): boolean {
  if (!alias) return false;
  return Boolean(modelCard(alias)?.finalizeOnly) || /^seedance-2\.5-final$/i.test(alias.trim());
}

export function isDraftModel(alias: string | undefined): boolean {
  if (!alias) return false;
  return Boolean(modelCard(alias)?.draft) || /^seedance-2\.5-draft$/i.test(alias.trim());
}

export function applyDraftContract(payload: Record<string, unknown>, selectedId?: string): Record<string, unknown> {
  const names = [selectedId, payload.model].map(value => String(value || ""));
  if (names.some(name => isFinalizeModel(name))) throw new CliError("Seedance 2.5 成片不能重新提交提示词。运行 wowidea video finalize <draftId> --yes", ExitCode.Usage);
  if (!names.some(name => isDraftModel(name))) return payload;
  const resolution = String(payload.resolution || "720p");
  if (!["480p", "720p"].includes(resolution)) throw new CliError("Seedance 2.5 样片使用 480p 或 720p。成片请运行 wowidea video finalize <draftId> --yes", ExitCode.Usage);
  return { ...payload, draft: true, resolution, watermark: payload.watermark ?? false };
}

export function canFallback(error: unknown): boolean {
  if (!(error instanceof CliError)) return false;
  if (/uncertain|already exists|Idempotency|duplicate|did not expose/i.test(error.message)) return false;
  return /unavailable|Unsupported|not supported|no verified|No model satisfies|Required capability/i.test(error.message);
}

export function resolveTask(task: string, options: { fast?: boolean; stage?: string; catalog?: unknown } = {}): ResolvedTask {
  const id = canonicalTask(task);
  const table = routingTable();
  const spec = table.tasks[id]!;
  if (spec.finalizeOnly || (spec.media === "video" && options.stage === "final")) {
    const model = table.defaults.videoFinal;
    return {
      task: "video-final", label: table.tasks["video-final"]!.label, media: "video", model, chain: [],
      finalizeOnly: true, source: "table", entries: [modelCard(model)!].filter(Boolean),
      message: "成片不会重新提交提示词。先生成样片，再运行 wowidea video finalize <draftId> --yes。",
      command: "wowidea video finalize <draftId> --yes",
    };
  }
  let primary = spec.models[0] || table.defaults.image;
  if (options.fast) {
    const fast = [primary, ...((modelCard(primary)?.fallback) || [])].find(name => modelCard(name)?.speed === "fast");
    if (fast) primary = fast;
  }
  let chain = chainFor(primary, spec.models);
  let source: ResolvedTask["source"] = "table";
  if (options.catalog) {
    const live = chain.filter(name => findModel(options.catalog, name));
    if (live.length) { chain = live; source = "live"; }
    else source = "static-fallback";
  }
  const model = chain[0] || primary;
  return {
    task: id, label: spec.label, media: spec.media, model, chain, finalizeOnly: false, source,
    entries: chain.map(alias => modelCard(alias)).filter((row): row is ModelCard => Boolean(row)),
  };
}

export function endpointFor(media: TaskSpec["media"]): string {
  if (media === "video") return "/v1/video/generations";
  if (media === "speech") return "/v1/speech/generations";
  if (media === "music") return "/music/generations";
  if (media === "3d") return "/v1/mesh3d/generate/text";
  return "/v1/images/generations";
}
