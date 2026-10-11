import { describe, expect, it } from "vitest";
import { taskStatus } from "../src/submission.js";
import { findUrls } from "../src/api.js";

describe("live result shapes", () => {
  it("treats a processing error on the tasks payload as still running", () => {
    expect(taskStatus({ status: "running", error: "TaskId:abc is processing", errorMessage: "TaskId:abc is processing" })).toBe("process");
    expect(taskStatus({ status: "process", message: "TaskId:abc is processing", task_status: "running" })).toBe("process");
    expect(taskStatus({ status: "success", task_status: "succeeded" })).toBe("success");
  });

  it("reads image and video URLs from the ai/result payload", () => {
    const image = { status: "success", data: [{ type: "image", url: "https://scapi.net/hash.jpeg" }], output: ["https://scapi.net/hash.jpeg"] };
    expect(findUrls(image)).toEqual(["https://scapi.net/hash.jpeg"]);
    const video = { status: "success", task_type: "generation", data: [{ url: "https://tos.example/draft.mp4", videoGeneration: { resultId: "abc:0", stage: "draft" } }], output: ["https://tos.example/draft.mp4"] };
    expect(findUrls(video)).toEqual(["https://tos.example/draft.mp4"]);
    expect(taskStatus(video)).toBe("success");
  });
});