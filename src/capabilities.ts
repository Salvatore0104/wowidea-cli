import { ExitCode } from "./errors.js";
import { listTasks, routingTable } from "./task-router.js";

export function capabilitiesDocument() {
  const table = routingTable();
  return {
    schemaVersion: "wowidea.capabilities/v1",
    cli: ["wowidea", "easyai"],
    baseUrl: "https://wowidea.top/api/v1",
    auth: { env: "WOWIDEA_API_KEY", also: "EASYAI_API_KEY", header: "Authorization: Bearer", keychain: "optional" },
    mcp: { url: "https://wowidea.top/api/mcp", headers: { Authorization: "Bearer sk-YOUR_KEY" } },
    decision: [
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
      "Download video URLs immediately; they expire in 24h. Pass --json. Pass --yes to submit a paid final.",
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
      { command: "capabilities", flags: ["--json"], output: "this document" },
      { command: "models list", flags: ["--type image|video"], output: "catalog rows" },
      { command: "models by-task <task>", flags: ["--fast", "--json"], output: "{ task, model, chain, entries }" },
      { command: "image generate", flags: ["--task", "--prompt", "--model", "--reference", "--direct", "--json", "--no-wait"], output: "{ taskId, paths, model, pricing }" },
      { command: "image edit", flags: ["--task", "--prompt", "--reference", "--direct", "--json"], output: "{ taskId, paths, model }" },
      { command: "video generate", flags: ["--task", "--prompt", "--duration", "--direct", "--json"], output: "{ taskId, paths, model: 豆包Seedance-2.5, draft: true, resolution: 480p }" },
      { command: "video finalize <draftId>", flags: ["--yes", "--json", "--no-wait"], output: "{ submitted, estimatedPoints, estimateLabel, sourceResultId, taskId }" },
      { command: "batch run", flags: ["--manifest", "--concurrency", "--out", "--state", "--json"], output: "{ ok, jobs[] }" },
      { command: "layers", flags: ["--layer", "--from", "--out", "--key", "--json"], output: "{ layers: [{ name, path, method, keyColor }] }" },
      { command: "key <image>", flags: ["--out", "--key auto|#RRGGBB", "--json"], output: "{ path, keyColor, method }" },
      { command: "doctor", flags: ["--json"], output: "{ ok, checks }" },
    ],
  };
}
