import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function readDataFile<T>(name: string): T {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../data", name), resolve(here, "data", name)];
  let last: unknown;
  for (const path of candidates) {
    try { return JSON.parse(readFileSync(path, "utf8")) as T; }
    catch (error) {
      last = error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Missing data file ${name}: ${(last as Error)?.message || "not found"}`);
}
