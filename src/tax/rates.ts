import type { BasisPoints } from "../money";

/**
 * Illustrative VAT rate table. Rates are a snapshot for demo purposes and are NOT a
 * substitute for an authoritative, dated rate source. Always verify against Revenue.ie
 * and the EU TEDB before relying on any figure.
 */
export type RateCategory = "standard" | "reduced" | "second_reduced" | "super_reduced" | "zero";

export interface CountryVat {
  country: string;
  currency: string;
  rates: Partial<Record<RateCategory, BasisPoints>>;
}

export const EU_VAT: Record<string, CountryVat> = {
  IE: { country: "IE", currency: "EUR", rates: { standard: 2300, reduced: 1350, second_reduced: 900, super_reduced: 480, zero: 0 } },
  DE: { country: "DE", currency: "EUR", rates: { standard: 1900, reduced: 700, zero: 0 } },
  FR: { country: "FR", currency: "EUR", rates: { standard: 2000, reduced: 1000, second_reduced: 550, super_reduced: 210, zero: 0 } },
  NL: { country: "NL", currency: "EUR", rates: { standard: 2100, reduced: 900, zero: 0 } },
  ES: { country: "ES", currency: "EUR", rates: { standard: 2100, reduced: 1000, super_reduced: 400, zero: 0 } },
  IT: { country: "IT", currency: "EUR", rates: { standard: 2200, reduced: 1000, second_reduced: 500, super_reduced: 400, zero: 0 } },
  BE: { country: "BE", currency: "EUR", rates: { standard: 2100, reduced: 1200, second_reduced: 600, zero: 0 } },
  PL: { country: "PL", currency: "PLN", rates: { standard: 2300, reduced: 800, second_reduced: 500, zero: 0 } },
  SE: { country: "SE", currency: "SEK", rates: { standard: 2500, reduced: 1200, second_reduced: 600, zero: 0 } },
  PT: { country: "PT", currency: "EUR", rates: { standard: 2300, reduced: 1300, second_reduced: 600, zero: 0 } },
};

/** Illustrative state level US sales tax (no county/city tax modelled). */
export const US_SALES_TAX: Record<string, BasisPoints> = {
  CA: 725,
  NY: 400,
  TX: 625,
  WA: 650,
  CO: 290,
  OR: 0,
};

export function isEuCountry(country: string): boolean {
  return country in EU_VAT;
}
