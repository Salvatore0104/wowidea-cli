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

  it("keeps dark yellow, brown, and dark green opaque and removes a 1px green fringe", async () => {
    const width = 48, height = 48;
    const raw = Buffer.alloc(width * height * 3);
    const paint = (x: number, y: number, rgb: [number, number, number]) => {
      const index = (y * width + x) * 3;
      raw[index] = rgb[0]; raw[index + 1] = rgb[1]; raw[index + 2] = rgb[2];
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, [0x17, 0xee, 0x17]);
    for (let y = 12; y < 36; y++) for (let x = 12; x < 36; x++) paint(x, y, [164, 141, 3]);
    for (let y = 12; y < 36; y++) { paint(11, y, [26, 234, 24]); paint(36, y, [26, 234, 24]); }
    for (let x = 12; x < 36; x++) { paint(x, 11, [26, 234, 24]); paint(x, 36, [26, 234, 24]); }
    paint(20, 20, [164, 141, 3]);
    paint(24, 24, [40, 80, 30]);
    paint(28, 28, [92, 54, 18]);
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const keyed = await keyImage(png, { key: "auto" });
    expect(keyed.key).toBe("#17EE17");
    const pixels = await sharp(keyed.png).ensureAlpha().raw().toBuffer();
    const sample = (x: number, y: number) => { const index = (y * width + x) * 4; return { r: pixels[index]!, g: pixels[index + 1]!, b: pixels[index + 2]!, a: pixels[index + 3]! }; };
    expect(sample(1, 1).a).toBe(0);
    expect(sample(11, 24).a).toBeLessThan(40);
    expect(sample(11, 24).g).toBeLessThan(80);
    expect(sample(20, 20).a).toBe(255);
    expect(sample(24, 24).a).toBe(255);
    expect(sample(28, 28).a).toBe(255);
    const explicit = await keyImage(png, { key: "#17EE17" });
    const explicitPixels = await sharp(explicit.png).ensureAlpha().raw().toBuffer();
    expect(explicitPixels[(20 * width + 20) * 4 + 3]).toBe(255);
  });

  it("picks a key that the prompt does not mention and prefers native alpha", () => {
    expect(chooseKeyHex("a green leaf")).toBe("#0000FF");
    expect(layerPrompt("ceramic cup", "#00FF00")).toContain("flat uniform #00FF00 background");
    expect(layerPrompt("ceramic cup")).toContain("no shadows");
    expect(supportsNativeTransparency({ image_generate: { background_allowed: ["transparent"] } })).toBe(true);
    expect(supportsNativeTransparency({ image_generate: { background_allowed: ["opaque"] } })).toBe(false);
  });
});
