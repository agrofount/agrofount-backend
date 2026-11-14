/** Percent used when a product location has no commission rate of its own. */
export const DEFAULT_REFERRAL_COMMISSION_RATE = 0.7;

/** Upper limit on the voucher issued for a single referral, in naira. */
export const MAX_REFERRAL_COMMISSION = 10000;

export interface CommissionLine {
  /** Product location id the line was bought from. */
  id: string;
  price: number | string;
  quantity: number | string;
}

/**
 * Referral bonus for an order: each line earns its product location's
 * commission rate (percent), lines from locations without a rate use the
 * default, and the total is rounded to whole naira and capped.
 */
export function computeReferralCommission(
  items: CommissionLine[],
  rates: Map<string, number | string | null>,
): number {
  let total = 0;
  for (const item of items ?? []) {
    const stored = rates.get(item.id);
    const rate =
      stored === null || stored === undefined
        ? DEFAULT_REFERRAL_COMMISSION_RATE
        : Number(stored);
    const lineValue = Number(item.price) * Number(item.quantity);
    if (!Number.isFinite(lineValue) || !Number.isFinite(rate)) continue;
    total += (lineValue * rate) / 100;
  }
  return Math.min(Math.round(total), MAX_REFERRAL_COMMISSION);
}
