import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EasyAiApi } from "../src/api.js";
import { finalizeDraft } from "../src/finalize.js";

const dirs: string[] = [];
const previousConfig = process.env.EASYAI_CONFIG_DIR;
afterEach(async () => {
  if (previousConfig === undefined) delete process.env.EASYAI_CONFIG_DIR;
  else process.env.EASYAI_CONFIG_DIR = previousConfig;
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function draftTask(stage = "draft") {
  return {
    task_id: "draft-1", status: "success", task_status: "succeeded", task_type: "generation",
    data: [{
      type: "video", url: "https://example.test/draft.mp4", duration: 4,
      videoGeneration: { resultId: "draft-1:0", stage, model: "doubao-seedance-2-5-260628", resolution: "480p", finalResolutions: ["1080p"], duration: 4, finalizeExpiresAt: Date.now() + 7 * 86400000 },
    }],
  };
}

function fakeApi(state: { posts: Array<{ path: string; body: any }> }, extra: Record<string, unknown> = {}) {
  return {
    async get(path: string) {
      if (path.includes("/v1/ai/result/")) return draftTask();
      if (path.includes("/finalization")) return { sourceResultId: "draft-1:0", eligible: true, targetResolutions: ["1080p"], expiresAt: Date.now() + 7 * 86400000, duration: 4, ...extra };
      throw new Error(path);
    },
    async post(path: string, body: unknown) {
      state.posts.push({ path, body });
      if (path.includes("/video/finalizations")) return { task_id: "final-1" };
      throw new Error(path);
    },
  } as unknown as EasyAiApi;
}

describe("video finalize", () => {
  it("labels the 1080p estimate and finalizes a draft result once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowidea-final-")); dirs.push(dir);
    process.env.EASYAI_CONFIG_DIR = dir;
    const state = { posts: [] as Array<{ path: string; body: any }> };
    const preview = await finalizeDraft(fakeApi(state), { draftId: "draft-1" });
    expect(preview).toMatchObject({ submitted: false, deduped: false, estimatedPoints: 149.68, estimate: true, sourceResultId: "draft-1:0", targetResolution: "1080p" });
    expect(preview).toHaveProperty("estimateLabel");
    expect(String((preview as { estimateLabel?: string }).estimateLabel)).toMatch(/估算/);
    expect(state.posts).toEqual([]);
    const paid = await finalizeDraft(fakeApi(state), { draftId: "draft-1", yes: true });
    expect(paid).toMatchObject({ submitted: true, taskId: "final-1", deduped: false, targetResolution: "1080p" });
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0]!.path).toBe("/v1/video/finalizations");
    expect(state.posts[0]!.body).toMatchObject({ sourceResultId: "draft-1:0", targetResolution: "1080p", outputFormat: "mp4", watermark: false, returnLastFrame: false });
    expect(state.posts[0]!.body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    const again = await finalizeDraft(fakeApi(state), { draftId: "draft-1", yes: true });
    expect(again).toMatchObject({ deduped: true, taskId: "final-1", submitted: false });
    expect(state.posts).toHaveLength(1);
  });

  it("reuses existingTaskId and refuses a direct render", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowidea-final-")); dirs.push(dir);
    process.env.EASYAI_CONFIG_DIR = dir;
    const state = { posts: [] as Array<{ path: string; body: any }> };
    const existing = await finalizeDraft(fakeApi(state, { existingTaskId: "already-final" }), { draftId: "draft-1", yes: true });
    expect(existing).toMatchObject({ deduped: true, taskId: "already-final", submitted: false });
    expect(state.posts).toEqual([]);
    const direct = { async get() { return draftTask("direct"); }, async post() { throw new Error("no post"); } } as unknown as EasyAiApi;
    await expect(finalizeDraft(direct, { draftId: "draft-1", yes: true })).rejects.toThrow(/样片/);
    const queued = { async get() { return { status: "process", task_status: "running", message: "TaskId:draft-1 is processing" }; }, async post() { throw new Error("no post"); } } as unknown as EasyAiApi;
    await expect(finalizeDraft(queued, { draftId: "draft-1", yes: true })).rejects.toThrow(/succeeds/);
  });
});
