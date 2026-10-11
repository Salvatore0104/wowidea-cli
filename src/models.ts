import { CliError, ExitCode } from "./errors.js";
import { taskRows } from "./submission.js";
import { guideInfo } from "./guides.js";

export const registry = [
  ["Nano Banana 2", "image_nanoBanana2", "image", "nano-banana"],
  ["Nano Banana Pro", "image_nanoBanana_pro", "image", "nano-banana"],
  ["Nano Banana 2 Lite", "image_nanoBanana2Lite", "image", "nano-banana"],
  ["GPT Image 2", "gpt-image-2", "image", "gpt-image"],
  ["GPT Image 2.5", "gpt-image-2.5", "image", "gpt-image-25"],
  ["GPT Image 2.5 Sunburst", "gpt-image-2.5-sunburst", "image", "gpt-image-25"],
  ["GPT Image 2.5 Flare", "gpt-image-2.5-flare", "image", "gpt-image-25"],
  ["Midjourney v8.2", "mj-v8.2", "image", "midjourney"],
  ["Midjourney v8.2 Fast", "mj-v8.2-fast", "image", "midjourney"],
  ["MiniMax-H3", "MiniMax-H3", "video", "minimax-h3"],
  ["MiniMax-H3-Max", "MiniMax-H3-Max", "video", "minimax-h3"],
  ["Google Omni", "video_google_omni", "video", "google-omni"],
  ["Wan3.0-Video", "wan3.0-video", "video", "wan"],
  ["Wan3.0-Video-Prime", "wan3.0-video-prime", "video", "wan"],
  ["豆包Seedance-2.0", "doubao-seedance-2-0-260128", "video", "seedance-20"],
  ["豆包Seedance-2.0-fast", "doubao-seedance-2-0-fast-260128", "video", "seedance-20"],
  ["豆包Seedance-2.0-mini", "doubao-seedance-2-0-mini-260615", "video", "seedance-20"],
  ["豆包Seedance-2.5", "doubao-seedance-2-5-260628", "video", "seedance-25"],
  ["Seedance-2.5-Draft", "doubao-seedance-2-5-260628", "video", "seedance-25"],
  ["Seedance-2.5-Final", "doubao-seedance-2-5-260628", "video", "seedance-25"],
  ["Doubao-Seedream-5.0-flash", "doubao-seedream-5-0-flash-260915", "image", "workflow"],
  ["Seedream-5.0-Pro", "doubao-seedream-5-0-pro-260628", "image", "workflow"],
].map(([id, modelName, kind, guide]) => ({ id: id!, modelName: modelName!, kind: kind!, guide: `references/${guide}.md`, adapter: kind === "image" ? "platform-image" : "platform-video" }));
const norm = (s: string) => s.toLowerCase().replace(/[\s_.-]/g, "").replace(/^豆包/, "");
export function modelIdentifiers(row: any): string[] {
  return [row?.id, row?.model, row?.modelName, row?.name, row?.displayName, row?.display_name, row?.modelAlias, row?.model_alias]
    .filter((value): value is string => typeof value === "string");
}
export function modelTypes(row: any): string[] {
  const value = row?.modelType ?? row?.types;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
// The live catalog reports Midjourney as `mj-v8.2` while this CLI presents it as
// "Midjourney v8.2", so lookups resolve registry aliases before every raw field.
export function findModel(catalog: unknown, requested: string) {
  const rows = taskRows(catalog);
  const wanted = norm(requested);
  const entry = registry.find(r => [r.id, r.modelName].some(value => norm(value) === wanted));
  const direct = rows.find((row: any) => modelIdentifiers(row).some(value => norm(value) === wanted));
  if (direct || !entry) return direct as any | undefined;
  return rows.find((row: any) => modelIdentifiers(row).some(value => [entry.id, entry.modelName].some(alias => norm(alias) === norm(value)))) as any | undefined;
}
export function matchesModelType(row: any, type: string): boolean {
  const wanted = type.toLowerCase();
  const types = modelTypes(row).map(value => value.toLowerCase());
  // `image`/`video` answer the practical question "can this model produce that
  // media?", so analysis-only and text models stay out of the default listing.
  // Exact platform types such as image_analysis remain available verbatim.
  if (wanted === "image") return types.includes("image_generate") || types.includes("image_edit");
  if (wanted === "video") return types.some(value => value === "video_generate" || value === "image_to_video" || value === "omni_video");
  return types.includes(wanted);
}
export function registryEntry(row: any) {
  const values = modelIdentifiers(row).map(norm);
  return registry.find(entry => [entry.id, entry.modelName].some(value => values.includes(norm(value))));
}
export function routeModel(catalog: unknown, kind: string, requested?: string) {
  if (!["image", "video"].includes(kind)) throw new CliError("kind must be image or video", ExitCode.Usage);
  const name = requested || (kind === "image" ? "Nano Banana 2" : "Seedance-2.5-Draft");
  const aliases: Record<string, string> = { minimax: "MiniMax-H3", seedance: "Seedance-2.5-Draft", seedance25draft: "Seedance-2.5-Draft", seedance25final: "Seedance-2.5-Final", wan30: "Wan3.0-Video", wan30prime: "Wan3.0-Video-Prime", midjourney: "Midjourney v8.2", mj: "Midjourney v8.2", gptimage25: "GPT Image 2.5" };
  const alias = aliases[norm(name)] || name;
  let entry = registry.find(r => [r.id, r.modelName].some(v => norm(v) === norm(alias)));
  if (!entry) { const found = findModel(catalog, alias); if (found && matchesModelType(found, kind)) entry = { id: found.id || found.name || alias, modelName: found.modelName || found.name || alias, kind, guide: "references/workflow.md", adapter: `platform-${kind}` }; }
  if (!entry || entry.kind !== kind) throw new CliError(`Unsupported ${kind} model: ${name}. Use models list; no substitution was made.`, ExitCode.Usage);
  const live = findModel(catalog, entry.id);
  if (!live || live.enabled === false || live.available === false) throw new CliError(`Model unavailable for this account: ${entry.id}. No substitution was made.`, ExitCode.Usage);
  return { ...entry, guideInfo: guideInfo(entry.guide.replace(/^references\//, "").replace(/\.md$/, "")), capabilityPolicy: "Official creative guidance does not authorize modes absent from verified EasyAI capabilities.", model: live.id || live.model || entry.id, capabilities: live, suggestedDefaults: kind === "image" ? { aspectRatio: "3:4", resolution: "2K", note: "Poster default only; stage output follows programme requirements and live capabilities" } : {}, approvalRequired: false };
}

export function validateCapabilities(selected: ReturnType<typeof routeModel>, payload: Record<string, any>) {
  const caps = selected.capabilities.capabilities || {};
  const mode = selected.kind === "image" ? "image" : String(payload.mode || "text_to_video");
  const images = payload.image_urls || (payload.image ? (Array.isArray(payload.image) ? payload.image : [payload.image]) : []), videos = payload.video_urls || [], audios = payload.audio_urls || [];
  for (const values of [images, videos, audios]) if (!Array.isArray(values) || values.some(v => typeof v !== "string" || !/^https:\/\//.test(v))) throw new CliError("References must be HTTPS URL arrays.", ExitCode.Usage);
  const capability = selected.kind === "image" ? caps[images.length ? "image_edit" : "image_generate"] : caps.omni_video || caps[mode === "text_to_video" ? "video_generate" : "image_to_video"];
  if (!capability) throw new CliError("Selected mode has no verified platform capability.", ExitCode.Approval);
  if (capability.supported_modes && !capability.supported_modes.includes(mode)) throw new CliError(`Mode ${mode} is not supported by ${selected.id}.`, ExitCode.Usage);
  if (selected.kind === "video" && !capability.supported_modes && !["text_to_video", "first_last_frame", "image_reference"].includes(mode)) throw new CliError("This mode has not been verified for the model.", ExitCode.Approval);
  const operationRules = capability.omni_reference_task_type?.constraints?.[payload.omni_reference_task_type];
  const rules = { ...capability, ...capability.mode_constraints?.[mode], ...operationRules };
  if (rules.forced_aspect_ratio && payload.aspect_ratio !== rules.forced_aspect_ratio) throw new CliError(`Mode requires aspect_ratio=${rules.forced_aspect_ratio}.`, ExitCode.Usage);
  if (rules.prompt_required && (typeof payload.prompt !== "string" || !payload.prompt.trim())) throw new CliError("This mode requires a non-empty prompt.", ExitCode.Usage);
  if (rules.forced_duration !== undefined && payload.duration !== rules.forced_duration) throw new CliError(`Mode requires duration=${rules.forced_duration}.`, ExitCode.Usage);
  if (rules.requires_reference_video && !videos.length) throw new CliError("This operation requires a reference video.", ExitCode.Usage);
  const qualities = rules.quality_allowed || rules.quality_options;
  if (payload.quality !== undefined && (!Array.isArray(qualities) || !qualities.includes(payload.quality))) throw new CliError("Unsupported quality setting.", ExitCode.Usage);
  if (selected.kind === "image") {
    const formats = rules.output_format_allowed || rules.output_formats || rules.format_options;
    const backgrounds = rules.background_allowed || rules.background_options;
    if (payload.output_format !== undefined && (!Array.isArray(formats) || !formats.includes(payload.output_format))) throw new CliError("Unsupported output_format setting.", ExitCode.Usage);
    if (payload.background !== undefined && (!Array.isArray(backgrounds) || !backgrounds.includes(payload.background))) throw new CliError("Unsupported background setting.", ExitCode.Usage);
    // The public model capability aggregates providers. Since platform routing is
    // automatic and several enabled adapters are single-output, only one result
    // is portable across every candidate platform.
    if (payload.n !== 1) throw new CliError("n>1 is not portable across the enabled automatic platform routes; submit one output.", ExitCode.Usage);
  }
  for (const [field, allowed] of [["resolution", rules.output_resolutions], ["aspect_ratio", rules.aspect_ratio_allowed], ["duration", rules.duration_options]] as const) {
    if (!(field === "duration" && payload.duration === rules.forced_duration) && payload[field] !== undefined && Array.isArray(allowed) && !allowed.includes(payload[field])) throw new CliError(`${field} is not supported by ${selected.id}.`, ExitCode.Usage);
  }
  if (selected.kind === "video") {
    if (!Number.isFinite(payload.duration) || !payload.resolution || !payload.aspect_ratio || typeof payload.audio !== "boolean") throw new CliError("Video requires explicit duration, resolution, aspect_ratio and audio.", ExitCode.Usage);
    if (!rules.duration_options && !rules.duration_range) throw new CliError("Model duration limits are unverified.", ExitCode.Approval);
    if (payload.duration !== rules.forced_duration && rules.duration_range && (payload.duration < rules.duration_range[0] || payload.duration > rules.duration_range[1])) throw new CliError("Duration is outside the platform range.", ExitCode.Usage);
    if (rules.duration_step && !Number.isInteger((payload.duration - (rules.duration_range?.[0] || 0)) / rules.duration_step)) throw new CliError("Duration does not match the supported step.", ExitCode.Usage);
    if (rules.output_audio_mode === "always" && payload.audio !== true) throw new CliError("This model requires audio; changing the approved settings needs confirmation.", ExitCode.Approval);
    if (payload.audio && rules.output_audio !== true) throw new CliError("Audio output capability is unverified.", ExitCode.Approval);
  }
  if (selected.kind === "video" && mode === "text_to_video" && (images.length || videos.length || audios.length)) throw new CliError("Text-only mode cannot include references.", ExitCode.Usage);
  if (mode === "first_last_frame" && (images.length !== 2 || videos.length || audios.length)) throw new CliError("First/last mode requires exactly two images and no other references.", ExitCode.Usage);
  if (mode === "image_reference" && !images.length) throw new CliError("Image-reference mode requires images.", ExitCode.Usage);
  if (["video_reference", "video_edit", "continuation"].includes(mode) && !videos.length) throw new CliError(`${mode} requires a reference video.`, ExitCode.Usage);
  if (mode === "audio_reference" && !audios.length) throw new CliError("Audio-reference mode requires audio.", ExitCode.Usage);
  for (const [kind, refs, limit] of [["image", images, rules.max_images || rules.input_max_images_count], ["video", videos, rules.max_videos], ["audio", audios, rules.max_audios]] as const) {
    const mediaRules = rules.input_media_constraints?.[kind]; const maximum = limit ?? mediaRules?.max_count ?? (kind === "image" && rules.input_multiple_images === false ? 1 : undefined);
    if (refs.length && (!Number.isFinite(maximum) || refs.length > maximum) && !(mode === "first_last_frame" && kind === "image" && rules.input_first_last_frame)) throw new CliError(`Reference ${kind} count exceeds or lacks a verified limit.`, ExitCode.Approval);
    if (kind === "audio" && refs.length && (rules.input_audio !== true || (mediaRules?.requires_visual_reference && !images.length && !videos.length))) throw new CliError("Audio reference combination is not supported.", ExitCode.Approval);
  }
  return payload;
}

export function compactModelRow(row: any): { id: string; alias: string; types: string[]; upstream: string } {
  const entry = registryEntry(row);
  const id = String(row?.id || row?.model || row?.name || "");
  return { id, alias: entry?.id || id, types: modelTypes(row), upstream: String(row?.modelName || row?.upstream || entry?.modelName || "") };
}

export function formatModelGroups(rows: any[]): string {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const item = compactModelRow(row);
    const group = item.types.some(type => type.startsWith("image")) ? "image" : item.types.some(type => type.includes("video")) ? "video" : (item.types[0] || "other");
    const list = groups.get(group) || [];
    if (item.id && !list.includes(item.id)) list.push(item.id);
    groups.set(group, list);
  }
  const order = ["image", "video", ...[...groups.keys()].filter(name => name !== "image" && name !== "video")];
  return order.filter(name => groups.get(name)?.length).map(name => `${name}\n${groups.get(name)!.map(id => `  ${id}`).join("\n")}`).join("\n");
}
