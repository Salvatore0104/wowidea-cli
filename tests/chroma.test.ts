import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { chooseKeyHex, keyImage, layerPrompt, supportsNativeTransparency } from "../src/chroma.js";

describe("chroma key", () => {
  it("cuts a flat green background and keeps the subject", async () => {
    const width = 48, height = 48;
    const raw = Buffer.alloc(width * height * 3, 0);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3;
      const subject = x > 16 && x < 32 && y > 16 && y < 32;
      raw[index] = subject ? 180 : 0;
      raw[index + 1] = subject ? 20 : 255;
      raw[index + 2] = subject ? 20 : 0;
    }
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const keyed = await keyImage(png, { key: "#00FF00" });
    expect(keyed.method).toBe("chroma");
    expect(keyed.key).toBe("#00FF00");
    const pixels = await sharp(keyed.png).ensureAlpha().raw().toBuffer();
    const alpha = (x: number, y: number) => pixels[(y * width + x) * 4 + 3];
    expect(alpha(1, 1)).toBe(0);
    expect(alpha(24, 24)).toBeGreaterThan(200);
  });

  it("keys the measured border green, including a soft contact shadow", async () => {
    const width = 48, height = 48;
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3;
      const subject = x > 18 && x < 30 && y > 18 && y < 30;
      const shadow = !subject && x > 16 && x < 32 && y > 16 && y < 34;
      raw[index] = subject ? 190 : shadow ? 18 : 0x17;
      raw[index + 1] = subject ? 30 : shadow ? 160 : 0xee;
      raw[index + 2] = subject ? 24 : shadow ? 18 : 0x17;
    }
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const keyed = await keyImage(png, { key: "auto" });
    expect(keyed.key).toBe("#17EE17");
    const pixels = await sharp(keyed.png).ensureAlpha().raw().toBuffer();
    const alpha = (x: number, y: number) => pixels[(y * width + x) * 4 + 3];
    expect(alpha(1, 1)).toBe(0);
    expect(alpha(17, 33)).toBeLessThan(40);
    expect(alpha(24, 24)).toBeGreaterThan(200);
  });

  it("picks a key that the prompt does not mention and prefers native alpha", () => {
    expect(chooseKeyHex("a green leaf")).toBe("#0000FF");
    expect(layerPrompt("ceramic cup", "#00FF00")).toContain("flat uniform #00FF00 background");
    expect(layerPrompt("ceramic cup")).toContain("no shadows");
    expect(supportsNativeTransparency({ image_generate: { background_allowed: ["transparent"] } })).toBe(true);
    expect(supportsNativeTransparency({ image_generate: { background_allowed: ["opaque"] } })).toBe(false);
  });
});
