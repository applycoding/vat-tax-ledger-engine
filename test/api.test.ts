import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const invoice = {
  currency: "EUR",
  seller: { country: "IE" },
  customer: { country: "IE" },
  supplyType: "goods",
  lines: [{ sku: "BOOK", quantity: 2, unitPrice: 1999, category: "zero" }, { sku: "LAMP", quantity: 1, unitPrice: 4500 }],
};

describe("REST API", () => {
  it("quotes tax", async () => {
    const res = await request(createApp()).post("/v1/tax/quote").send(invoice).expect(200);
    expect(res.body.tax).toBe(1035);
    expect(res.body.treatment).toBe("domestic");
  });

  it("validates input", async () => {
    const res = await request(createApp()).post("/v1/tax/quote").send({ ...invoice, lines: [] }).expect(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("requires an idempotency key for invoices", async () => {
    await request(createApp()).post("/v1/invoices").send(invoice).expect(400);
  });

  it("replays the same invoice for a retried key and posts the ledger once", async () => {
    const app = createApp();
    const first = await request(app).post("/v1/invoices").set("Idempotency-Key", "abc").send(invoice).expect(201);
    const second = await request(app).post("/v1/invoices").set("Idempotency-Key", "abc").send(invoice).expect(201);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body.id).toBe(first.body.id);
    const entries = await request(app).get("/v1/ledger/entries").expect(200);
    expect(entries.body).toHaveLength(1);
    const ar = await request(app).get("/v1/accounts/1100/balance").expect(200);
    expect(ar.body.balance).toBe(first.body.quote.gross);
    await request(app).get(`/v1/invoices/${first.body.id}`).expect(200);
  });

  it("rejects a reused key with a different body", async () => {
    const app = createApp();
    await request(app).post("/v1/invoices").set("Idempotency-Key", "k1").send(invoice).expect(201);
    const res = await request(app).post("/v1/invoices").set("Idempotency-Key", "k1").send({ ...invoice, currency: "USD" }).expect(422);
    expect(res.body.error).toBe("idempotency_key_reused");
  });

  it("trial balance balances", async () => {
    const app = createApp();
    await request(app).post("/v1/invoices").set("Idempotency-Key", "a").send(invoice).expect(201);
    await request(app).post("/v1/invoices").set("Idempotency-Key", "b").send({ ...invoice, customer: { country: "FR", vatId: "FR12345678901" } }).expect(201);
    const tb = await request(app).get("/v1/ledger/trial-balance").expect(200);
    expect(tb.body.totalDebit).toBe(tb.body.totalCredit);
  });

  it("404s on unknown resources", async () => {
    const app = createApp();
    await request(app).get("/v1/invoices/nope").expect(404);
    await request(app).get("/v1/accounts/0000/balance").expect(404);
    await request(app).get("/health").expect(200);
  });
});
