import { EasyAiApi } from './api.js';
export interface PointsUsage {
  total: number | null; reserved: number | null; available: number | null;
  actualPoints: number | null; refundedPoints: number | null;
  settlementStatus: 'provided' | 'pending' | 'unavailable';
  balanceStatus: 'available' | 'unavailable'; queriedAt: string; source: string;
}
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const round = (v: number) => Math.round(v * 1e8) / 1e8;
// The platform reports per-task accounting in a `billings` array whose amount
// lives under `billing_calculations` (charged) or `billing_discounts`
// (discounted/original). Fall back to a flat `billing` object for other shapes.
export function billingTotals(task: any): { actualPoints: number | null; refundedPoints: number | null } {
  const rows: any[] = Array.isArray(task?.billings) ? task.billings : Array.isArray(task?.billing) ? task.billing : [];
  let charged: number | null = null, refunded: number | null = null;
  for (const row of rows) {
    for (const group of [row?.billing_calculations, row?.billingCalculations, row?.billing_discounts, row?.billingDiscounts]) {
      if (!group || typeof group !== 'object') continue;
      let found = false;
      for (const entry of Object.values(group as Record<string, any>)) {
        const raw = entry?.amount ?? entry?.discountedAmount ?? entry?.originalAmount;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
        found = true;
        if (raw < 0 || entry?.type === 'refund' || entry?.refunded === true) refunded = (refunded ?? 0) + Math.abs(raw);
        else charged = (charged ?? 0) + raw;
      }
      if (found) break;
    }
  }
  return { actualPoints: charged === null ? null : round(charged), refundedPoints: refunded === null ? null : round(refunded) };
}
export function pointsUsage(value: any): PointsUsage {
  const task = value?.task ?? value?.data?.task ?? value?.data ?? value;
  const billing = task?.billing ?? value?.billing;
  const totals = billingTotals(task);
  const actualPoints = totals.actualPoints ?? number(billing?.actualPoints), refundedPoints = totals.refundedPoints ?? number(billing?.refundedPoints);
  const settled = actualPoints !== null || refundedPoints !== null;
  // A present-but-unpriced billing row means a charge exists but is not settled
  // yet; an empty or absent array stays unknown instead of implying a charge.
  const pending = billing?.status === 'pending' || (Array.isArray(task?.billings) && task.billings.length > 0 && !settled);
  return { total: null, reserved: null, available: null, actualPoints, refundedPoints,
    settlementStatus: settled ? 'provided' : pending ? 'pending' : 'unavailable',
    balanceStatus: 'unavailable', queriedAt: new Date().toISOString(), source: 'task.billings/billing; /v1/balance' };
}
export function withPointsUsage<T>(value: T) { return { ...(value as object), pointsUsage: pointsUsage(value) }; }
export function presentBalance(body: any): { total: number | null; raw: unknown } {
  const data = body?.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body;
  const total = typeof data?.total === "number" ? data.total : null;
  return { total, raw: body };
}

export async function usageResult(api: EasyAiApi, value: unknown) {
  const usage = pointsUsage(value);
  try {
    const response = await api.request<any>('GET', '/v1/balance', undefined, {}, 5000);
    const data = response?.data ?? response;
    usage.total = number(data?.total); usage.reserved = number(data?.balanceDetail?.reservedAmount);
    usage.available = number(data?.balanceDetail?.availableForNewTask);
    usage.balanceStatus = usage.total !== null ? 'available' : 'unavailable';
  } catch { /* Accounting is informational, never a generation gate. */ }
  return { ...(value && typeof value === 'object' ? value : { result: value }), pointsUsage: usage };
}
