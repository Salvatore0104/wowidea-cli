import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

function runCli(args: string[], env: Record<string, string>, cwd: string) {
  return new Promise<{ code: number | null; out: string; err: string }>(done => {
    const p = spawn(process.execPath, [resolve("dist/cli.js"), ...args], { env: { ...process.env, WOWIDEA_API_KEY: "", ...env }, cwd, windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", d => out += d);
    p.stderr.on("data", d => err += d);
    p.on("close", code => done({ code, out, err }));
  });
}

const catalog = { data: [
  { id: "Nano Banana 2", capabilities: { image_generate: { output_resolutions: ["1K", "2K", "4K"] }, image_edit: { output_resolutions: ["1K", "2K", "4K"], input_max_images_count: 14 } } },
  { id: "gpt-image-2.5", capabilities: { image_generate: { output_resolutions: ["1K", "2K", "4K"], aspect_ratio_allowed: ["1:1", "16:9"], quality_options: ["high"], output_format_allowed: ["png"] } } },
  { id: "Wan3.0-Video", capabilities: { omni_video: { supported_modes: ["text_to_video"], output_resolutions: ["720p"], duration_range: [4, 15], aspect_ratio_allowed: ["16:9"], output_audio: true } } },
] };

describe("creative CLI loop with a mock website", () => {
  it("initializes a project once, then routes, prices, edits and submits without gates", async () => {
    let lastImagePost = "", videoPosts = 0;
    const server = createServer((req, res) => {
      const base = `http://127.0.0.1:${(server.address() as any).port}`;
      if (req.url === "/out/1.png") { res.setHeader("Content-Type", "image/png"); res.end("result-bytes"); return; }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/v1/models") { res.end(JSON.stringify(catalog)); return; }
      if (req.url === "/api/v1/balance") { res.end(JSON.stringify({ data: { total: 42.5, balanceDetail: { reservedAmount: 0, availableForNewTask: 42.5 } } })); return; }
      if (req.url === "/api/v1/tasks") { res.end(JSON.stringify({ items: [] })); return; }
      if (req.url === "/api/v1/tasks/sd-job") { res.end(JSON.stringify({ taskId: "sd-job", status: "queued" })); return; }
      if (req.method === "POST" && req.url === "/api/v1/video/generations") { videoPosts++; let body = ""; req.on("data", d => body += d); req.on("end", () => res.end(JSON.stringify({ taskId: "sd-job", status: "queued" }))); return; }
      if (req.method === "POST" && req.url === "/api/v1/images/generations") { let body = ""; req.on("data", d => body += d); req.on("end", () => { lastImagePost = body; res.end(JSON.stringify({ taskId: "edit-job", status: "succeeded", result: { images: [{ url: `${base}/out/1.png` }] }, billing: { actualPoints: 20 } })); }); return; }
      res.statusCode = 404; res.end("{}");
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    const work = await mkdtemp(join(tmpdir(), "wowidea-creative-cli-")); dirs.push(work);
    const project = join(work, "project"); await mkdir(project);
    const env = { EASYAI_API_KEY: "mock-temp-key", EASYAI_BASE_URL: `http://127.0.0.1:${(server.address() as any).port}`, EASYAI_CONFIG_DIR: join(work, "config") };
    try {
      const setup = await runCli(["--json", "project", "setup", "--dir", project, "--no-canvas"], env, work);
      expect(setup.code, setup.err).toBe(0);
      expect(JSON.parse(setup.out).data.root).toBe(resolve(project));
      await access(join(project, ".agents", "skills", "wowidea", "SKILL.md"));
      await access(join(project, ".agents", "skills", "gpt-image-25-prompt", "SKILL.md"));
      await access(join(project, ".wowidea", "runtime", "dist", "cli.js"));
      const agents = await readFile(join(project, "AGENTS.md"), "utf8");
      expect(agents).toContain("wowidea:begin");
      expect(agents.match(/wowidea:begin/g)).toHaveLength(1);
      expect((await runCli(["--json", "project", "setup", "--dir", project, "--no-canvas"], env, work)).code).toBe(0);
      expect((await readFile(join(project, "AGENTS.md"), "utf8")).match(/wowidea:begin/g)).toHaveLength(1);

      const route = await runCli(["--json", "models", "route", "--kind", "image", "--purpose", "文字排版", "--stage", "final"], env, work);
      expect(route.code, route.err).toBe(0);
      expect(JSON.parse(route.out).data).toMatchObject({ model: "gpt-image-2.5", payload: { resolution: "4K" }, guide: { promptSkill: "gpt-image-25-prompt" } });
      const ask = await runCli(["--json", "models", "route", "--kind", "video"], env, work);
      expect(JSON.parse(ask.out).data.needsInput).toBe(true);

      const snapshot = join(work, "prices.json");
      await writeFile(snapshot, JSON.stringify({ schemaVersion: "wowidea.prices/v1", source: "website export", updatedAt: new Date().toISOString(), rules: [{ model: "Nano Banana 2", operation: "image", unit: "image", points: 20 }] }));
      expect((await runCli(["--json", "prices", "import", snapshot], env, work)).code).toBe(0);
      expect((await runCli(["--json", "prices", "show"], env, work)).out).toContain("website export");

      const edit = await runCli(["--json", "image", "edit", "--direct", "--data", JSON.stringify({ image_urls: ["https://cdn.example.com/source.png"], prompt: "make it blue" }), "--idempotency-key", "edit-1", "--project-dir", project, "--parent", "task-0", "--change", "recolor", "--dir", join(work, "out")], env, work);
      expect(edit.code, edit.err).toBe(0);
      const edited = JSON.parse(edit.out).data;
      expect(edited).toMatchObject({ taskId: "edit-job", pointsUsage: { total: 42.5, actualPoints: 20 } });
      expect(edited.paths).toHaveLength(1);
      expect(JSON.parse(lastImagePost)).toMatchObject({ model: "Nano Banana 2", image: ["https://cdn.example.com/source.png"] });

      const generated = await runCli(["--json", "image", "generate", "--direct", "--data", JSON.stringify({ model: "gpt-image-2.5", prompt: "wide poster", size: "3840x2160", quality: "high", output_format: "png" }), "--idempotency-key", "wide-1", "--no-wait", "--project-dir", project], env, work);
      expect(generated.code, generated.err).toBe(0);
      expect(JSON.parse(lastImagePost)).toMatchObject({ model: "gpt-image-2.5", resolution: "4K", aspect_ratio: "16:9", n: 1 });
      expect(JSON.parse(lastImagePost)).not.toHaveProperty("size");

      const video = ["--json", "video", "generate", "--direct", "--data", JSON.stringify({ model: "Wan3.0-Video", prompt: "shot", duration: 5, resolution: "720p", aspect_ratio: "16:9", audio: false }), "--idempotency-key", "sd-1", "--no-wait", "--project-dir", project];
      const submitted = await runCli(video, env, work);
      expect(submitted.code, submitted.err).toBe(0);
      expect(JSON.parse(submitted.out).data).toMatchObject({ taskId: "sd-job", status: "queued" });
      expect((await runCli(video, env, work)).code, "resume must not fail").toBe(0);
      expect(videoPosts, "one accepted Seedance submission only").toBe(1);

      const records = (await readdir(join(project, ".wowidea", "runs"))).map(async f => JSON.parse(await readFile(join(project, ".wowidea", "runs", f), "utf8")));
      const runs = await Promise.all(records);
      expect(runs.find((r: any) => r.parentTaskId === "task-0")).toMatchObject({ change: "recolor", state: "succeeded", model: "Nano Banana 2" });
      expect(JSON.stringify(runs)).not.toContain("mock-temp-key");
    } finally { await new Promise<void>(r => server.close(() => r())); }
  });
});
