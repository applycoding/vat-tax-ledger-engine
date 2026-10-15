import { createHash } from "node:crypto";

export interface StoredResponse {
  fingerprint: string;
  status: number;
  body: unknown;
  createdAt: number;
}

export class IdempotencyConflictError extends Error {}

/**
 * Stores the first response per idempotency key. A retry with the same key and same body
 * replays the stored response; the same key with a different body is rejected.
 * In memory with a TTL; a real deployment would use Redis or a database unique index.
 */
export class IdempotencyStore {
  private readonly store = new Map<string, StoredResponse>();
  private readonly inFlight = new Map<string, { fingerprint: string; promise: Promise<{ status: number; body: unknown }> }>();
  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000, private readonly clock: () => number = Date.now) {}

  static fingerprint(body: unknown): string {
    return createHash("sha256").update(stableStringify(body)).digest("hex");
  }

  async run(key: string, body: unknown, handler: () => Promise<{ status: number; body: unknown }>): Promise<{ status: number; body: unknown; replayed: boolean }> {
    const fp = IdempotencyStore.fingerprint(body);
    const existing = this.store.get(key);
    if (existing && this.clock() - existing.createdAt < this.ttlMs) {
      if (existing.fingerprint !== fp) throw new IdempotencyConflictError("idempotency key reused with a different request body");
      return { status: existing.status, body: existing.body, replayed: true };
    }
    const pending = this.inFlight.get(key);
    if (pending) {
      // A concurrent duplicate waits for the first request instead of executing twice.
      if (pending.fingerprint !== fp) throw new IdempotencyConflictError("idempotency key reused with a different request body");
      const shared = await pending.promise;
      return { ...shared, replayed: true };
    }
    const promise = handler();
    this.inFlight.set(key, { fingerprint: fp, promise });
    try {
      const result = await promise;
      // Server errors are not cached, so a failed request can be retried with the same key.
      if (result.status < 500) this.store.set(key, { fingerprint: fp, ...result, createdAt: this.clock() });
      return { ...result, replayed: false };
    } finally {
      this.inFlight.delete(key);
    }
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}
