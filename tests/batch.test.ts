import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest, runBatch, type BatchClient } from "../src/batch.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

function client(submit: BatchClient["submit"]): BatchClient {
  return { submit, async poll(taskId) { return { status: "succeeded", urls: taskId ? [`https://example.test/${taskId}.png`] : [] }; }, async download(urls) { return urls.map((_, index) => `out-${index}.png`); } };
}

describe("batch scheduler", () => {
  it("parses a compact manifest and refuses a final video", async () => {
    const jobs = parseManifest("jobs:\n  - id: a\n    task: direction\n    prompt: mood\n", "jobs.yaml");
    expect(jobs[0]).toMatchObject({ id: "a", task: "direction", prompt: "mood" });
    const dir = await mkdtemp(join(tmpdir(), "wowidea-batch-")); dirs.push(dir);
    const result = await runBatch({
      jobs: [{ id: "final", task: "成片", prompt: "expensive" }, { id: "ok", task: "typography", prompt: "poster" }],
      outDir: dir, concurrency: 2, perModel: 1, gapMs: 0, pollIntervalMs: 1,
      client: client(async job => ({ taskId: job.id, status: "succeeded", urls: ["https://example.test/a.png"] })),
    });
    expect(result.jobs.find(job => job.id === "final")).toMatchObject({ status: "failed" });
    expect(result.jobs.find(job => job.id === "ok")?.status).toBe("done");
    expect(result.jobs.find(job => job.id === "final")?.error).toMatch(/finalize/);
  });

  it("dedupes identical jobs, caps concurrency, and resumes a submitted task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowidea-batch-")); dirs.push(dir);
    let active = 0, max = 0, submits = 0;
    const result = await runBatch({
      jobs: [
        { id: "one", task: "typography", prompt: "same poster" },
        { id: "two", task: "typography", prompt: "same poster" },
        { id: "three", task: "retouch", prompt: "other" },
      ],
      outDir: dir, concurrency: 2, perModel: 2, gapMs: 0, pollIntervalMs: 1,
      client: client(async () => {
        submits += 1; active += 1; max = Math.max(max, active);
        await new Promise(resolve => setTimeout(resolve, 40));
        active -= 1;
        return { taskId: `t-${submits}`, status: "succeeded", urls: ["https://example.test/a.png"] };
      }),
    });
    expect(max).toBeLessThanOrEqual(2);
    expect(submits).toBe(2);
    expect(result.jobs.map(job => job.status).sort()).toEqual(["deduped", "done", "done"]);

    const state = join(dir, "resume.json");
    await writeFile(state, JSON.stringify({ jobs: { held: { id: "held", status: "submitted", model: "gpt-image-2.5", taskId: "already", attempts: 1, output: [], dedupeKey: "held" } } }));
    let resumed = 0;
    const second = await runBatch({
      jobs: [{ id: "held", model: "gpt-image-2.5", prompt: "held", kind: "image" }],
      outDir: dir, statePath: state, concurrency: 1, gapMs: 0, pollIntervalMs: 1,
      client: client(async () => { resumed += 1; return { taskId: "new", status: "succeeded", urls: [] }; }),
    });
    expect(resumed).toBe(0);
    expect(second.jobs[0]).toMatchObject({ status: "done", taskId: "already" });
  });
});
