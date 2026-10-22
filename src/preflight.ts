import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "./config.js";
import { CliError, ExitCode } from "./errors.js";

/* legacy payload binding utilities */
export interface Quote {
  quoteId: string; kind: "image" | "video"; payloadHash: string; payload: Record<string, unknown>;
  estimatedCost: number | null; currency: string; createdAt: string; expiresAt: string; source: "server" | "local";
  serverQuoteId?: string; scope?: string; submissionPath?: string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function payloadHash(payload: unknown): string { return createHash("sha256").update(canonical(JSON.parse(JSON.stringify(payload)))).digest("hex"); }
export async function saveQuote(quote: Quote): Promise<void> {
  const dir = join(configDir(), "quotes"); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${quote.quoteId.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`), JSON.stringify({ ...quote, payload: {} }, null, 2) + "\n", { mode: 0o600 });
}
export async function loadQuote(id: string): Promise<Quote> {
  try { return JSON.parse(await readFile(join(configDir(), "quotes", `${id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`), "utf8")) as Quote; }
  catch { throw new CliError(`Quote not found: ${id}`, ExitCode.Approval); }
}
export function localQuote(kind: Quote["kind"], payload: Record<string, unknown>): Quote {
  const now = Date.now();
  return { quoteId: `local-${randomUUID()}`, kind, payloadHash: payloadHash(payload), payload, estimatedCost: null, currency: "points", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60_000).toISOString(), source: "local" };
}
export function assertQuote(quote: Quote, payload?: unknown): void {
  if (quote.source !== "server" || !quote.serverQuoteId || !Number.isFinite(quote.estimatedCost) || Number(quote.estimatedCost) < 0 || !Number.isFinite(Date.parse(quote.expiresAt))) throw new CliError("A valid server cost quote is required. The preflight backend must be deployed before paid submission.", ExitCode.Approval);
  if (Date.parse(quote.expiresAt) <= Date.now()) throw new CliError("The preflight quote has expired; run preflight again.", ExitCode.Approval);
  if (payload && quote.payloadHash !== payloadHash(payload)) throw new CliError("The request changed after preflight; approval is invalid.", ExitCode.Approval);
}

