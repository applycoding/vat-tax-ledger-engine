import { assertCents, type Cents } from "../money";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface Account {
  code: string;
  name: string;
  type: AccountType;
}

export interface Posting {
  account: string;
  debit?: Cents;
  credit?: Cents;
}

export interface JournalEntry {
  id: string;
  memo: string;
  currency: string;
  postings: Required<Posting>[];
  createdAt: string;
}

export class UnbalancedEntryError extends Error {}

/** Debit normal accounts grow with debits, credit normal accounts grow with credits. */
const DEBIT_NORMAL: ReadonlySet<AccountType> = new Set(["asset", "expense"]);

export const DEFAULT_CHART: Account[] = [
  { code: "1100", name: "Accounts receivable", type: "asset" },
  { code: "1000", name: "Cash", type: "asset" },
  { code: "2200", name: "VAT payable", type: "liability" },
  { code: "2210", name: "US sales tax payable", type: "liability" },
  { code: "4000", name: "Sales revenue", type: "revenue" },
];

/**
 * Append only, in memory double entry ledger. Every entry must balance (sum of debits equals
 * sum of credits) and is immutable once posted. Corrections are made with reversing entries.
 */
export class Ledger {
  private readonly accounts = new Map<string, Account>();
  private readonly entries: JournalEntry[] = [];
  private seq = 0;

  constructor(chart: Account[] = DEFAULT_CHART) {
    chart.forEach((a) => this.accounts.set(a.code, a));
  }

  post(memo: string, currency: string, postings: Posting[], now: Date = new Date()): JournalEntry {
    if (postings.length < 2) throw new UnbalancedEntryError("an entry needs at least two postings");
    const normalised = postings.map((p) => {
      if (!this.accounts.has(p.account)) throw new Error(`unknown account ${p.account}`);
      const debit = p.debit ?? 0;
      const credit = p.credit ?? 0;
      assertCents(debit, "debit");
      assertCents(credit, "credit");
      if ((debit === 0) === (credit === 0)) throw new UnbalancedEntryError("each posting needs exactly one of debit or credit");
      return { account: p.account, debit, credit };
    });
    const dr = normalised.reduce((s, p) => s + p.debit, 0);
    const cr = normalised.reduce((s, p) => s + p.credit, 0);
    if (dr !== cr) throw new UnbalancedEntryError(`entry does not balance: debits ${dr} credits ${cr}`);
    const entry: JournalEntry = Object.freeze({
      id: `je_${++this.seq}`,
      memo,
      currency,
      postings: normalised,
      createdAt: now.toISOString(),
    });
    this.entries.push(entry);
    return entry;
  }

  reverse(entryId: string): JournalEntry {
    const original = this.entries.find((e) => e.id === entryId);
    if (!original) throw new Error(`no entry ${entryId}`);
    return this.post(
      `Reversal of ${entryId}: ${original.memo}`,
      original.currency,
      original.postings.map((p) => ({ account: p.account, debit: p.credit || undefined, credit: p.debit || undefined })),
    );
  }

  /** Balance in the account's natural direction. */
  balance(code: string): Cents {
    const account = this.accounts.get(code);
    if (!account) throw new Error(`unknown account ${code}`);
    let dr = 0;
    let cr = 0;
    for (const e of this.entries) for (const p of e.postings) if (p.account === code) { dr += p.debit; cr += p.credit; }
    return DEBIT_NORMAL.has(account.type) ? dr - cr : cr - dr;
  }

  trialBalance(): { rows: { code: string; name: string; debit: Cents; credit: Cents }[]; totalDebit: Cents; totalCredit: Cents } {
    const rows = [...this.accounts.values()].map((a) => {
      let dr = 0;
      let cr = 0;
      for (const e of this.entries) for (const p of e.postings) if (p.account === a.code) { dr += p.debit; cr += p.credit; }
      const net = dr - cr;
      return { code: a.code, name: a.name, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    });
    return {
      rows,
      totalDebit: rows.reduce((s, r) => s + r.debit, 0),
      totalCredit: rows.reduce((s, r) => s + r.credit, 0),
    };
  }

  list(): readonly JournalEntry[] {
    return this.entries;
  }
}
