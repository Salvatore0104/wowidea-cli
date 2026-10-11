import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { chooseKeyHex, keyImage, layerPrompt, supportsNativeTransparency } from "../src/chroma.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

function edgeGreenRatio(data: Buffer, width: number, height: number): number {
  const bound = new Uint8Array(width * height);
  const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3]!;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = alphaAt(x, y);
    let lo = alpha, hi = alpha;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) { lo = 0; continue; }
      const neighbor = alphaAt(xx, yy);
      if (neighbor < lo) lo = neighbor;
      if (neighbor > hi) hi = neighbor;
    }
    if (hi >= 200 && lo <= 48) bound[y * width + x] = 1;
  }
  const seen = new Uint8Array(width * height);
  let opaque = 0, green = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!bound[y * width + x]) continue;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const index = yy * width + xx;
      if (seen[index]) continue;
      seen[index] = 1;
      const offset = index * 4;
      const r = data[offset]!, g = data[offset + 1]!, b = data[offset + 2]!, a = data[offset + 3]!;
      if (a < 180) continue;
      opaque += 1;
      if (g > r + 12 && g > b + 12) green += 1;
    }
  }
  return opaque ? green / opaque : 0;
}

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

  it("despills yellow-green edge pixels and neutralizes a connected screen shadow", async () => {
    const width = 72, height = 72;
    const raw = Buffer.alloc(width * height * 3);
    const paint = (x: number, y: number, rgb: [number, number, number]) => {
      const index = (y * width + x) * 3;
      raw[index] = rgb[0]; raw[index + 1] = rgb[1]; raw[index + 2] = rgb[2];
    };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paint(x, y, [0x17, 0xee, 0x17]);
    for (let y = 18; y <= 50; y++) for (let x = 16; x <= 40; x++) paint(x, y, [236, 236, 236]);
    for (let y = 16; y <= 52; y++) {
      paint(14, y, [186, 230, 70]); paint(15, y, [170, 220, 55]);
      paint(41, y, [186, 230, 70]); paint(42, y, [170, 220, 55]);
    }
    for (let x = 16; x <= 40; x++) {
      paint(x, 16, [186, 230, 70]); paint(x, 17, [170, 220, 55]);
      paint(x, 51, [186, 230, 70]); paint(x, 52, [170, 220, 55]);
    }
    paint(28, 34, [40, 80, 30]);
    paint(30, 34, [164, 141, 3]);
    for (let y = 24; y <= 40; y++) for (let x = 50; x <= 62; x++) paint(x, y, [7, 157, 6]);
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    const keyed = await keyImage(png, { key: "auto" });
    const pixels = await sharp(keyed.png).ensureAlpha().raw().toBuffer();
    const sample = (x: number, y: number) => { const index = (y * width + x) * 4; return { r: pixels[index]!, g: pixels[index + 1]!, b: pixels[index + 2]!, a: pixels[index + 3]! }; };
    expect(edgeGreenRatio(pixels, width, height)).toBeLessThan(0.12);
    expect(sample(1, 1).a).toBe(0);
    expect(sample(28, 34).a).toBe(255);
    expect(sample(28, 34).g).toBeGreaterThan(sample(28, 34).r + 20);
    expect(sample(30, 34).a).toBe(255);
    expect(sample(30, 34).r).toBeGreaterThan(140);
    const shadow = sample(60, 32);
    expect(Math.abs(shadow.r - shadow.g)).toBeLessThan(8);
    expect(Math.abs(shadow.g - shadow.b)).toBeLessThan(8);
    expect(shadow.a).toBeGreaterThan(20);
    expect(shadow.a).toBeLessThan(200);
    const removed = await keyImage(png, { key: "auto", shadow: "remove" });
    const removedPixels = await sharp(removed.png).ensureAlpha().raw().toBuffer();
    expect(removedPixels[(32 * width + 60) * 4 + 3]).toBe(0);
    const kept = await keyImage(png, { key: "auto", shadow: "keep" });
    const keptPixels = await sharp(kept.png).ensureAlpha().raw().toBuffer();
    const keptIndex = (32 * width + 60) * 4;
    expect(keptPixels[keptIndex + 3]).toBe(255);
    expect(keptPixels[keptIndex + 1]).toBeGreaterThan(keptPixels[keptIndex]! + 40);
  });

  it("keeps the lemon underside and plant leaves while neutralizing the floor shadow", async () => {
    const lemon = await keyImage(await readFile(resolve(fixtures, "lemon.png")), { key: "auto" });
    expect(lemon.method).toBe("native");
    const lemonPixels = await sharp(lemon.png).ensureAlpha().raw().toBuffer();
    const lemonAt = (x: number, y: number) => { const index = (y * lemon.width + x) * 4; return { r: lemonPixels[index]!, g: lemonPixels[index + 1]!, b: lemonPixels[index + 2]!, a: lemonPixels[index + 3]! }; };
    const underside = lemonAt(558, 691);
    expect(underside.a).toBeGreaterThan(180);
    expect(underside.r).toBeGreaterThan(140);
    expect(underside.g).toBeLessThan(underside.r);
    expect(edgeGreenRatio(lemonPixels, lemon.width, lemon.height)).toBeLessThan(0.12);

    const source = await readFile(resolve(fixtures, "plant_source.jpeg"));
    const sourceRaw = await sharp(source).ensureAlpha().raw().toBuffer();
    const plant = await keyImage(source, { key: "auto" });
    expect(plant.method).toBe("chroma");
    const plantPixels = await sharp(plant.png).ensureAlpha().raw().toBuffer();
    const width = plant.width, height = plant.height;
    expect(edgeGreenRatio(plantPixels, width, height)).toBeLessThan(0.12);
    const fruit = plantPixels.subarray((694 * width + 690) * 4, (694 * width + 690) * 4 + 4);
    expect(fruit[3]).toBeGreaterThan(200);
    expect(fruit[0]).toBeGreaterThan(180);
    expect(fruit[1]).toBeLessThan(fruit[0]! + 40);

    let leaf = false;
    for (let y = 8; y < height - 8 && !leaf; y += 2) for (let x = 8; x < width - 8; x += 2) {
      const index = (y * width + x) * 4;
      const r = plantPixels[index]!, g = plantPixels[index + 1]!, b = plantPixels[index + 2]!, a = plantPixels[index + 3]!;
      if (a < 250 || g < r + 35 || g < b + 35) continue;
      let inset = true;
      for (let dy = -6; dy <= 6 && inset; dy++) for (let dx = -6; dx <= 6; dx++) {
        if (plantPixels[((y + dy) * width + x + dx) * 4 + 3]! < 250) inset = false;
      }
      if (inset) leaf = true;
    }
    expect(leaf).toBe(true);

    let floor = 0, neutral = 0;
    for (let y = 760; y < 860; y++) for (let x = 400; x < 820; x++) {
      const sourceIndex = (y * width + x) * 4;
      const sr = sourceRaw[sourceIndex]!, sg = sourceRaw[sourceIndex + 1]!, sb = sourceRaw[sourceIndex + 2]!;
      if (!(sg > 90 && sr < 40 && sb < 35 && sg > sr + 50)) continue;
      floor += 1;
      const out = sourceIndex;
      const r = plantPixels[out]!, g = plantPixels[out + 1]!, b = plantPixels[out + 2]!, a = plantPixels[out + 3]!;
      if (a < 30 || (Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && g < 120)) neutral += 1;
    }
    expect(floor).toBeGreaterThan(1000);
    expect(neutral / floor).toBeGreaterThan(0.85);
  });
});
