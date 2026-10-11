import { describe, expect, it } from "vitest";
import { applyDraftContract, canFallback, resolveTask, seedanceWirePayload } from "../src/task-router.js";
import { CliError, redact } from "../src/errors.js";
import { capabilitiesBrief, capabilitiesDocument, formatCapabilitiesBrief } from "../src/capabilities.js";

describe("task router", () => {
  it("maps a task to a model chain and a fast alternate", () => {
    expect(resolveTask("海报")).toMatchObject({ task: "typography", model: "gpt-image-2.5", media: "image" });
    expect(resolveTask("direction", { fast: true }).model).toBe("mj-v8.2-fast");
    const video = resolveTask("样片");
    expect(video.model).toBe("豆包Seedance-2.5");
    expect(video.alias).toBe("Seedance-2.5-Draft");
    expect(video.params).toEqual({ draft: true, resolution: "480p" });
    expect(video.chain).not.toContain("Seedance-2.5-Final");
  });

  it("refuses to generate a final and keeps the static chain when the live catalog misses it", () => {
    expect(resolveTask("成片", { stage: "final" })).toMatchObject({ finalizeOnly: true, model: "Seedance-2.5-Final", chain: [] });
    const missed = resolveTask("direction", { catalog: { data: [{ id: "unrelated-model" }] } });
    expect(missed.source).toBe("static-fallback");
    expect(missed.chain[0]).toBe("mj-v8.2");
    const live = resolveTask("direction", { catalog: { data: [{ id: "mj-v8.2-fast" }] } });
    expect(live).toMatchObject({ source: "live", model: "mj-v8.2-fast" });
    expect(live.chain).toEqual(["mj-v8.2-fast"]);
  });

  it("writes the draft contract and does not treat an uncertain failure as a fallback", () => {
    const contracted = applyDraftContract({ prompt: "push", mode: "text_to_video", watermark: false }, "Seedance-2.5-Draft");
    expect(seedanceWirePayload(contracted)).toEqual({ model: "豆包Seedance-2.5", draft: true, resolution: "480p", duration: 4, aspect_ratio: "16:9", audio: false, content: [{ type: "text", text: "push" }] });
    expect(() => applyDraftContract({ resolution: "1080p" }, "Seedance-2.5-Draft")).toThrow(/480p/);
    expect(() => applyDraftContract({ prompt: "x" }, "Seedance-2.5-Final")).toThrow(/finalize/);
    expect(canFallback(new CliError("Model unavailable", 2))).toBe(true);
    expect(canFallback(new CliError("Task did not expose a downloadable video", 5))).toBe(false);
    expect(canFallback(new Error("unavailable"))).toBe(false);
  });

  it("exposes the routing table in one capabilities document", () => {
    const doc = capabilitiesDocument();
    expect(doc.schemaVersion).toBe("wowidea.capabilities/v1");
    expect(doc.tasks.some(task => task.id === "video" && task.model === "豆包Seedance-2.5" && task.params?.draft === true)).toBe(true);
    expect(doc.commands.some(command => command.command.startsWith("video finalize"))).toBe(true);
    expect(doc.decision.join("\n")).toContain("capabilities --brief");
    expect(JSON.stringify(redact(doc.mcp))).toContain("Bearer $WOWIDEA_API_KEY");
    const brief = JSON.stringify(capabilitiesBrief());
    expect(brief.length).toBeGreaterThan(700);
    expect(brief.length).toBeLessThan(6000);
    expect(brief).toContain("\"6\"");
    expect(brief).toContain("\"7\"");
    const human = formatCapabilitiesBrief();
    expect(human.split("\n").length).toBeGreaterThan(12);
    expect(human).toContain("Exit codes");
    expect(human).toContain("0  ok");
    expect(human).toContain("7  budget");
    expect(human).toContain("Bearer $WOWIDEA_API_KEY");
  });
});
