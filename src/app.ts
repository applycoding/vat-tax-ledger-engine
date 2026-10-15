import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { Ledger } from "./ledger/ledger";
import { IdempotencyConflictError, IdempotencyStore } from "./idempotency";
import { InvoiceService } from "./invoices";
import { quote } from "./tax/engine";

const party = z.object({
  country: z.string().length(2).transform((s) => s.toUpperCase()),
  region: z.string().optional(),
  vatId: z.string().optional(),
});

const taxRequest = z.object({
  seller: party.extend({ usNexus: z.array(z.string()).optional() }),
  customer: party,
  supplyType: z.enum(["goods", "digital_services", "services"]),
  lines: z
    .array(
      z.object({
        sku: z.string().min(1),
        description: z.string().optional(),
        quantity: z.number().int().positive(),
        unitPrice: z.number().int().nonnegative(),
        category: z.enum(["standard", "reduced", "second_reduced", "super_reduced", "zero"]).optional(),
      }),
    )
    .min(1),
});

const invoiceRequest = taxRequest.extend({ currency: z.string().length(3) });

export function createApp(deps = { ledger: new Ledger(), idempotency: new IdempotencyStore() }) {
  const { ledger, idempotency } = deps;
  const invoices = new InvoiceService(ledger);
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/v1/tax/quote", (req, res) => {
    const parsed = taxRequest.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
    res.json(quote(parsed.data));
  });

  app.post("/v1/invoices", async (req, res, next) => {
    try {
      const key = req.header("Idempotency-Key");
      if (!key || key.length > 255) return void res.status(400).json({ error: "missing_idempotency_key" });
      const result = await idempotency.run(key, req.body, async () => {
        const parsed = invoiceRequest.safeParse(req.body);
        if (!parsed.success) return { status: 400, body: { error: "invalid_request", issues: parsed.error.issues } };
        const { currency, ...tax } = parsed.data;
        return { status: 201, body: invoices.issue(tax, currency.toUpperCase()) };
      });
      res.setHeader("Idempotent-Replayed", String(result.replayed));
      res.status(result.status).json(result.body);
    } catch (err) {
      next(err);
    }
  });

  app.get("/v1/invoices/:id", (req, res) => {
    const inv = invoices.get(req.params.id);
    if (!inv) return void res.status(404).json({ error: "not_found" });
    res.json(inv);
  });

  app.get("/v1/ledger/entries", (_req, res) => {
    res.json(ledger.list());
  });

  app.get("/v1/ledger/trial-balance", (_req, res) => {
    res.json(ledger.trialBalance());
  });

  app.get("/v1/accounts/:code/balance", (req, res) => {
    try {
      res.json({ account: req.params.code, balance: ledger.balance(req.params.code) });
    } catch {
      res.status(404).json({ error: "unknown_account" });
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof IdempotencyConflictError) return void res.status(422).json({ error: "idempotency_key_reused", message: err.message });
    if (err instanceof RangeError) return void res.status(400).json({ error: "invalid_request", message: err.message });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
