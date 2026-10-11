import sharp from "sharp";

export type ShadowMode = "keep" | "remove" | "neutral";

export interface KeyOptions {
  key?: string;
  similarity?: number;
  softness?: number;
  despill?: number;
  erode?: number;
  feather?: number;
  preferNative?: boolean;
  metric?: "rgb" | "chroma";
  /** keep leaves the spill color, remove drops it, neutral is a gray semi-transparent shadow. */
  shadow?: ShadowMode;
  /** Dilation radius of the alpha boundary, in pixels. */
  edgeBand?: number;
}

const NAMED: Record<string, [number, number, number]> = {
  green: [0, 255, 0],
  blue: [0, 0, 255],
  magenta: [255, 0, 255],
  black: [0, 0, 0],
  white: [255, 255, 255],
};

export function parseHex(value: string): [number, number, number] {
  const named = NAMED[value.trim().toLowerCase()];
  if (named) return named;
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`Key color must be #RRGGBB or auto, got ${value}`);
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

export function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function chromaChannels([r, g, b]: [number, number, number]): [number, number] {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return [cb, cr];
}

export function chromaDistance(a: [number, number, number], b: [number, number, number]): number {
  const [cb1, cr1] = chromaChannels(a), [cb2, cr2] = chromaChannels(b);
  return Math.hypot(cb1 - cb2, cr1 - cr2);
}

function hueSatValue([r, g, b]: [number, number, number]): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), span = max - min;
  const v = max / 255;
  const s = max === 0 ? 0 : span / max;
  let h = 0;
  if (span !== 0) {
    if (max === r) h = ((g - b) / span) % 6;
    else if (max === g) h = (b - r) / span + 2;
    else h = (r - g) / span + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

function hueDelta(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}

function chromaMatte(pixel: [number, number, number], key: [number, number, number], similarity: number, softness: number, protect: boolean): number {
  if (protect) {
    const pixelHsv = hueSatValue(pixel), keyHsv = hueSatValue(key);
    // Hue protection keeps yellow fruit and brown interiors opaque. It must not
    // run inside the edge band, where yellow-green spill sits just past 22°.
    if (pixelHsv.s >= 0.18 && hueDelta(pixelHsv.h, keyHsv.h) > 22) return 1;
    if (pixelHsv.v < 0.45 && pixelHsv.s < 0.85) return 1;
  }
  const distance = chromaDistance(pixel, key);
  if (distance <= similarity) return 0;
  if (distance >= similarity + softness) return 1;
  return (distance - similarity) / softness;
}

function matteOf(pixel: [number, number, number], key: [number, number, number], metric: "rgb" | "chroma", similarity: number, softness: number, protect: boolean): number {
  if (metric === "chroma") return chromaMatte(pixel, key, similarity, softness, protect);
  const distance = colorDistance(pixel, key);
  if (distance <= similarity) return 0;
  if (distance >= similarity + softness) return 1;
  return (distance - similarity) / softness;
}

export function chooseKeyHex(prompt = ""): string {
  const text = prompt.toLowerCase();
  const banned = new Set<string>();
  if (/green|绿|foliage|grass|emerald|叶子|草地/.test(text)) banned.add("#00FF00");
  if (/blue|蓝|sky|ocean|天空|海洋/.test(text)) banned.add("#0000FF");
  if (/magenta|pink|粉|品红|紫红/.test(text)) banned.add("#FF00FF");
  if (/black|黑|剪影|silhouette/.test(text)) banned.add("#000000");
  if (/white|白|雪/.test(text)) banned.add("#FFFFFF");
  return ["#00FF00", "#0000FF", "#FF00FF", "#000000", "#FFFFFF"].find(color => !banned.has(color)) || "#0000FF";
}

export function layerPrompt(subject: string, keyHex = "#00FF00"): string {
  return `${subject}, isolated subject, centered, fully visible, flat uniform ${keyHex} background, no shadows, no contact shadow, no floor, no gradient, no environment, no text, studio cutout`;
}

function mean(colors: number[][]): [number, number, number] {
  if (!colors.length) return [0, 255, 0];
  const sum = colors.reduce((acc, rgb) => [acc[0]! + (rgb[0] ?? 0), acc[1]! + (rgb[1] ?? 0), acc[2]! + (rgb[2] ?? 0)], [0, 0, 0]);
  return sum.map(value => Math.round(value / colors.length)) as [number, number, number];
}

export function pickKeyColor(data: Uint8Array, width: number, height: number): [number, number, number] {
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.08));
  const border: number[][] = [];
  const buckets = new Map<string, { rgb: [number, number, number]; n: number }>();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    const rgb: [number, number, number] = [data[index]!, data[index + 1]!, data[index + 2]!];
    const edge = x < band || y < band || x >= width - band || y >= height - band;
    if (edge) border.push(rgb);
    else if (x > width * 0.2 && x < width * 0.8 && y > height * 0.2 && y < height * 0.8) {
      const q: [number, number, number] = rgb.map(value => Math.round(value / 32) * 32) as [number, number, number];
      const key = q.join(",");
      const bucket = buckets.get(key) || { rgb: q, n: 0 };
      bucket.n += 1;
      buckets.set(key, bucket);
    }
  }
  const borderMean = mean(border);
  const borderSpread = border.reduce((max, rgb) => Math.max(max, colorDistance(rgb as [number, number, number], borderMean)), 0);
  const dominant = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 4);
  const subjectDistance = (color: [number, number, number]) => dominant.length ? Math.min(...dominant.map(item => colorDistance(color, item.rgb))) : 999;
  if (border.length && borderSpread <= 36) return borderMean;
  const candidates: [number, number, number][] = [[0, 255, 0], [0, 0, 255], [255, 0, 255], [0, 0, 0], [255, 255, 255], borderMean];
  let best = candidates[0]!;
  let bestScore = -Infinity;
  for (const color of candidates) {
    const away = subjectDistance(color);
    if (away < 70) continue;
    const score = away * 2 - colorDistance(color, borderMean);
    if (score > bestScore) { bestScore = score; best = color; }
  }
  if (bestScore === -Infinity) best = [...candidates].sort((a, b) => subjectDistance(b) - subjectDistance(a))[0]!;
  return best;
}

function borderTransparent(data: Uint8Array, width: number, height: number): boolean {
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.06));
  let clear = 0, total = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= band && y >= band && x < width - band && y < height - band) continue;
    total += 1;
    if (data[(y * width + x) * 4 + 3]! < 16) clear += 1;
  }
  return total > 0 && clear / total > 0.7;
}

function keyChannel(key: [number, number, number]): number {
  return key[0] >= key[1] && key[0] >= key[2] ? 0 : key[1] >= key[2] ? 1 : 2;
}

function chromaVector([r, g, b]: [number, number, number]): [number, number] {
  const [cb, cr] = chromaChannels([r, g, b]);
  return [cb - 128, cr - 128];
}

function chromaCosine(a: [number, number, number], b: [number, number, number]): number {
  const va = chromaVector(a), vb = chromaVector(b);
  const ma = Math.hypot(va[0], va[1]), mb = Math.hypot(vb[0], vb[1]);
  if (ma < 1 || mb < 1) return 0;
  return (va[0] * vb[0] + va[1] * vb[1]) / (ma * mb);
}

function isScreenShadow(pixel: [number, number, number], key: [number, number, number]): boolean {
  const pixelHsv = hueSatValue(pixel), keyHsv = hueSatValue(key);
  if (keyHsv.s < 0.35 || pixelHsv.s < 0.78) return false;
  if (pixelHsv.v < 0.06 || pixelHsv.v >= keyHsv.v * 0.82) return false;
  if (hueDelta(pixelHsv.h, keyHsv.h) > 16) return false;
  if (Math.hypot(...chromaVector(pixel)) < 26) return false;
  return chromaCosine(pixel, key) >= 0.975;
}

function neutralShadow(pixel: [number, number, number], key: [number, number, number]): { rgb: [number, number, number]; alpha: number } {
  const pixelV = hueSatValue(pixel).v;
  const keyV = Math.max(0.2, hueSatValue(key).v);
  const darkness = Math.min(1, Math.max(0, 1 - pixelV / keyV));
  const luma = 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
  const shade = Math.round(Math.min(80, luma * 0.45));
  const alpha = Math.min(0.72, Math.max(0.18, 0.16 + darkness * 0.62));
  return { rgb: [shade, shade, shade], alpha };
}

function edgeDespill(rgb: [number, number, number], key: [number, number, number], amount: number): [number, number, number] {
  if (amount <= 0) return rgb;
  const keyIndex = keyChannel(key);
  const keyHsv = hueSatValue(key);
  const others = [0, 1, 2].filter(index => index !== keyIndex);
  const limit = Math.max(rgb[others[0]!]!, rgb[others[1]!]!);
  if (rgb[keyIndex]! <= limit) return rgb;
  let allowance = 0;
  if (keyHsv.s >= 0.25) {
    const delta = hueDelta(hueSatValue(rgb).h, keyHsv.h);
    if (delta > 88) return rgb;
    // Allowance grows as the pixel leaves the key hue, so pure spill clamps to
    // max(R,B) and a yellow subject is left alone.
    allowance = delta * 0.2;
  }
  const target = Math.min(rgb[keyIndex]!, limit + allowance);
  const next: [number, number, number] = [...rgb];
  next[keyIndex] = Math.round(rgb[keyIndex]! + (target - rgb[keyIndex]!) * Math.min(1, amount));
  return next;
}

const NEIGHBORS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function floodShadow(rgb: Uint8Array, alpha: Float32Array, width: number, height: number, key: [number, number, number]): Uint8Array {
  const count = width * height;
  const shadow = new Uint8Array(count);
  const seen = new Uint8Array(count);
  const queue: number[] = [];
  for (let i = 0; i < count; i++) if (alpha[i]! < 0.06) { seen[i] = 1; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head]!;
    const x = index % width, y = (index / width) | 0;
    for (const [dx, dy] of NEIGHBORS) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      const next = yy * width + xx;
      if (seen[next]) continue;
      seen[next] = 1;
      const pixel = pixelAt(rgb, next);
      if (!isScreenShadow(pixel, key)) continue;
      shadow[next] = 1;
      queue.push(next);
    }
  }
  return shadow;
}

function alphaBoundary(alpha: Float32Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = alpha[y * width + x]!;
    let lo = value, hi = value;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) { lo = 0; continue; }
      const neighbor = alpha[yy * width + xx]!;
      if (neighbor < lo) lo = neighbor;
      if (neighbor > hi) hi = neighbor;
    }
    if (hi >= 0.82 && lo <= 0.5 && hi - lo >= 0.35) mask[y * width + x] = 1;
  }
  return mask;
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    const y0 = Math.max(0, y - radius), y1 = Math.min(height - 1, y + radius);
    const x0 = Math.max(0, x - radius), x1 = Math.min(width - 1, x + radius);
    for (let yy = y0; yy <= y1; yy++) out.fill(1, yy * width + x0, yy * width + x1 + 1);
  }
  return out;
}

function pixelAt(rgb: Uint8Array, index: number): [number, number, number] {
  return [rgb[index * 3]!, rgb[index * 3 + 1]!, rgb[index * 3 + 2]!];
}

function writeRgb(rgb: Uint8Array, index: number, pixel: [number, number, number]) {
  rgb[index * 3] = pixel[0]; rgb[index * 3 + 1] = pixel[1]; rgb[index * 3 + 2] = pixel[2];
}

function refineMatte(source: Uint8Array, rgb: Uint8Array, alpha: Float32Array, width: number, height: number, key: [number, number, number], options: KeyOptions, rekeyEdge: boolean): void {
  const metric = options.metric ?? "rgb";
  const similarity = options.similarity ?? (metric === "chroma" ? 14 : 52);
  const softness = options.softness ?? (metric === "chroma" ? 10 : 88);
  const amount = options.despill ?? 1;
  const shadowMode = options.shadow ?? "neutral";
  const radius = options.edgeBand ?? 3;
  const shadow = floodShadow(rgb, alpha, width, height, key);
  if (shadowMode === "remove") {
    for (let i = 0; i < shadow.length; i++) if (shadow[i]) alpha[i] = 0;
  } else if (shadowMode === "neutral") {
    for (let i = 0; i < shadow.length; i++) if (shadow[i]) alpha[i] = Math.min(alpha[i]!, neutralShadow(pixelAt(rgb, i), key).alpha);
  }
  const band = dilate(alphaBoundary(alpha, width, height), width, height, radius);
  const edgeSoftness = Math.max(softness + 28, softness * 3);
  for (let i = 0; i < width * height; i++) {
    if (shadow[i]) {
      if (shadowMode === "neutral") writeRgb(rgb, i, neutralShadow(pixelAt(rgb, i), key).rgb);
      else if (shadowMode === "remove") writeRgb(rgb, i, [0, 0, 0]);
      continue;
    }
    const pixel = pixelAt(rgb, i);
    if (rekeyEdge && band[i]) alpha[i] = Math.min(alpha[i]!, matteOf(pixel, key, metric, similarity, edgeSoftness, false) * (source[i * 4 + 3]! / 255));
    if (amount > 0 && (band[i] || alpha[i]! < 0.98)) writeRgb(rgb, i, edgeDespill(pixel, key, amount));
  }
}

function snapAlpha(alpha: Float32Array, rgb: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let value = alpha[i]!;
    if (value < 0.03) value = 0;
    else if (value > 0.97) value = 1;
    out[i * 4] = rgb[i * 3]!;
    out[i * 4 + 1] = rgb[i * 3 + 1]!;
    out[i * 4 + 2] = rgb[i * 3 + 2]!;
    out[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, value)) * 255);
  }
  return out;
}

export function keyRaw(source: Uint8Array, width: number, height: number, key: [number, number, number], options: KeyOptions = {}): Uint8Array {
  const metric = options.metric ?? "rgb";
  const similarity = options.similarity ?? (metric === "chroma" ? 14 : 52);
  const softness = options.softness ?? (metric === "chroma" ? 10 : 88);
  const erode = options.erode ?? 1;
  const feather = options.feather ?? 1;
  const alpha = new Float32Array(width * height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const pixel: [number, number, number] = [source[i * 4]!, source[i * 4 + 1]!, source[i * 4 + 2]!];
    writeRgb(rgb, i, pixel);
    alpha[i] = matteOf(pixel, key, metric, similarity, softness, true) * (source[i * 4 + 3]! / 255);
  }
  const eroded = new Float32Array(alpha);
  if (erode > 0) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let min = 1;
      for (let dy = -erode; dy <= erode; dy++) for (let dx = -erode; dx <= erode; dx++) {
        const xx = Math.min(width - 1, Math.max(0, x + dx));
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        min = Math.min(min, alpha[yy * width + xx]!);
      }
      eroded[y * width + x] = min;
    }
  }
  const feathered = new Float32Array(eroded);
  if (feather > 0) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -feather; dy <= feather; dy++) for (let dx = -feather; dx <= feather; dx++) {
        const xx = Math.min(width - 1, Math.max(0, x + dx));
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        sum += eroded[yy * width + xx]!;
        count += 1;
      }
      feathered[y * width + x] = sum / count;
    }
  }
  refineMatte(source, rgb, feathered, width, height, key, { ...options, metric, similarity, softness }, true);
  return snapAlpha(feathered, rgb, width, height);
}

function refineExistingAlpha(source: Uint8Array, width: number, height: number, key: [number, number, number], options: KeyOptions): Uint8Array {
  const alpha = new Float32Array(width * height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    writeRgb(rgb, i, [source[i * 4]!, source[i * 4 + 1]!, source[i * 4 + 2]!]);
    alpha[i] = source[i * 4 + 3]! / 255;
  }
  refineMatte(source, rgb, alpha, width, height, key, options, false);
  return snapAlpha(alpha, rgb, width, height);
}

export async function keyImage(input: Buffer | string, options: KeyOptions = {}): Promise<{ png: Buffer; key: string; method: "native" | "chroma"; width: number; height: number }> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const auto = !options.key || options.key === "auto";
  const key = auto ? pickKeyColor(pixels, info.width, info.height) : parseHex(options.key || "#00FF00");
  const native = options.preferNative !== false && borderTransparent(pixels, info.width, info.height);
  const keyed = native
    ? refineExistingAlpha(pixels, info.width, info.height, key, options)
    : keyRaw(pixels, info.width, info.height, key, auto ? { ...options, metric: "chroma", similarity: options.similarity ?? 14, softness: options.softness ?? 10 } : { ...options, metric: "rgb" });
  const png = await sharp(Buffer.from(keyed), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { png, key: toHex(key), method: native ? "native" : "chroma", width: info.width, height: info.height };
}

export function supportsNativeTransparency(capabilities: unknown): boolean {
  const root = capabilities && typeof capabilities === "object" ? capabilities as Record<string, unknown> : {};
  const bag = (root.capabilities && typeof root.capabilities === "object" ? root.capabilities : root) as Record<string, unknown>;
  return Object.values(bag).some(value => {
    if (!value || typeof value !== "object") return false;
    const mode = value as Record<string, unknown>;
    const backgrounds = mode.background_allowed || mode.background_options;
    return mode.native_transparency === true || mode.supports_alpha === true || (Array.isArray(backgrounds) && backgrounds.includes("transparent"));
  });
}
