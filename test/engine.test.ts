import { describe, expect, it } from "vitest";
import { applyRate } from "../src/money";
import { decideTreatment, looksLikeEuVatId, quote, type TaxRequest } from "../src/tax/engine";

const ieSeller = { country: "IE" };
const line = (unitPrice: number, quantity = 1, category?: "standard" | "reduced" | "second_reduced" | "zero") => ({ sku: "SKU", unitPrice, quantity, category });

describe("rounding", () => {
  it("rounds half up to the cent", () => {
    expect(applyRate(1000, 2300)).toBe(230);
    expect(applyRate(1, 5000)).toBe(1); // 0.5 cent rounds up
    expect(applyRate(1, 4999)).toBe(0);
    expect(applyRate(999, 1350)).toBe(135); // 134.865 -> 135
  });
});

describe("treatment decisions", () => {
  it("Irish domestic B2C sale uses Irish 23% standard rate", () => {
    const q = quote({ seller: ieSeller, customer: { country: "IE" }, supplyType: "goods", lines: [line(10000)] });
    expect(q.treatment).toBe("domestic");
    expect(q.tax).toBe(2300);
    expect(q.gross).toBe(12300);
  });

  it("Irish reduced 13.5% and second reduced 9% categories", () => {
    const q = quote({ seller: ieSeller, customer: { country: "IE" }, supplyType: "services", lines: [line(10000, 1, "reduced"), line(10000, 1, "second_reduced")] });
    expect(q.lines.map((l) => l.rate)).toEqual([1350, 900]);
    expect(q.tax).toBe(2250);
  });

  it("EU B2C digital service to Germany uses German rate (OSS)", () => {
    const q = quote({ seller: ieSeller, customer: { country: "DE" }, supplyType: "digital_services", lines: [line(5000)] });
    expect(q.treatment).toBe("oss_destination");
    expect(q.taxCountry).toBe("DE");
    expect(q.tax).toBe(950);
  });

  it("EU B2B with VAT ID is reverse charged at zero", () => {
    const q = quote({ seller: ieSeller, customer: { country: "FR", vatId: "FR12345678901" }, supplyType: "services", lines: [line(5000)] });
    expect(q.treatment).toBe("reverse_charge");
    expect(q.tax).toBe(0);
  });

  it("domestic B2B is still charged VAT (no reverse charge at home)", () => {
    expect(decideTreatment({ seller: ieSeller, customer: { country: "IE", vatId: "IE1234567T" }, supplyType: "goods", lines: [line(1)] }).treatment).toBe("domestic");
  });

  it("export outside the EU is zero rated", () => {
    const q = quote({ seller: ieSeller, customer: { country: "GB" }, supplyType: "goods", lines: [line(5000)] });
    expect(q.treatment).toBe("export_zero_rated");
    expect(q.tax).toBe(0);
  });

  it("US sale collects state tax only with nexus", () => {
    const base: TaxRequest = { seller: { country: "IE", usNexus: ["CA"] }, customer: { country: "US", region: "CA" }, supplyType: "goods", lines: [line(10000)] };
    expect(quote(base).tax).toBe(725);
    expect(quote({ ...base, customer: { country: "US", region: "NY" } }).treatment).toBe("us_no_nexus");
  });

  it("falls back to standard when a category is missing for a country", () => {
    const q = quote({ seller: { country: "DE" }, customer: { country: "DE" }, supplyType: "goods", lines: [line(1000, 1, "second_reduced")] });
    expect(q.lines[0]?.rate).toBe(1900);
  });

  it("validates VAT id structure", () => {
    expect(looksLikeEuVatId("IE 1234567T", "IE")).toBe(true);
    expect(looksLikeEuVatId("DE1234", "FR")).toBe(false);
    expect(looksLikeEuVatId(undefined, "IE")).toBe(false);
  });

  it("rejects bad input", () => {
    expect(() => quote({ seller: ieSeller, customer: { country: "IE" }, supplyType: "goods", lines: [] })).toThrow(RangeError);
    expect(() => quote({ seller: ieSeller, customer: { country: "IE" }, supplyType: "goods", lines: [line(1.5)] })).toThrow(RangeError);
    expect(() => quote({ seller: ieSeller, customer: { country: "IE" }, supplyType: "goods", lines: [line(100, 0)] })).toThrow(RangeError);
  });
});
