import type { Ledger, JournalEntry } from "./ledger/ledger";
import { quote, type TaxQuote, type TaxRequest } from "./tax/engine";

export interface Invoice {
  id: string;
  currency: string;
  quote: TaxQuote;
  journalEntryId: string;
}

/**
 * Issues an invoice: computes tax, then posts one balanced journal entry.
 *   Dr Accounts receivable   gross
 *   Cr Sales revenue         net
 *   Cr VAT / sales tax       tax   (omitted when tax is zero)
 */
export class InvoiceService {
  private seq = 0;
  private readonly invoices = new Map<string, Invoice>();
  constructor(private readonly ledger: Ledger) {}

  issue(req: TaxRequest, currency: string): Invoice {
    const q = quote(req);
    const taxAccount = q.treatment === "us_sales_tax" ? "2210" : "2200";
    const postings = [
      { account: "1100", debit: q.gross },
      { account: "4000", credit: q.net },
      ...(q.tax > 0 ? [{ account: taxAccount, credit: q.tax }] : []),
    ];
    const id = `inv_${++this.seq}`;
    const entry: JournalEntry = this.ledger.post(`Invoice ${id} (${q.treatment})`, currency, postings);
    const invoice: Invoice = { id, currency, quote: q, journalEntryId: entry.id };
    this.invoices.set(id, invoice);
    return invoice;
  }

  get(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }
}
