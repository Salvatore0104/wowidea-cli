import { ExitCode } from "./errors.js";
import { listTasks, routingTable } from "./task-router.js";

export function formatCapabilitiesBrief(): string {
  const card = capabilitiesBrief();
  const routing = card.routing.map(task => {
    const params = task.params ? ` draft=${task.params.draft} ${task.params.resolution}` : "";
    const alias = task.alias && task.alias !== task.model ? ` alias=${task.alias}` : "";
    return `  ${task.id}  ${task.model}${alias}${params}${task.finalizeOnly ? "  finalize-only" : ""}`;
  });
  return [
    "wowidea",
    "",
    "Decision",
    ...card.decision.map((step, index) => `  ${index + 1}. ${step}`),
    "",
    "Exit codes",
    ...Object.entries(card.exitCodes).map(([code, text]) => `  ${code}  ${text}`),
    "",
    "Commands",
    ...card.commands.map(command => `  ${command}`),
    "",
    "Routing",
    ...routing,
    "",
    "Rules",
    ...card.rules.map(rule => `  - ${rule}`),
    "",
    `Auth: ${card.auth}`,
    `MCP: ${card.mcp.url}`,
    `Header: ${card.mcp.header}`,
  ].join("\n");
}

export function capabilitiesBrief() {
  const tasks = listTasks().map(task => ({
    id: task.id,
    model: task.model,
    ...(task.alias !== task.model ? { alias: task.alias } : {}),
    ...(task.params ? { params: task.params } : {}),
    ...(task.finalizeOnly ? { finalizeOnly: true } : {}),
  }));
  return {
    schemaVersion: "wowidea.capabilities/v1",
    brief: true,
    decision: [
      "wowidea capabilities --brief",
      "wowidea models by-task <task> --json",
      "wowidea image|video generate --task <task> --prompt \"...\" --json --direct",
      "read data.taskId, data.paths, data.model",
    ],
    exitCodes: {
      0: "ok, including a finalize dedupe hit",
      2: "usage, including an unpaid finalize preview that has not been submitted",
      3: "auth",
      4: "conflict",
      5: "service",
      6: "approval required",
      7: "budget",
    },
    rules: [
      "No image model in the harness: call this CLI or https://wowidea.top/api/mcp. Do not refuse and do not draw SVG.",
      "样片 request: model 豆包Seedance-2.5, draft true, resolution 480p, content [{type:text,text}]. Display name is Seedance 2.5 样片. Do not send Seedance-2.5-Draft.",
      "成片: wowidea video finalize <draftId> prints an estimate and exits 2. Add --yes to pay once. A repeat exits 0 and downloads the existing file.",
      "Poll GET /v1/ai/result/{taskId}. submitted -> process -> success. tasks error 'is processing' is not a failure.",
    ],
    commands: [
      "capabilities --brief",
      "models list [--type image|video] [--json] [--raw]",
      "models by-task <task> --json",
      "image generate --task <task> --prompt \"...\" --json --direct",
      "video generate --task video --prompt \"...\" --json --direct",
      "video finalize <draftId> [--yes] --json",
      "batch run --manifest jobs.json --concurrency 6 --json",
      "key <image> --out cutout.png --json",
      "balance --json",
    ],
    routing: tasks,
    auth: "WOWIDEA_API_KEY",
    mcp: { url: "https://wowidea.top/api/mcp", header: "Authorization: Bearer $WOWIDEA_API_KEY" },
  };
}

export function capabilitiesDocument() {
  const table = routingTable();
  return {
    schemaVersion: "wowidea.capabilities/v1",
    cli: ["wowidea", "easyai"],
    baseUrl: "https://wowidea.top/api/v1",
    auth: { env: "WOWIDEA_API_KEY", also: "EASYAI_API_KEY", header: "Authorization: Bearer", keychain: "optional" },
    mcp: { url: "https://wowidea.top/api/mcp", header: "Authorization: Bearer $WOWIDEA_API_KEY" },
    decision: [
      "wowidea capabilities --brief",
      "wowidea capabilities --json",
      "wowidea models by-task <task> --json",
      "wowidea image|video generate --task <task> --prompt \"...\" --json --direct",
      "read data.taskId, data.paths, data.model",
      "成片: wowidea video finalize <draftId>  then the same command with --yes",
    ],
    exitCodes: { success: ExitCode.Success, usage: ExitCode.Usage, auth: ExitCode.Auth, conflict: ExitCode.Conflict, service: ExitCode.Service, approval: ExitCode.Approval, budget: ExitCode.Budget },
    rules: [
      "No image model in the harness: call this CLI or the MCP server. Do not refuse and do not draw SVG.",
      "Video 样片 display name is Seedance 2.5 样片. The request is model 豆包Seedance-2.5, draft true, resolution 480p, content [{type:text,text}]. Do not send model Seedance-2.5-Draft.",
      "Seedance-2.5-Final is not a prompt. GET /v1/video/results/{resultId}/finalization then POST /v1/video/finalizations at 1080p. Never batch it.",
      "Poll GET /v1/ai/result/{taskId}. status runs submitted -> process -> success. A tasks error of 'is processing' is not a failure.",
      "Prices: POST /api/integration-platform/models/estimatedBilling (not under /v1, free). Model list has no prices. Finalize cost is an estimate from the 1080p direct price, not a live quote.",
      "GET /v1/video/capabilities/{modelType} uses video_generate, image_to_video, or omni_video.",
      "Download video URLs immediately; they expire in 24h. An unpaid finalize preview exits 2. A dedupe hit exits 0. Pass --yes to pay.",
    ],
    poll: { path: "GET /v1/ai/result/{taskId}", status: ["submitted", "process", "success"] },
    pricing: { path: "POST /api/integration-platform/models/estimatedBilling", note: "outside /v1; free; body {params: generation params}" },
    videoCapabilities: { path: "GET /v1/video/capabilities/{modelType}", modelType: ["video_generate", "image_to_video", "omni_video"] },
    imageGenerate: { path: "POST /v1/images/generations", headers: { "x-async": "true" }, body: ["model", "prompt", "n", "aspect_ratio", "resolution"] },
    imageEdit: { path: "POST /v1/images/edits", note: "multipart image[]; not verified live" },
    tasks: listTasks(),
    defaults: table.defaults,
    models: table.models,
    commands: [
      { command: "capabilities", flags: ["--brief", "--json"], output: "--brief is the short document; --json is the full table" },
      { command: "models list", flags: ["--type image|video", "--json", "--raw"], output: "grouped ids, or --json {id, alias, types, upstream}; --raw is the catalog" },
      { command: "models by-task <task>", flags: ["--fast", "--json"], output: "{ task, model, alias, params, chain, entries }" },
      { command: "image generate", flags: ["--task", "--prompt", "--model", "--reference", "--direct", "--json", "--no-wait"], output: "{ taskId, paths, model, pricing }" },
      { command: "image edit", flags: ["--task", "--prompt", "--reference", "--direct", "--json"], output: "{ taskId, paths, model }" },
      { command: "video generate", flags: ["--task", "--prompt", "--duration", "--direct", "--json"], output: "{ taskId, paths, model: 豆包Seedance-2.5, draft: true, resolution: 480p }" },
      { command: "video finalize <draftId>", flags: ["--yes", "--json", "--no-wait"], output: "{ submitted, estimatedPoints, estimateLabel, sourceResultId, taskId }" },
      { command: "batch run", flags: ["--manifest", "--concurrency", "--out", "--state", "--json"], output: "{ ok, jobs[] }" },
      { command: "layers", flags: ["--layer", "--from", "--out", "--key", "--json"], output: "{ layers: [{ name, path, method, keyColor }] }" },
      { command: "key <image>", flags: ["--out", "--key auto|#RRGGBB", "--shadow keep|remove|neutral", "--json"], output: "{ path, keyColor, method }" },
      { command: "doctor", flags: ["--json"], output: "{ ok, checks }" },
    ],
  };
}
