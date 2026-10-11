import { describe, expect, it } from "vitest";
import { taskStatus } from "../src/submission.js";
import { findUrls } from "../src/api.js";
import { presentBalance } from "../src/usage.js";
import { compactModelRow, DRAFT_ALIAS_NOTE, formatModelGroups } from "../src/models.js";

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

  it("flattens balance and compacts the model list", () => {
    expect(presentBalance({ status: "success", data: { total: 12.5, balanceDetail: { availableForNewTask: 10 } } })).toMatchObject({ total: 12.5 });
    const rows = [
      { id: "Nano Banana 2", modelName: "nano-banana-2-ext", types: ["image_generate"] },
      { id: "Seedance-2.5-Draft", modelName: "doubao-seedance-2-5-260628", types: ["video_generate"] },
      { id: "豆包Seedance-2.5", modelName: "doubao-seedance-2-5-260628", types: ["video_generate"] },
    ];
    expect(compactModelRow(rows[0])).toMatchObject({ id: "Nano Banana 2", alias: "Nano Banana 2", upstream: "nano-banana-2-ext", types: ["image_generate"] });
    expect(compactModelRow(rows[1])).toMatchObject({ id: "Seedance-2.5-Draft", note: DRAFT_ALIAS_NOTE });
    expect(formatModelGroups([
      ...rows,
      { id: "frame-to-clip", types: ["image_to_video"] },
      { id: "omni", types: ["image_generate", "omni_video"] },
      { id: "vision", types: ["image_analysis"] },
      { id: "writer", types: ["text_generate"] },
      { id: "tools", types: ["tools_call"] },
      { id: "score", types: ["audio_generate"] },
      { id: "narrator", types: ["text_to_speech"] },
      { id: "mesh", types: ["3d_generate"] },
    ])).toBe([
      "image",
      "  Nano Banana 2",
      "video",
      "  豆包Seedance-2.5",
      "  frame-to-clip",
      "  omni",
      `  Seedance-2.5-Draft — ${DRAFT_ALIAS_NOTE}`,
      "text",
      "  vision",
      "  writer",
      "  tools",
      "music",
      "  score",
      "speech",
      "  narrator",
      "3d",
      "  mesh",
    ].join("\n"));
  });
});