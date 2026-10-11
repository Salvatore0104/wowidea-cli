import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EasyAiApi } from './api.js';
import { configDir } from './config.js';
import { CliError, ExitCode } from './errors.js';
export interface PriceRule { model: string; operation: 'image' | 'video'; unit: 'request' | 'image' | 'second'; points: number; when?: Record<string, string | number | boolean>; }
export interface PriceBook { schemaVersion: 'wowidea.prices/v1'; source: string; updatedAt: string; rules: PriceRule[]; }
export function validatePrices(value: any): asserts value is PriceBook {
  if (value?.schemaVersion !== 'wowidea.prices/v1' || typeof value.source !== 'string' || !value.source.trim() || !Number.isFinite(Date.parse(value.updatedAt)) || !Array.isArray(value.rules)) throw new CliError('Expected a sourced, dated wowidea.prices/v1 snapshot.', ExitCode.Usage);
  for (const r of value.rules) if (!r || typeof r.model !== 'string' || !['image', 'video'].includes(r.operation) || !['request', 'image', 'second'].includes(r.unit) || typeof r.points !== 'number' || !Number.isFinite(r.points) || r.points < 0 || (r.when && (typeof r.when !== 'object' || Array.isArray(r.when) || Object.values(r.when).some(v => !['string','number','boolean'].includes(typeof v))))) throw new CliError('Invalid price rule.', ExitCode.Usage);
}
export async function loadPrices(file?: string): Promise<PriceBook | null> {
  try { const value = JSON.parse(await readFile(file || join(configDir(), 'prices.json'), 'utf8')); validatePrices(value); return value; }
  catch (e) { if (file) throw e; return null; }
}
export async function importPrices(file: string) { const value = await loadPrices(file); await mkdir(configDir(), { recursive: true }); await writeFile(join(configDir(), 'prices.json'), JSON.stringify(value, null, 2)); return value; }
export async function syncPrices(url?: string): Promise<PriceBook | null> {
  const settingsPath = join(configDir(), 'price-source.json');
  const settings = await readFile(settingsPath, 'utf8').then(JSON.parse).catch(() => ({}));
  const target = url || settings.url;
  if (!target) return loadPrices();
  if (!url && Date.now() - (settings.checkedAt || 0) < 300000) return loadPrices();
  const parsed = new URL(target);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search) throw new CliError('Pricing URL must be HTTPS without credentials or query parameters.', ExitCode.Usage);
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error(`Pricing HTTP ${response.status}`);
    const value = await response.json(); validatePrices(value);
    await mkdir(configDir(), { recursive: true });
    await writeFile(join(configDir(), 'prices.json'), JSON.stringify(value, null, 2));
    await writeFile(settingsPath, JSON.stringify({ url: target, checkedAt: Date.now() }));
    return value;
  } catch (error) { if (url) throw new CliError(`Price sync failed: ${(error as Error).message}`, ExitCode.Service); return loadPrices(); }
}
export function estimate(book: PriceBook | null, model: string, operation: 'image' | 'video', payload: Record<string, any>) {
  const base = { estimatedPoints: null as number | null, source: book?.source ?? null, updatedAt: book?.updatedAt ?? null, stale: book ? Date.now() - Date.parse(book.updatedAt) > 86400000 : false, reason: 'Price unavailable' };
  const matching = book?.rules.filter(r => r.model === model && r.operation === operation && Object.entries(r.when || {}).every(([k,v]) => payload[k] === v)) || [];
  matching.sort((a,b) => Object.keys(b.when || {}).length - Object.keys(a.when || {}).length);
  const r = matching[0]; if (!r) return base;
  if (matching[1] && Object.keys(r.when || {}).length === Object.keys(matching[1].when || {}).length) return { ...base, reason: 'Ambiguous matching price rules' };
  const amount = r.unit === 'second' ? payload.duration : r.unit === 'image' ? payload.n ?? 1 : 1;
  if (!Number.isFinite(amount) || amount <= 0) return { ...base, reason: 'Billing quantity is unknown' };
  return { ...base, estimatedPoints: Math.round(r.points * amount * 1e8) / 1e8, reason: `${r.points} points/${r.unit}`, unit: r.unit, quantity: amount };
}

export interface PlatformEstimate {
  estimatedPoints: number; raw: number | null; reason: string;
  source: string; discount: { originalAmount: number; discountedAmount: number; factor: number } | null;
}
const asNumber = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
/**
 * POST /api/integration-platform/models/estimatedBilling. This path is outside
 * /v1, accepts an API key, and does not charge. The model list has no prices.
 * Returns null when the endpoint is unavailable so callers can fall back.
 */
export async function platformEstimate(api: EasyAiApi, params: Record<string, unknown>): Promise<PlatformEstimate | null> {
  try {
    const response = await api.request<any>('POST', '/integration-platform/models/estimatedBilling', { params }, {}, 15000);
    const body = response?.data ?? response;
    const amount = asNumber(body?.amount ?? body?.estimatedPower);
    if (amount === null || amount < 0) return null;
    const calculation = body?.calculation ?? {};
    const raw = asNumber(calculation?.rawAmount);
    const info = calculation?.platformModelDiscount ?? calculation?.userBillingDiscount;
    const factor = asNumber(info?.combinedDiscountFactor ?? info?.userDiscountFactor);
    const discounted = factor !== null && factor > 0 && factor < 1;
    return {
      estimatedPoints: amount,
      raw,
      reason: discounted ? `${amount} points (${(factor * 10).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 折 of ${raw ?? amount})` : `${amount} points (platform estimate)`,
      source: 'platform /integration-platform/models/estimatedBilling',
      discount: discounted ? { originalAmount: raw ?? amount, discountedAmount: amount, factor } : null,
    };
  } catch { return null; }
}
