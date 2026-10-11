import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function run(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; out: string; err: string }>(done => {
    // Isolate project records from the repository, but only after the working
    // directory exists: spawn() cannot start a process inside a missing cwd.
    const cwd = env.EASYAI_CONFIG_DIR || process.cwd();
    mkdirSync(cwd, { recursive: true });
    const p = spawn(process.execPath, [resolve("dist/cli.js"), ...args], { env: { ...process.env, WOWIDEA_API_KEY: "", ...env }, cwd, windowsHide: true });
    let out = "", err = ""; p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d); p.on("close", code => done({ code, out, err }));
  });
}
describe("CLI gates with a mock website", () => {
  it.each([{ kind: "image", cost: 1000, code: 0 }, { kind: "minimax", cost: 1000, code: 0 }, { kind: "video", cost: 200, code: 0 }, { kind: "video", cost: 201, code: 0 }])("$kind generation does not apply a cost policy", async ({ kind, cost, code }) => {
    let submissions = 0, preflights = 0;
    const catalog = [{ id: "Nano Banana 2", capabilities: { image_generate: {} } }, { id: "豆包Seedance-2.0", capabilities: { omni_video: { supported_modes: ["text_to_video"], duration_range: [4, 15], output_resolutions: ["720p"], aspect_ratio_allowed: ["16:9"], output_audio: true } } }];
    catalog.push({ ...catalog[1]!, id: "MiniMax-H3" });
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url?.endsWith("/preflight")) { preflights++; let body = ""; req.on("data", d => body += d); req.on("end", () => res.end(JSON.stringify({ quoteId: "cost-quote", estimatedCost: cost, currency: "points", expiresAt: new Date(Date.now() + 60000).toISOString(), normalizedRequest: JSON.parse(body) }))); return; }
      if (req.url === "/api/integration-platform/models/estimatedBilling") { let body = ""; req.on("data", d => body += d); req.on("end", () => res.end(JSON.stringify({ amount: cost, estimatedPower: cost, calculation: {} }))); return; }
      if (req.method === "POST") { submissions++; res.end(JSON.stringify({ taskId: "job", status: "queued" })); return; }
      if (req.url === "/api/v1/models") { res.end(JSON.stringify({ data: catalog })); return; }
      res.end(JSON.stringify({ taskId: "job", status: "succeeded", billing: { actualPoints: 37.5 } }));
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(join(tmpdir(), "wowidea-cost-cli-")); dirs.push(dir);
    const env = { EASYAI_CONFIG_DIR: dir, EASYAI_API_KEY: "mock-account-key", EASYAI_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}` };
    try {
      let args = ["--json", "image", "generate", "--direct", "--data", '{"prompt":"poster"}', "--idempotency-key", "one"];
      if (kind === "minimax") args = ["--json", "video", "generate", "--direct", "--data", JSON.stringify({ model: "MiniMax-H3", prompt: "product", duration: 9, resolution: "720p", aspect_ratio: "16:9", audio: false }), "--idempotency-key", "one"];
      if (kind === "video") {
        const manifest = join(dir, "manifest.json"), request = join(dir, "request.json"), storyboard = join(dir, "shot.png");
        await writeFile(storyboard, "mock storyboard bytes");
        await writeFile(manifest, JSON.stringify({ state: "storyboard_ready", model: "豆包Seedance-2.0", prompt: "shot", duration: 9, resolution: "720p", aspectRatio: "16:9", audio: false, watermark: false, mode: "text", lastFrameRequested: true, storyboard: [{ shot: 1, description: "shot", image: storyboard }], storyboardQc: { verdict: "pass", reviewedAt: new Date().toISOString(), hardFailures: [], notes: "Clear subject hierarchy and coherent physical progression across the reviewed storyboard.", aesthetics: { visualHierarchy: 4, temporalContinuity: 4, physicalPlausibility: 4, specificity: 4 } }, references: [], referenceCounts: { images: 0, videos: 0, audio: 0 } }));
        expect((await run(["seedance", "payload", manifest, "--file", request], env)).code).toBe(0);
        expect((await run(["video", "preflight", "--file", request], env)).code).toBe(0);
        expect((await run(["seedance", "approve", manifest, "--confirmation", "I APPROVE STORYBOARD"], env)).code).toBe(0);
        args = ["--json", "video", "generate", "--direct", "--manifest", manifest, "--idempotency-key", "one"];
      }
      args.push("--no-wait");
      const result = await run(args, env); expect(result.code, result.err).toBe(code);
      expect(submissions).toBe(code === 0 ? 1 : 0);
      expect(preflights).toBe(kind === "video" ? 1 : 0);
      if (code === 0) {
        const watched = await run(["--jsonl", kind === "image" ? "image" : "video", "watch", "job"], env);
        expect(JSON.parse(watched.out).data).toHaveProperty("pointsUsage");
      } else expect(result.err).not.toContain("200");
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
  it("submits a Seedance 2.5 draft without a manifest and marks draft:true", async () => {
    let posted: Record<string, unknown> | undefined; let asyncHeader = "";
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/models") { res.end(JSON.stringify({ data: [{ id: "Seedance-2.5-Draft", capabilities: { omni_video: { supported_modes: ["text_to_video"], duration_range: [4, 15], output_resolutions: ["480p", "720p"], aspect_ratio_allowed: ["16:9"], output_audio: true } } }] })); return; }
      if (req.url === "/api/integration-platform/models/estimatedBilling") { let body = ""; req.on("data", d => body += d); req.on("end", () => res.end(JSON.stringify({ amount: 8, estimatedPower: 8, calculation: {} }))); return; }
      if (req.method === "POST" && req.url === "/api/v1/video/generations") { let body = ""; req.on("data", d => body += d); req.on("end", () => { posted = JSON.parse(body); asyncHeader = String(req.headers["x-async"] || ""); res.statusCode = 201; res.end(JSON.stringify({ task_id: "draft-job", status: "submitted", query_url: "http://127.0.0.1/api/v1/ai/result/draft-job" })); }); return; }
      res.end(JSON.stringify({ taskId: "draft-job", status: "queued" }));
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(join(tmpdir(), "wowidea-draft-cli-")); dirs.push(dir);
    const env = { EASYAI_CONFIG_DIR: dir, EASYAI_API_KEY: "mock-account-key", EASYAI_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}` };
    try {
      const result = await run(["--json", "video", "generate", "--direct", "--no-wait", "--data", JSON.stringify({ model: "Seedance-2.5-Draft", prompt: "slow push", duration: 4, aspect_ratio: "16:9", audio: false })], env);
      expect(result.code, result.err).toBe(0);
      expect(asyncHeader).toBe("true");
      expect(posted).toEqual({ model: "豆包Seedance-2.5", draft: true, resolution: "480p", duration: 4, audio: false, aspect_ratio: "16:9", content: [{ type: "text", text: "slow push" }] });
      const data = JSON.parse(result.out).data;
      expect(data.taskId).toBe("draft-job");
      expect(data.task_id).toBe("draft-job");
      expect(data.model).toMatchObject({ alias: "Seedance-2.5-Draft", upstream: "doubao-seedance-2-5-260628", request: "豆包Seedance-2.5" });
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
  it("downloads an existing final when finalize --yes is deduped, and a dedupe preview exits 0", async () => {
    let downloads = 0;
    const server = createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      if (req.url === "/final.mp4") { downloads += 1; res.end("final-bytes"); return; }
      res.setHeader("Content-Type", "application/json");
      const draft = { task_id: "draft-1", status: "success", task_status: "succeeded", data: [{ url: `${base}/final.mp4`, videoGeneration: { resultId: "draft-1:0", stage: "draft", model: "doubao-seedance-2-5-260628", resolution: "480p", finalResolutions: ["1080p"], duration: 4, finalizeExpiresAt: Date.now() + 86400000 } }] };
      if (req.url === "/api/v1/ai/result/draft-1") { res.end(JSON.stringify(draft)); return; }
      if (req.url === "/api/v1/ai/result/final-1") { res.end(JSON.stringify({ task_id: "final-1", status: "success", task_status: "succeeded", data: [{ url: `${base}/final.mp4` }], output: [`${base}/final.mp4`] })); return; }
      if (req.url === "/api/v1/video/results/draft-1%3A0/finalization") { res.end(JSON.stringify({ eligible: true, existingTaskId: "final-1", targetResolutions: ["1080p"], expiresAt: Date.now() + 86400000, duration: 4 })); return; }
      res.statusCode = 404; res.end("{}");
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(join(tmpdir(), "wowidea-final-dedupe-")); dirs.push(dir);
    const env = { EASYAI_CONFIG_DIR: join(dir, "config"), EASYAI_API_KEY: "mock-account-key", EASYAI_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}` };
    try {
      const preview = await run(["--json", "video", "finalize", "draft-1"], env);
      expect(preview.code, preview.err).toBe(0);
      const previewData = JSON.parse(preview.out).data;
      expect(previewData).toMatchObject({ deduped: true, submitted: false, taskId: "final-1", status: "success" });
      expect(previewData.paths?.[0]).toContain("/final.mp4");
      expect(downloads).toBe(0);
      const paid = await run(["--json", "video", "finalize", "draft-1", "--yes", "--dir", join(dir, "out")], env);
      expect(paid.code, paid.err).toBe(0);
      const data = JSON.parse(paid.out).data;
      expect(data).toMatchObject({ deduped: true, taskId: "final-1", status: "success" });
      expect(data.paths).toHaveLength(1);
      expect(await readFile(data.paths[0], "utf8")).toBe("final-bytes");
      expect(downloads).toBe(1);
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
  it("prints a readable capabilities brief without --json", async () => {
    const brief = await run(["capabilities", "--brief"], {});
    expect(brief.code, brief.err).toBe(0);
    expect(brief.out.split("\n").length).toBeGreaterThan(12);
    expect(brief.out).toContain("Exit codes");
    expect(brief.out).toContain("7  budget");
    expect(brief.out).not.toMatch(/^\s*\{/);
  });
  it("prints capabilities and refuses a final prompt without calling the website", async () => {
    const caps = await run(["capabilities", "--json"], {});
    expect(caps.code, caps.err).toBe(0);
    const data = JSON.parse(caps.out).data;
    expect(data.schemaVersion).toBe("wowidea.capabilities/v1");
    expect(data.decision.join("\n")).toContain("video finalize");
    expect(data.commands.some((row: { command: string }) => row.command.startsWith("video finalize"))).toBe(true);
    const refused = await run(["--json", "video", "generate", "--direct", "--task", "成片", "--prompt", "do not spend"], { EASYAI_API_KEY: "mock-account-key", EASYAI_BASE_URL: "http://127.0.0.1:1" });
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("finalize");
  });
  it("keeps one POST across real CLI process restart and uncertain recovery", async () => {
    let posts = 0;
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/images/preflight") { let body = ""; req.on("data", d => body += d); req.on("end", () => res.end(JSON.stringify({ quoteId: "quote", estimatedCost: 20, currency: "points", expiresAt: new Date(Date.now() + 60000).toISOString(), normalizedRequest: JSON.parse(body) }))); return; }
      if (req.url === "/api/integration-platform/models/estimatedBilling") { let body = ""; req.on("data", d => body += d); req.on("end", () => res.end(JSON.stringify({ amount: 20, estimatedPower: 20, calculation: {} }))); return; }
      if (req.method === "POST") { posts++; res.statusCode = 503; res.end('{}'); return; }
      if (req.url === "/api/v1/models") { res.end(JSON.stringify({ data: [{ id: "Nano Banana 2", capabilities: { image_generate: {} } }] })); return; }
      res.end(JSON.stringify({ items: [{ id: "unrelated-task" }] }));
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(join(tmpdir(), "wowidea-process-test-")); dirs.push(dir);
    const env = { EASYAI_CONFIG_DIR: dir, EASYAI_API_KEY: "mock-account-key", EASYAI_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}` };
    try {
      const args = ["--json", "image", "generate", "--direct", "--data", '{"prompt":"poster"}', "--idempotency-key", "single-request"];
      expect((await run(args, env)).code).toBe(5);
      expect((await run(args, env)).code).toBe(5);
      expect((await run(["tasks", "resume", "single-request"], env)).err).toContain("uncertain");
      expect(posts).toBe(1);
      const listed = await run(["--json", "tasks", "list"], env);
      expect(JSON.parse(listed.out).data[0]).toMatchObject({ idempotencyKey: "single-request", state: "uncertain" });
      expect(listed.out).not.toContain("mock-account-key");
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
  it("waits for an async image, downloads it, and returns an absolute path by default", async () => {
    let posts = 0, taskReads = 0;
    const media = Buffer.from("mock-png-bytes");
    const server = createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      if (req.url === "/result.png") { res.setHeader("Content-Type", "image/png"); res.end(media); return; }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/models") { res.end(JSON.stringify({ data: [{ id: "Nano Banana 2", capabilities: { image_generate: {} } }] })); return; }
      if (req.url === "/api/v1/tasks") { res.end(JSON.stringify({ items: [] })); return; }
      if (req.method === "POST" && req.url === "/api/v1/images/generations") { posts++; res.statusCode = 202; res.end(JSON.stringify({ data: { task: { id: "image-job", status: "queued" } } })); return; }
      if (req.url === "/api/v1/tasks/image-job") { taskReads++; res.end(JSON.stringify({ data: { task: { id: "image-job", status: "succeeded", result: { images: [{ url: `${base}/result.png` }] }, billing: { actualPoints: 12 } } } })); return; }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(join(tmpdir(), "wowidea-download-cli-")); dirs.push(dir);
    const outputDir = join(dir, "outputs");
    const env = { EASYAI_CONFIG_DIR: join(dir, "config"), EASYAI_API_KEY: "mock-account-key", EASYAI_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}` };
    try {
      const result = await run(["--json", "image", "generate", "--direct", "--data", '{"prompt":"poster"}', "--idempotency-key", "download-once", "--dir", outputDir], env);
      expect(result.code, result.err).toBe(0);
      const data = JSON.parse(result.out).data;
      expect(data).toMatchObject({ taskId: "image-job", status: "succeeded" });
      expect(data.paths).toHaveLength(1); expect(data.paths[0]).toBe(resolve(outputDir, "image-job", "1-result.png"));
      await access(data.paths[0]); expect(await readFile(data.paths[0])).toEqual(media);
      expect(posts).toBe(1); expect(taskReads).toBe(1);
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
  it("keeps polling the same successful task until its output URL is available", async () => {
    let posts = 0, taskReads = 0;
    const server = createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      if (req.url === "/delayed.png") { res.end("delayed-image"); return; }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/models") { res.end(JSON.stringify({ data: [{ id: "Nano Banana 2", capabilities: { image_generate: {} } }] })); return; }
      if (req.url === "/api/v1/tasks") { res.end(JSON.stringify({ items: [] })); return; }
      if (req.method === "POST" && req.url === "/api/v1/images/generations") { posts++; res.end(JSON.stringify({ taskId: "delayed-job", status: "succeeded" })); return; }
      if (req.url === "/api/v1/tasks/delayed-job") {
        taskReads++;
        res.end(JSON.stringify(taskReads === 1 ? { taskId: "delayed-job", status: "succeeded" } : { taskId: "delayed-job", status: "succeeded", result: { images: [{ url: `${base}/delayed.png` }] } })); return;
      }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const dir = await mkdtemp(join(tmpdir(), "wowidea-delayed-result-")); dirs.push(dir);
    const env = { EASYAI_CONFIG_DIR: join(dir, "config"), EASYAI_API_KEY: "mock-account-key", EASYAI_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}` };
    try {
      const result = await run(["--json", "image", "generate", "--direct", "--data", '{"prompt":"poster"}', "--idempotency-key", "delayed-result", "--dir", join(dir, "out")], env);
      expect(result.code, result.err).toBe(0); expect(JSON.parse(result.out).data.paths).toHaveLength(1);
      expect(posts).toBe(1); expect(taskReads).toBe(2);
    } finally { await new Promise<void>(r => server.close(() => r())); }
  }, 10_000);
});
