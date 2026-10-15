import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Ledger } from "../src/ledger/ledger";
import { InvoiceService } from "../src/invoices";
import { applyRate } from "../src/money";
import { EU_VAT } from "../src/tax/rates";
import { quote, type TaxRequest } from "../src/tax/engine";
import { IdempotencyStore, stableStringify } from "../src/idempotency";

const countries = [...Object.keys(EU_VAT), "GB", "US", "CH", "JP"];
const category = fc.constantFrom("standard", "reduced", "second_reduced", "super_reduced", "zero" as const);
const lineArb = fc.record({
  sku: fc.string({ minLength: 1, maxLength: 8 }),
  quantity: fc.integer({ min: 1, max: 50 }),
  unitPrice: fc.integer({ min: 0, max: 5_000_000 }),
  category,
});
const requestArb: fc.Arbitrary<TaxRequest> = fc.record({
  seller: fc.record({ country: fc.constantFrom(...Object.keys(EU_VAT)), usNexus: fc.subarray(["CA", "NY", "TX", "WA"]) }),
  customer: fc.record({
    country: fc.constantFrom(...countries),
    region: fc.constantFrom("CA", "NY", "TX", "OR", undefined),
    vatId: fc.option(fc.constantFrom("DE123456789", "FR12345678901", "IE1234567T"), { nil: undefined }),
  }),
  supplyType: fc.constantFrom("goods", "digital_services", "services" as const),
  lines: fc.array(lineArb, { minLength: 1, maxLength: 10 }),
});

describe("property based", () => {
  it("totals are the sum of lines and gross = net + tax", () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        const q = quote(req);
        expect(q.net).toBe(q.lines.reduce((s, l) => s + l.net, 0));
        expect(q.tax).toBe(q.lines.reduce((s, l) => s + l.tax, 0));
        expect(q.gross).toBe(q.net + q.tax);
        for (const l of q.lines) {
          expect(l.tax).toBeGreaterThanOrEqual(0);
          expect(l.tax).toBeLessThanOrEqual(l.net); // no modelled rate exceeds 100%
        }
      }),
    );
  });

  it("line order does not change totals", () => {
    fc.assert(
      fc.property(requestArb, (req) => {
        const reversed = { ...req, lines: [...req.lines].reverse() };
        const a = quote(req);
        const b = quote(reversed);
        expect([a.net, a.tax, a.gross, a.treatment]).toEqual([b.net, b.tax, b.gross, b.treatment]);
      }),
    );
  });

  it("per cent rounding error is at most half a cent per line", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e9 }), fc.integer({ min: 0, max: 10000 }), (net, rate) => {
        const exact = (net * rate) / 10000;
        expect(Math.abs(applyRate(net, rate) - exact)).toBeLessThanOrEqual(0.5);
      }),
    );
  });

  it("ledger always balances after any sequence of invoices and reversals", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(requestArb, fc.boolean()), { minLength: 1, maxLength: 15 }), (ops) => {
        const ledger = new Ledger();
        const svc = new InvoiceService(ledger);
        let expectedReceivable = 0;
        for (const [req, reverse] of ops) {
          const inv = svc.issue(req, "EUR");
          expectedReceivable += inv.quote.gross;
          if (reverse) {
            ledger.reverse(inv.journalEntryId);
            expectedReceivable -= inv.quote.gross;
          }
        }
        const tb = ledger.trialBalance();
        expect(tb.totalDebit).toBe(tb.totalCredit);
        expect(ledger.balance("1100")).toBe(expectedReceivable);
        expect(ledger.balance("1100")).toBe(ledger.balance("4000") + ledger.balance("2200") + ledger.balance("2210"));
      }),
    );
  });

  it("stable stringify ignores key order", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (obj) => {
        const shuffled = Object.fromEntries(Object.entries(obj).reverse());
        expect(stableStringify(shuffled)).toBe(stableStringify(obj));
      }),
    );
  });

  it("idempotent handler runs exactly once per key regardless of retries", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (retries) => {
        const store = new IdempotencyStore();
        let calls = 0;
        const body = { a: 1 };
        const results = await Promise.all(
          Array.from({ length: retries }, () => store.run("k", body, async () => ({ status: 201, body: { n: ++calls } }))),
        );
        expect(calls).toBe(1);
        for (const r of results) expect(r.body).toEqual({ n: 1 });
      }),
    );
  });
});
