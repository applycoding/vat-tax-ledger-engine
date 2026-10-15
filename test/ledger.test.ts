import { describe, expect, it } from "vitest";
import { Ledger, UnbalancedEntryError } from "../src/ledger/ledger";

describe("ledger", () => {
  it("posts balanced entries and reports natural balances", () => {
    const l = new Ledger();
    l.post("sale", "EUR", [{ account: "1100", debit: 12300 }, { account: "4000", credit: 10000 }, { account: "2200", credit: 2300 }]);
    expect(l.balance("1100")).toBe(12300);
    expect(l.balance("4000")).toBe(10000);
    expect(l.balance("2200")).toBe(2300);
    const tb = l.trialBalance();
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it("rejects unbalanced entries", () => {
    const l = new Ledger();
    expect(() => l.post("bad", "EUR", [{ account: "1100", debit: 100 }, { account: "4000", credit: 99 }])).toThrow(UnbalancedEntryError);
    expect(l.list()).toHaveLength(0);
  });

  it("rejects postings with both or neither side", () => {
    const l = new Ledger();
    expect(() => l.post("x", "EUR", [{ account: "1100", debit: 1, credit: 1 }, { account: "4000", credit: 0 }])).toThrow(UnbalancedEntryError);
  });

  it("rejects unknown accounts and single sided entries", () => {
    const l = new Ledger();
    expect(() => l.post("x", "EUR", [{ account: "9999", debit: 1 }, { account: "4000", credit: 1 }])).toThrow(/unknown account/);
    expect(() => l.post("x", "EUR", [{ account: "1100", debit: 1 }])).toThrow(UnbalancedEntryError);
  });

  it("reversal nets balances back to zero", () => {
    const l = new Ledger();
    const e = l.post("sale", "EUR", [{ account: "1100", debit: 500 }, { account: "4000", credit: 500 }]);
    l.reverse(e.id);
    expect(l.balance("1100")).toBe(0);
    expect(l.balance("4000")).toBe(0);
    expect(l.list()).toHaveLength(2);
  });

  it("entries are immutable", () => {
    const l = new Ledger();
    const e = l.post("sale", "EUR", [{ account: "1100", debit: 500 }, { account: "4000", credit: 500 }]);
    expect(Object.isFrozen(e)).toBe(true);
  });
});
