import sharp from "sharp";

export interface KeyOptions {
  key?: string;
  similarity?: number;
  softness?: number;
  despill?: number;
  erode?: number;
  feather?: number;
  preferNative?: boolean;
  metric?: "rgb" | "chroma";
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

function chromaMatte(pixel: [number, number, number], key: [number, number, number], similarity: number, softness: number): number {
  const pixelHsv = hueSatValue(pixel), keyHsv = hueSatValue(key);
  if (pixelHsv.s >= 0.18 && hueDelta(pixelHsv.h, keyHsv.h) > 22) return 1;
  if (pixelHsv.v < 0.45 && pixelHsv.s < 0.85) return 1;
  const distance = chromaDistance(pixel, key);
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

function despill(rgb: [number, number, number], key: [number, number, number], alpha: number, amount: number): [number, number, number] {
  const keyIndex = key[0] >= key[1] && key[0] >= key[2] ? 0 : key[1] >= key[2] ? 1 : 2;
  const others = [0, 1, 2].filter(index => index !== keyIndex);
  const dominance = key[keyIndex]! - Math.max(key[others[0]!]!, key[others[1]!]!);
  if (dominance < 48) return rgb;
  const limit = Math.max(rgb[others[0]!]!, rgb[others[1]!]!);
  if (rgb[keyIndex]! <= limit) return rgb;
  const strength = (alpha >= 250 ? 0.45 : 0.9) * amount;
  const next: [number, number, number] = [...rgb];
  next[keyIndex] = Math.round(rgb[keyIndex]! + (limit - rgb[keyIndex]!) * strength);
  return next;
}

export function keyRaw(source: Uint8Array, width: number, height: number, key: [number, number, number], options: KeyOptions = {}): Uint8Array {
  const metric = options.metric ?? "rgb";
  const similarity = options.similarity ?? (metric === "chroma" ? 14 : 52);
  const softness = options.softness ?? (metric === "chroma" ? 10 : 88);
  const amount = options.despill ?? 1;
  const erode = options.erode ?? 1;
  const feather = options.feather ?? 1;
  const alpha = new Float32Array(width * height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const pixel: [number, number, number] = [source[i * 4]!, source[i * 4 + 1]!, source[i * 4 + 2]!];
    const matte = metric === "chroma"
      ? chromaMatte(pixel, key, similarity, softness)
      : (() => { const distance = colorDistance(pixel, key); return distance <= similarity ? 0 : distance >= similarity + softness ? 1 : (distance - similarity) / softness; })();
    const cleaned = despill(pixel, key, Math.round(matte * 255), amount);
    rgb[i * 3] = cleaned[0]; rgb[i * 3 + 1] = cleaned[1]; rgb[i * 3 + 2] = cleaned[2];
    alpha[i] = matte * (source[i * 4 + 3]! / 255);
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
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let value = feathered[i]!;
    if (value < 0.03) value = 0;
    else if (value > 0.97) value = 1;
    out[i * 4] = rgb[i * 3]!;
    out[i * 4 + 1] = rgb[i * 3 + 1]!;
    out[i * 4 + 2] = rgb[i * 3 + 2]!;
    out[i * 4 + 3] = Math.round(value * 255);
  }
  return out;
}

export async function keyImage(input: Buffer | string, options: KeyOptions = {}): Promise<{ png: Buffer; key: string; method: "native" | "chroma"; width: number; height: number }> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (options.preferNative !== false && borderTransparent(pixels, info.width, info.height)) {
    const png = await sharp(Buffer.from(pixels), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    return { png, key: "native", method: "native", width: info.width, height: info.height };
  }
  const auto = !options.key || options.key === "auto";
  const key = auto ? pickKeyColor(pixels, info.width, info.height) : parseHex(options.key || "#00FF00");
  const keyed = keyRaw(pixels, info.width, info.height, key, auto ? { ...options, metric: "chroma", similarity: options.similarity ?? 14, softness: options.softness ?? 10 } : { ...options, metric: "rgb" });
  const png = await sharp(Buffer.from(keyed), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  return { png, key: toHex(key), method: "chroma", width: info.width, height: info.height };
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
