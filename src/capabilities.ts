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
      "Video defaults to Seedance-2.5-Draft (样片).",
      "Seedance-2.5-Final is not a prompt. POST /v1/video/finalizations with sourceResultId. Never batch it and never use it as a fallback.",
      "Pass --json for machine-readable output. Pass --yes to submit a paid final render.",
    ],
    tasks: listTasks(),
    defaults: table.defaults,
    models: table.models,
    commands: [
      { command: "capabilities", flags: ["--json"], output: "this document" },
      { command: "models list", flags: ["--type image|video"], output: "catalog rows" },
      { command: "models by-task <task>", flags: ["--fast", "--json"], output: "{ task, model, chain, entries }" },
      { command: "image generate", flags: ["--task", "--prompt", "--model", "--reference", "--direct", "--json", "--no-wait"], output: "{ taskId, paths, model, pricing }" },
      { command: "image edit", flags: ["--task", "--prompt", "--reference", "--direct", "--json"], output: "{ taskId, paths, model }" },
      { command: "video generate", flags: ["--task", "--prompt", "--model", "--duration", "--resolution", "--ratio", "--direct", "--json"], output: "{ taskId, paths, model }" },
      { command: "video finalize <draftId>", flags: ["--yes", "--resolution", "--json", "--no-wait"], output: "{ submitted, estimatedPoints, sourceResultId, taskId }" },
      { command: "batch run", flags: ["--manifest", "--concurrency", "--out", "--state", "--json"], output: "{ ok, jobs[] }" },
      { command: "layers", flags: ["--layer", "--from", "--out", "--key", "--json"], output: "{ layers: [{ name, path, method, keyColor }] }" },
      { command: "key <image>", flags: ["--out", "--key auto|#RRGGBB", "--json"], output: "{ path, keyColor, method }" },
      { command: "doctor", flags: ["--json"], output: "{ ok, checks }" },
    ],
  };
}
