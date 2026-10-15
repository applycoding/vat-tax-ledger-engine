/**
 * Money is always held as integer minor units (cents) to avoid floating point drift.
 * Rates are held as basis points (1% = 100 bp), so 23% is 2300 and 13.5% is 1350.
 */
export type Cents = number;
export type BasisPoints = number;

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer number of cents, got ${value}`);
  }
}

/** Tax on a net amount, rounded half up to the nearest cent (amounts are non-negative). */
export function applyRate(net: Cents, rate: BasisPoints): Cents {
  assertCents(net, "net");
  // Integer arithmetic: (net * rate + 5000) / 10000, floored. Safe for net below ~9e11 cents.
  return Math.floor((net * rate + 5000) / 10000);
}

export function formatCents(amount: Cents, currency: string): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  return `${sign}${currency} ${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
