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

function fakeApi(state: { posts: Array<{ path: string; body: unknown }> }) {
  const task = { status: "succeeded", model: "Seedance-2.5-Draft", videoGeneration: { resultId: "result-1", stage: "draft", model: "Seedance-2.5-Draft" } };
  return {
    async get(path: string) {
      if (path.includes("/v1/tasks/")) return task;
      if (path.includes("/finalization")) return { eligible: true, targetResolutions: ["1440p"] };
      throw new Error(path);
    },
    async post(path: string, body: unknown) {
      state.posts.push({ path, body });
      if (path.includes("estimatedBilling")) return { amount: 42 };
      if (path.includes("/video/finalizations")) return { task_id: "final-1" };
      throw new Error(path);
    },
  } as unknown as EasyAiApi;
}

describe("video finalize", () => {
  it("shows the cost before --yes and never finalizes the same draft twice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowidea-final-")); dirs.push(dir);
    process.env.EASYAI_CONFIG_DIR = dir;
    const state = { posts: [] as Array<{ path: string; body: unknown }> };
    const preview = await finalizeDraft(fakeApi(state), { draftId: "draft-1" });
    expect(preview).toMatchObject({ submitted: false, deduped: false, estimatedPoints: 42, sourceResultId: "result-1", requiredFlag: "--yes" });
    expect(state.posts.map(post => post.path)).toEqual(["/v1/integration-platform/models/estimatedBilling"]);
    const paid = await finalizeDraft(fakeApi(state), { draftId: "draft-1", yes: true });
    expect(paid).toMatchObject({ submitted: true, taskId: "final-1", deduped: false });
    expect(state.posts.at(-1)?.path).toBe("/v1/video/finalizations");
    const again = await finalizeDraft(fakeApi(state), { draftId: "draft-1", yes: true });
    expect(again).toMatchObject({ deduped: true, taskId: "final-1", submitted: false });
    expect(state.posts.filter(post => String(post.path).includes("/video/finalizations"))).toHaveLength(1);
  });

  it("rejects a draft that did not succeed or is the wrong model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wowidea-final-")); dirs.push(dir);
    process.env.EASYAI_CONFIG_DIR = dir;
    const api = { async get() { return { status: "queued", model: "Seedance-2.5-Draft" }; }, async post() { throw new Error("no post"); } } as unknown as EasyAiApi;
    await expect(finalizeDraft(api, { draftId: "draft-1", yes: true })).rejects.toThrow(/succeeds/);
    const wrong = { async get() { return { status: "succeeded", model: "Wan3.0-Video" }; }, async post() { throw new Error("no post"); } } as unknown as EasyAiApi;
    await expect(finalizeDraft(wrong, { draftId: "draft-1", yes: true })).rejects.toThrow(/not a Seedance 2.5 draft/);
  });
});