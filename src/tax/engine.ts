import { applyRate, assertCents, type BasisPoints, type Cents } from "../money";
import { EU_VAT, US_SALES_TAX, isEuCountry, type RateCategory } from "./rates";

export type SupplyType = "goods" | "digital_services" | "services";

export interface Party {
  country: string; // ISO 3166-1 alpha-2
  region?: string; // e.g. US state code
  vatId?: string; // presence means business customer (format checked only)
}

export interface LineInput {
  sku: string;
  description?: string;
  quantity: number;
  unitPrice: Cents; // net, minor units
  category?: RateCategory; // VAT rate category, defaults to standard
}

export interface TaxRequest {
  seller: Party & { usNexus?: string[] };
  customer: Party;
  supplyType: SupplyType;
  lines: LineInput[];
}

export type Treatment =
  | "domestic"
  | "oss_destination" // EU B2C distance sale taxed at customer country rate
  | "reverse_charge" // intra EU B2B, customer self accounts
  | "export_zero_rated" // supply leaving the EU
  | "us_sales_tax"
  | "us_no_nexus"
  | "out_of_scope";

export interface TaxedLine {
  sku: string;
  net: Cents;
  rate: BasisPoints;
  tax: Cents;
  gross: Cents;
}

export interface TaxQuote {
  treatment: Treatment;
  taxCountry: string | null;
  lines: TaxedLine[];
  net: Cents;
  tax: Cents;
  gross: Cents;
  notes: string[];
}

/** Light structural check, not a VIES lookup. */
export function looksLikeEuVatId(vatId: string | undefined, country: string): boolean {
  if (!vatId) return false;
  const prefix = country === "GR" ? "EL" : country;
  return new RegExp(`^${prefix}[0-9A-Z+*]{2,12}$`).test(vatId.replace(/\s+/g, "").toUpperCase());
}

/** Distance selling threshold is ignored: the demo assumes the seller is registered for OSS. */
export function decideTreatment(req: TaxRequest): { treatment: Treatment; taxCountry: string | null; notes: string[] } {
  const { seller, customer } = req;
  const notes: string[] = [];

  if (customer.country === "US") {
    const state = customer.region?.toUpperCase();
    if (state && seller.usNexus?.map((s) => s.toUpperCase()).includes(state) && state in US_SALES_TAX) {
      return { treatment: "us_sales_tax", taxCountry: `US-${state}`, notes };
    }
    notes.push("No sales tax nexus in customer state, nothing collected");
    return { treatment: "us_no_nexus", taxCountry: null, notes };
  }

  if (!isEuCountry(seller.country)) {
    notes.push("Seller outside modelled EU jurisdictions");
    return { treatment: "out_of_scope", taxCountry: null, notes };
  }

  if (!isEuCountry(customer.country)) {
    notes.push("Supply to a customer outside the EU is zero rated (export)");
    return { treatment: "export_zero_rated", taxCountry: seller.country, notes };
  }

  if (customer.country === seller.country) {
    return { treatment: "domestic", taxCountry: seller.country, notes };
  }

  if (looksLikeEuVatId(customer.vatId, customer.country)) {
    notes.push("Reverse charge: customer accounts for VAT (Article 196 VAT Directive)");
    return { treatment: "reverse_charge", taxCountry: customer.country, notes };
  }

  notes.push("EU B2C cross border sale taxed in customer country under OSS");
  return { treatment: "oss_destination", taxCountry: customer.country, notes };
}

function rateFor(treatment: Treatment, taxCountry: string | null, category: RateCategory): BasisPoints {
  switch (treatment) {
    case "domestic":
    case "oss_destination": {
      const table = EU_VAT[taxCountry ?? ""];
      if (!table) throw new Error(`No VAT table for ${taxCountry}`);
      // Fall back to standard when a country does not have the requested category.
      return table.rates[category] ?? table.rates.standard ?? 0;
    }
    case "us_sales_tax":
      return US_SALES_TAX[(taxCountry ?? "").replace("US-", "")] ?? 0;
    default:
      return 0;
  }
}

export function quote(req: TaxRequest): TaxQuote {
  if (req.lines.length === 0) throw new RangeError("at least one line is required");
  const { treatment, taxCountry, notes } = decideTreatment(req);
  const lines = req.lines.map((l): TaxedLine => {
    if (!Number.isSafeInteger(l.quantity) || l.quantity <= 0) throw new RangeError(`quantity must be a positive integer for ${l.sku}`);
    assertCents(l.unitPrice, `unitPrice for ${l.sku}`);
    const net = l.unitPrice * l.quantity;
    const rate = rateFor(treatment, taxCountry, l.category ?? "standard");
    // Tax is calculated per line and rounded per line, a common invoice convention.
    const tax = applyRate(net, rate);
    return { sku: l.sku, net, rate, tax, gross: net + tax };
  });
  const net = lines.reduce((s, l) => s + l.net, 0);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  return { treatment, taxCountry, lines, net, tax, gross: net + tax, notes };
}
