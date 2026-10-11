import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { redact } from "./errors.js";

export interface OutputOptions { json?: boolean; jsonl?: boolean; output?: string; }
const schemaVersion = "easyai.cli/v1";
export async function emit(value: unknown, options: OutputOptions = {}): Promise<void> {
  const safe = redact(value);
  if (options.output) { const path = resolve(options.output); await writeFile(path, JSON.stringify({ schemaVersion, data: safe }, null, 2) + "\n", "utf8"); process.stdout.write(JSON.stringify({ schemaVersion, output: path }) + "\n"); return; }
  if (options.jsonl) { for (const item of Array.isArray(safe) ? safe : [safe]) process.stdout.write(JSON.stringify({ schemaVersion, data: item }) + "\n"); return; }
  if (options.json) { process.stdout.write(JSON.stringify({ schemaVersion, data: safe }, null, 2) + "\n"); return; }
  if (typeof safe !== "object") { process.stdout.write(String(safe) + "\n"); return; }
  if (Array.isArray(safe)) { for (const item of safe) process.stdout.write(`${summarize(item)}\n`); return; }
  process.stdout.write(`${summarize(safe)}\n`);
}
function summarize(value: unknown): string {
  if (!value || typeof value !== "object") return String(value);
  const o = value as Record<string, unknown>;
  if (o.pointsUsage) {
    const { pointsUsage, ...rest } = o;
    const u = pointsUsage as Record<string, any>;
    return `${summarize(rest)}\n余额=${u.total ?? '查询不可用'} 可用=${u.available ?? '接口未提供'} 预占=${u.reserved ?? '接口未提供'} 实际扣费=${u.actualPoints ?? (u.settlementStatus === 'pending' ? '待结算' : '接口未提供')} 退款=${u.refundedPoints ?? '接口未提供'}`;
  }
  const summary = Object.entries(o).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).slice(0, 8).map(([k, v]) => `${k}=${String(v)}`).join(" ") || JSON.stringify(o);
  if (Array.isArray(o.paths) && o.paths.length) return `${summary}\n${o.paths.join("\n")}`;
  if (Array.isArray(o.urls) && o.urls.length) return `${summary}\n${o.urls.join("\n")}`;
  return o.checks ? `${summary}\n${JSON.stringify(o.checks)}` : summary;
}
