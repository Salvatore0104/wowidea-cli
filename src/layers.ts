import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chooseKeyHex, keyImage, layerPrompt } from "./chroma.js";

export interface LayerRequest { name: string; prompt?: string; }
export interface LayerResult { name: string; path: string; method: "native" | "chroma"; key: string; prompt: string; }

export function planLayers(layers: string[], scene = ""): Array<{ name: string; prompt: string; key: string }> {
  return layers.filter(Boolean).map(name => {
    const key = chooseKeyHex(`${scene} ${name}`);
    return { name, key, prompt: layerPrompt(scene ? `${name} from ${scene}` : name, key) };
  });
}

export async function renderLayers(options: {
  layers: LayerRequest[];
  scene?: string;
  outDir: string;
  key?: string;
  native?: boolean;
  generate: (request: { name: string; prompt: string; key: string }) => Promise<Buffer>;
}): Promise<{ layers: LayerResult[] }> {
  await mkdir(options.outDir, { recursive: true });
  const planned = options.layers.map(layer => {
    const key = options.key && options.key !== "auto" ? options.key : chooseKeyHex(`${options.scene || ""} ${layer.prompt || layer.name}`);
    const prompt = layer.prompt || layerPrompt(options.scene ? `${layer.name} from ${options.scene}` : layer.name, key);
    return { name: layer.name, key, prompt };
  });
  const layers: LayerResult[] = [];
  for (const layer of planned) {
    const raw = await options.generate(layer);
    const keyed = options.native
      ? await keyImage(raw, { preferNative: true, key: layer.key })
      : await keyImage(raw, { preferNative: true, key: "auto" });
    const path = resolve(options.outDir, `${layer.name.replace(/[^\w.-]+/g, "_") || "layer"}.png`);
    await writeFile(path, keyed.png);
    layers.push({ name: layer.name, path, method: keyed.method, key: keyed.key, prompt: layer.prompt });
  }
  return { layers };
}
