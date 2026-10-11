import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";
import { findModel, matchesModelType, registry, registryEntry, routeModel, validateCapabilities } from "../src/models.js";
const catalog = { data: { items: registry.map(r => ({ id: r.id, modelName: r.modelName, enabled: true })) } };
describe("model routing", () => {
  it("selects defaults and explicit MiniMax without substitution", () => {
    expect(routeModel(catalog, "image").id).toBe("Nano Banana 2");
    expect(routeModel(catalog, "video").id).toBe("Seedance-2.5-Draft");
    expect(routeModel(catalog, "video", "minimax").id).toBe("MiniMax-H3");
    expect(routeModel(catalog, "video", "Seedance 2.5").id).toBe("豆包Seedance-2.5");
    expect(routeModel(catalog, "video", "Wan3.0 Prime").id).toBe("Wan3.0-Video-Prime");
    expect(() => routeModel([], "image")).toThrow("unavailable");
    expect(() => routeModel(catalog, "image", "MiniMax-H3")).toThrow();
  });
  it("keeps 2.0 and 2.5 separate and bundles every guide", async () => {
    expect(routeModel(catalog, "video", "豆包Seedance-2.5").guide).not.toBe(routeModel(catalog, "video", "豆包Seedance-2.0").guide);
    for (const entry of registry) await access(`skill/wowidea/${entry.guide}`);
    expect(registry.length).toBeGreaterThanOrEqual(12);
  });
  it("validates live limits instead of inheriting limits from a different version", () => {
    const selected = routeModel(catalog, "video"); selected.capabilities.capabilities = { omni_video: { duration_range: [4, 15], output_resolutions: ["720p"], output_audio: true, output_audio_mode: "always", supported_modes: ["text_to_video"] } };
    const payload = { duration: 9, resolution: "720p", aspect_ratio: "16:9", audio: true };
    expect(() => validateCapabilities(selected, payload)).not.toThrow();
    expect(() => validateCapabilities(selected, { ...payload, duration: 30 })).toThrow();
    expect(() => validateCapabilities(selected, { ...payload, audio: false })).toThrow();
    expect(() => validateCapabilities(selected, { ...payload, mode: "video_edit" })).toThrow();
  });
  it("does not turn H3 official prompt modes into unverified platform support", () => {
    const selected = routeModel(catalog, "video", "MiniMax-H3");
    selected.capabilities.capabilities = { omni_video: { duration_range: [4, 15], supported_modes: ["text_to_video", "image_reference"], max_images: 2, output_audio: true } };
    const payload = { duration: 8, resolution: "768p", aspect_ratio: "16:9", audio: true };
    expect(() => validateCapabilities(selected, { ...payload, mode: "L2VA", image_urls: ["https://example.test/end.png"] })).toThrow(/not supported/);
    expect(() => validateCapabilities(selected, { ...payload, mode: "Ref2VA" })).toThrow(/not supported/);
    expect(() => validateCapabilities(selected, { ...payload, mode: "image_reference", image_urls: ["https://example.test/a.png"], audio_urls: ["https://example.test/sound.wav"] })).toThrow();
    expect(() => validateCapabilities(selected, { ...payload, mode: "text_to_video", image_urls: ["https://example.test/a.png"] })).toThrow(/Text-only/);
  });

  // The live catalog ships Midjourney as `mj-v8.2` while this CLI presents it as
  // "Midjourney v8.2"; both spellings must resolve to the same live row.
  it("resolves registry display names against the live catalog identifiers", () => {
    const live = { data: [{ id: "mj-v8.2", modelName: "mj-v8.2", displayName: "mj-v8.2", modelType: ["image_generate", "image_edit"], enabled: true }] };
    expect(findModel(live, "Midjourney v8.2")?.id).toBe("mj-v8.2");
    expect(findModel(live, "mj-v8.2")?.id).toBe("mj-v8.2");
    expect(registryEntry(live.data[0])?.guide).toBe("references/midjourney.md");
    expect(findModel(live, "Nano Banana 2")).toBeUndefined();
  });

  it("filters the live catalog locally because the server ignores ?type=", () => {
    expect(matchesModelType({ modelType: ["image_generate", "image_edit"] }, "image")).toBe(true);
    expect(matchesModelType({ modelType: ["image_analysis"] }, "video")).toBe(false);
    expect(matchesModelType({ modelType: ["video_generate", "image_to_video", "omni_video"] }, "video")).toBe(true);
    expect(matchesModelType({ modelType: ["text_generate", "image_analysis"] }, "image")).toBe(false);
    expect(matchesModelType({ modelType: ["image_analysis"] }, "image_analysis")).toBe(true);
    expect(matchesModelType({ types: ["audio_understanding"] }, "image")).toBe(false);
  });

  it("registers every image model the live catalog exposes", () => {
    for (const modelName of ["gpt-image-2.5", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "mj-v8.2", "mj-v8.2-fast"]) {
      expect(registry.some(entry => entry.modelName === modelName)).toBe(true);
    }
  });
});
