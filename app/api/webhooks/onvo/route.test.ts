// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * End-to-end tests of POST /api/webhooks/onvo: route → processor → store.
 *
 * Only the two true externals are faked:
 *   - Supabase: an in-memory admin client whose four RPCs reimplement the SQL in
 *     20261025000100_onvo_webhook_event_ledger.sql (same branches, same order).
 *     The real SQL is covered by supabase/tests/20261025000100_…_test.sql.
 *   - Notifications: an in-memory stand-in with the order_notifications ledger
 *     semantics (one send per order+type), so "no duplicate email" is
 *     asserted on SENDS, not merely on calls.
 *
 * Faults are injected per RPC to simulate a DB outage or a dropped connection.
 */

const SECRET = "webhook_secret_test_abc123";
const ORDER_ID = "fc006d09-ae68-4f9e-832f-50a458ca5040";
const INTENT_ID = "cmvmprc961anak3735hgsh2f0";

const h = vi.hoisted(() => {
  process.env.ONVO_API_KEY = "onvo_test_secret_key_x";
  process.env.ONVO_PUBLIC_KEY = "onvo_test_publishable_key_x";
  process.env.ONVO_WEBHOOK_SECRET = "webhook_secret_test_abc123";
  return { db: null as any, notifier: null as any };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.admin }));
vi.mock("@/lib/notifications/orderNotifier", () => ({
  notifyOrderPaid: (orderId: string) => h.notifier.notify("order_payment_confirmed", orderId),
  notifyCustomerOrderConfirmation: (orderId: string) =>
    h.notifier.notify("customer_order_confirmation", orderId),
}));

import { POST } from "./route";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory Supabase mirroring the migration
// ─────────────────────────────────────────────────────────────────────────────

interface Order {
  id: string;
  total: number;
  payment_status: "pending" | "paid" | "failed" | "refunded";
  order_status: "pending" | "received" | "shipped" | "denied";
  payment_reference: string | null;
  paid_at: number | null;
}

interface LedgerRow {
  id: string;
  key: string;
  event_type: string;
  status: "processing" | "processed" | "ignored" | "rejected" | "failed";
  attempts: number;
  locked_until: number | null;
  order_id: string | null;
  outcome: string | null;
  last_error: string | null;
  effects_applied_at: number | null;
  processed_at: number | null;
}

/**
 * db_error        — PostgREST returns an error, nothing committed
 * network         — request never reached the DB, nothing committed
 * commit_then_lost — the RPC COMMITTED, then the response was lost (timeout /
 *                    dropped connection): the caller sees a failure
 */
type Fault = { fn: string; kind: "db_error" | "network" | "commit_then_lost" };

function createFakeDb() {
  const orders = new Map<string, Order>();
  const rows = new Map<string, LedgerRow>();
  const byKey = new Map<string, LedgerRow>();
  const calls: string[] = [];
  const restored: string[] = [];
  const faults: Fault[] = [];
  const clock = { now: Date.parse("2026-10-25T12:00:00Z") };
  let gate: Promise<void> | null = null;
  let seq = 0;

  // Mirrors resolve_onvo_intent_order: payment_reference is the trusted link,
  // the payload orderId (hint) is only cross-checked.
  const resolve = (intentId: string, hint: string | null) => {
    const matches = [...orders.values()].filter((o) => o.payment_reference === intentId);
    if (matches.length > 1) return { order: null, reason: "ambiguous_intent" };
    if (matches.length === 1) {
      if (hint && hint !== matches[0].id) return { order: matches[0], reason: "order_mismatch" };
      return { order: matches[0], reason: "associated" };
    }
    const hinted = hint ? orders.get(hint) : undefined;
    if (hinted) return { order: hinted, reason: "intent_not_associated" };
    return { order: null, reason: "order_not_found" };
  };

  const row = (id: string) => {
    const r = rows.get(id);
    if (!r) throw new Error(`webhook event ${id} not found`);
    return r;
  };

  const fns: Record<string, (a: any) => unknown> = {
    claim_webhook_event(a) {
      const key = `${a.p_provider}:${a.p_event_id}`;
      const lease = Math.min(Math.max(a.p_lease_seconds ?? 120, 10), 900) * 1000;
      let r = byKey.get(key);
      if (!r) {
        r = {
          id: `evt-${++seq}`,
          key,
          event_type: a.p_event_type,
          status: "processing",
          attempts: 1,
          locked_until: clock.now + lease,
          order_id: null,
          outcome: null,
          last_error: null,
          effects_applied_at: null,
          processed_at: null,
        };
        rows.set(r.id, r);
        byKey.set(key, r);
        return { claimed: true, id: r.id, attempts: 1, effects_applied: false, order_id: null };
      }
      if (["processed", "ignored", "rejected"].includes(r.status)) {
        return { claimed: false, id: r.id, status: r.status, outcome: r.outcome, order_id: r.order_id };
      }
      if (r.status === "processing" && r.locked_until !== null && r.locked_until > clock.now) {
        return { claimed: false, id: r.id, status: "processing", order_id: r.order_id };
      }
      r.status = "processing";
      r.attempts += 1;
      r.locked_until = clock.now + lease;
      return {
        claimed: true,
        id: r.id,
        attempts: r.attempts,
        effects_applied: r.effects_applied_at !== null,
        order_id: r.order_id,
      };
    },

    complete_webhook_event(a) {
      const r = rows.get(a.p_id);
      if (!r || r.status !== "processing") return false;
      r.status = a.p_status;
      r.outcome = a.p_outcome ?? r.outcome;
      r.last_error = a.p_error ?? null;
      r.locked_until = null;
      if (a.p_status !== "failed") r.processed_at = clock.now;
      return true;
    },

    apply_onvo_payment_succeeded(a) {
      const r = row(a.p_webhook_id);
      if (r.effects_applied_at !== null) {
        return { outcome: "paid", reason: "already_applied", order_id: r.order_id };
      }
      const link = resolve(a.p_intent_id, a.p_order_id);
      if (link.order) r.order_id = link.order.id;
      if (link.reason !== "associated" || !link.order) {
        return { outcome: "rejected", reason: link.reason, order_id: link.order?.id ?? null };
      }
      const o = link.order;
      const expected = Math.round(o.total * 100);
      const res = (outcome: string, reason: string) => ({
        outcome,
        reason,
        order_id: o.id,
        expected_amount: expected,
      });
      if (o.payment_status === "paid") return res("ignored", "already_paid");
      if (o.order_status === "denied") return res("rejected", "order_denied");
      if (o.payment_status !== "pending") return res("rejected", "payment_not_pending");
      if (String(a.p_currency).toUpperCase() !== "CRC") return res("rejected", "currency_mismatch");
      if (a.p_amount !== expected) return res("rejected", "amount_mismatch");
      o.payment_status = "paid";
      o.paid_at = clock.now;
      r.effects_applied_at = clock.now;
      return res("paid", "marked_paid");
    },

    apply_onvo_payment_failed(a) {
      const r = row(a.p_webhook_id);
      if (r.effects_applied_at !== null) {
        return { outcome: "failed", reason: "already_applied", order_id: r.order_id };
      }
      const link = resolve(a.p_intent_id, a.p_order_id);
      if (link.order) r.order_id = link.order.id;
      if (link.reason !== "associated" || !link.order) {
        return { outcome: "ignored", reason: link.reason, order_id: link.order?.id ?? null };
      }
      const o = link.order;
      const res = (outcome: string, reason: string) => ({ outcome, reason, order_id: o.id });
      if (o.payment_status === "paid") return res("ignored", "already_paid");
      if (o.payment_status !== "pending" || o.order_status === "denied") return res("ignored", "already_final");
      if (!a.p_terminal) return res("ignored", "retryable_attempt");
      if (o.order_status === "shipped") return res("ignored", "order_shipped");
      restored.push(o.id);
      o.payment_status = "failed";
      o.order_status = "denied";
      r.effects_applied_at = clock.now;
      return res("failed", "marked_failed");
    },
  };

  const admin = {
    async rpc(fn: string, args: Record<string, unknown>) {
      calls.push(fn);
      const i = faults.findIndex((f) => f.fn === fn);
      if (i >= 0) {
        const [fault] = faults.splice(i, 1);
        if (fault.kind === "commit_then_lost") fns[fn](args);
        if (fault.kind !== "db_error") throw new TypeError("fetch failed");
        return { data: null, error: { message: "connection terminated unexpectedly", code: "08006" } };
      }
      if (fn.startsWith("apply_") && gate) await gate;
      // Each RPC is its own transaction: it runs to completion atomically.
      return { data: fns[fn](args), error: null };
    },
  };

  return {
    admin,
    /** Direct, un-faulted access to the RPCs — for seeding crash states. */
    sql: fns,
    orders,
    rows,
    calls,
    restored,
    clock,
    fail: (fn: string, kind: Fault["kind"] = "db_error") => faults.push({ fn, kind }),
    hold: () => {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        gate = null;
        release();
      };
    },
    addOrder: (o: Partial<Order> = {}) => {
      const order: Order = {
        id: ORDER_ID,
        total: 18_900,
        payment_status: "pending",
        order_status: "pending",
        payment_reference: INTENT_ID,
        paid_at: null,
        ...o,
      };
      orders.set(order.id, order);
      return order;
    },
    ledger: () => [...rows.values()],
    count: (fn: string) => calls.filter((c) => c === fn).length,
  };
}

function createFakeNotifier() {
  const sent = new Set<string>();
  const sends: string[] = [];
  const sentFor: string[] = [];
  const failures: Array<{ type: string; mode: "result" | "throw" }> = [];
  return {
    sends,
    sentFor,
    failNext: (type: string, mode: "result" | "throw" = "result") => failures.push({ type, mode }),
    async notify(type: string, orderId: string) {
      const i = failures.findIndex((f) => f.type === type);
      if (i >= 0) {
        const [f] = failures.splice(i, 1);
        if (f.mode === "throw") throw new Error("notifier exploded");
        return { status: "failed", reason: "Resend 503" };
      }
      const key = `${orderId}:${type}`;
      if (sent.has(key)) return { status: "skipped", reason: "already sent or in progress" };
      sent.add(key);
      sends.push(type);
      sentFor.push(orderId);
      return { status: "sent", id: `msg-${sends.length}` };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function post(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-webhook-secret"] = secret;
  return POST(
    new Request("https://www.krovperfumeria.com/api/webhooks/onvo", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }) as any
  );
}

const succeeded = (data: Record<string, unknown> = {}) => ({
  type: "payment-intent.succeeded",
  data: {
    id: INTENT_ID,
    amount: 1_890_000,
    currency: "CRC",
    status: "succeeded",
    metadata: { orderId: ORDER_ID, orderNumber: "144" },
    customer: { name: "Cliente Privado", email: "cliente@example.com", phone: "+50688888888" },
    ...data,
  },
});

const failed = (data: Record<string, unknown> = {}) => ({
  type: "payment-intent.failed",
  data: {
    id: INTENT_ID,
    status: "requires_payment_method",
    metadata: { orderId: ORDER_ID },
    error: { id: "err_1", code: "declined", message: "Tarjeta declinada" },
    ...data,
  },
});

async function json(res: Response) {
  return { status: res.status, body: await res.json().catch(() => null) };
}

let db: ReturnType<typeof createFakeDb>;
let notifier: ReturnType<typeof createFakeNotifier>;
let logs: { info: any; warn: any; error: any };

beforeEach(() => {
  db = h.db = createFakeDb();
  notifier = h.notifier = createFakeNotifier();
  logs = {
    info: vi.spyOn(console, "info").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const loggedText = () =>
  JSON.stringify([...logs.info.mock.calls, ...logs.warn.mock.calls, ...logs.error.mock.calls]);

const errorLogs = () => logs.error.mock.calls.map((c: unknown[]) => c[1] as Record<string, unknown>);

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("authentication", () => {
  it("rejects a missing secret with 401 and touches nothing", async () => {
    db.addOrder();
    const res = await post(succeeded(), null);
    expect(res.status).toBe(401);
    expect(db.calls).toEqual([]);
  });

  it("rejects a wrong secret (same and different length) with 401", async () => {
    db.addOrder();
    expect((await post(succeeded(), "webhook_secret_test_abc124")).status).toBe(401);
    expect((await post(succeeded(), "nope")).status).toBe(401);
    expect(db.calls).toEqual([]);
    expect(db.orders.get(ORDER_ID)?.payment_status).toBe("pending");
  });

  it("accepts the configured ONVO_WEBHOOK_SECRET", async () => {
    db.addOrder();
    expect((await post(succeeded())).status).toBe(200);
  });

  it("never logs the secret or customer contact data", async () => {
    db.addOrder();
    await post(succeeded(), "wrong-secret-value");
    await post(succeeded());
    await post(succeeded({ amount: 1 }));
    const text = loggedText();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("wrong-secret-value");
    expect(text).not.toContain("cliente@example.com");
    expect(text).not.toContain("+50688888888");
  });
});

describe("malformed payloads", () => {
  it("answers 400 to a non-JSON body without processing anything", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(db.calls).toEqual([]);
    expect(errorLogs()[0]).toMatchObject({ failure_category: "invalid_json" });
  });

  it("answers 400 to an envelope without a type", async () => {
    expect((await post({ data: { id: INTENT_ID } })).status).toBe(400);
    expect(db.calls).toEqual([]);
  });

  it("answers 400 to a payment-intent event without data.id", async () => {
    db.addOrder();
    const res = await post({ type: "payment-intent.succeeded", data: { amount: 1_890_000 } });
    expect(res.status).toBe(400);
    expect(db.orders.get(ORDER_ID)?.payment_status).toBe("pending");
  });
});

describe("payment-intent.succeeded", () => {
  it("marks the order paid, sends both emails once, and closes the ledger row", async () => {
    db.addOrder();
    const res = await json(await post(succeeded()));

    expect(res).toEqual({
      status: 200,
      body: { received: true, status: "processed", reason: "marked_paid" },
    });
    const order = db.orders.get(ORDER_ID)!;
    expect(order.payment_status).toBe("paid");
    expect(order.order_status).toBe("pending"); // fulfilment is the admin's call
    expect(notifier.sends.sort()).toEqual(["customer_order_confirmation", "order_payment_confirmed"]);

    const [row] = db.ledger();
    expect(row).toMatchObject({
      key: `onvo:payment-intent.succeeded:${INTENT_ID}`,
      status: "processed",
      outcome: "marked_paid",
      order_id: ORDER_ID,
      attempts: 1,
      locked_until: null,
    });
    expect(row.effects_applied_at).not.toBeNull();
  });

  it("returns 200 to a duplicate after success without repeating any side effect", async () => {
    db.addOrder();
    await post(succeeded());
    const paidAt = db.orders.get(ORDER_ID)!.paid_at;
    db.clock.now += 60 * 60 * 1000;

    const res = await json(await post(succeeded()));

    expect(res).toEqual({ status: 200, body: { received: true, status: "duplicate", previous: "processed" } });
    expect(db.count("apply_onvo_payment_succeeded")).toBe(1);
    expect(db.orders.get(ORDER_ID)!.paid_at).toBe(paidAt);
    expect(notifier.sends).toHaveLength(2);
  });

  it("lets exactly one of two concurrent deliveries process the event", async () => {
    db.addOrder();
    const release = db.hold();

    const first = post(succeeded());
    const second = post(succeeded());
    await vi.waitFor(() => expect(db.count("claim_webhook_event")).toBe(2));
    release();

    const statuses = (await Promise.all([first, second])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(db.count("apply_onvo_payment_succeeded")).toBe(1);
    expect(notifier.sends).toHaveLength(2);

    // The 409'd delivery's redelivery is now a clean duplicate.
    expect((await json(await post(succeeded()))).body).toMatchObject({ status: "duplicate" });
    expect(notifier.sends).toHaveLength(2);
  });

  it("answers 409 with Retry-After while another delivery holds the claim", async () => {
    db.addOrder();
    const release = db.hold();
    const first = post(succeeded());
    await vi.waitFor(() => expect(db.count("apply_onvo_payment_succeeded")).toBe(1));

    const res = await post(succeeded());
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).toBe("120");
    release();
    expect((await first).status).toBe(200);
  });
});

describe("transient failures and retries", () => {
  it("returns 500 when the ledger is unreachable, then processes the retry", async () => {
    db.addOrder();
    db.fail("claim_webhook_event", "network");

    const res = await json(await post(succeeded()));
    expect(res).toEqual({ status: 500, body: { error: "retryable_error", category: "ledger_unavailable" } });
    expect(db.ledger()).toHaveLength(0);
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("pending");

    expect((await post(succeeded())).status).toBe(200);
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("paid");
  });

  it("does NOT mark the event processed when applying it fails, and the retry succeeds", async () => {
    db.addOrder();
    db.fail("apply_onvo_payment_succeeded");

    const res = await json(await post(succeeded()));
    expect(res).toEqual({ status: 500, body: { error: "retryable_error", category: "database_error" } });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("pending");
    expect(db.ledger()[0]).toMatchObject({ status: "failed", locked_until: null });
    expect(db.ledger()[0].last_error).toContain("database_error");
    expect(notifier.sends).toHaveLength(0);
    expect(errorLogs()).toContainEqual(
      expect.objectContaining({
        event_type: "payment-intent.succeeded",
        intent_id: INTENT_ID,
        order_hint: ORDER_ID,
        outcome: "retryable_error",
        failure_category: "database_error",
      })
    );

    const retry = await json(await post(succeeded()));
    expect(retry.body).toMatchObject({ status: "processed", reason: "marked_paid" });
    expect(db.ledger()[0]).toMatchObject({ status: "processed", attempts: 2 });
    expect(notifier.sends).toHaveLength(2);
  });

  it("resumes a handler that failed after the order change committed, without re-applying it", async () => {
    db.addOrder();
    notifier.failNext("order_payment_confirmed", "throw");

    const res = await json(await post(succeeded()));
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ category: "internal_error" });
    // The payment itself is safe even though this delivery failed.
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("paid");
    expect(db.ledger()[0].status).toBe("failed");

    const retry = await json(await post(succeeded()));
    expect(retry.body).toMatchObject({ status: "processed", reason: "resumed_after_apply" });
    expect(db.count("apply_onvo_payment_succeeded")).toBe(1);
    expect(notifier.sends.sort()).toEqual(["customer_order_confirmation", "order_payment_confirmed"]);
  });

  it("re-claims an event whose worker died mid-flight only after the lease expires", async () => {
    db.addOrder();
    db.fail("apply_onvo_payment_succeeded");
    db.fail("complete_webhook_event"); // can't even record the failure

    expect((await post(succeeded())).status).toBe(500);
    expect(db.ledger()[0].status).toBe("processing");

    expect((await post(succeeded())).status).toBe(409); // lease still live
    db.clock.now += 121_000;
    expect((await json(await post(succeeded()))).body).toMatchObject({ status: "processed" });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("paid");
  });

  it("still answers 200 when only the final ledger write fails, and heals on redelivery", async () => {
    db.addOrder();
    db.fail("complete_webhook_event");

    expect((await post(succeeded())).status).toBe(200);
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("paid");
    expect(db.ledger()[0].status).toBe("processing");

    db.clock.now += 121_000;
    expect((await post(succeeded())).status).toBe(200);
    expect(db.ledger()[0]).toMatchObject({ status: "processed", attempts: 2 });
    expect(db.count("apply_onvo_payment_succeeded")).toBe(1);
    expect(notifier.sends).toHaveLength(2);
  });

  it("does not fail the webhook when an email provider call fails", async () => {
    db.addOrder();
    notifier.failNext("customer_order_confirmation");

    const res = await json(await post(succeeded()));
    expect(res.body).toMatchObject({ status: "processed" });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("paid");
    expect(errorLogs()).toContainEqual(
      expect.objectContaining({
        failure_category: "notification_failed",
        notification: "customer_order_confirmation",
        order_id: ORDER_ID,
      })
    );
  });
});

describe("business validation (permanent rejections)", () => {
  it.each([
    ["amount mismatch", { amount: 1_889_900 }, "amount_mismatch"],
    ["amount in colones instead of céntimos", { amount: 18_900 }, "amount_mismatch"],
    ["currency mismatch", { currency: "USD" }, "currency_mismatch"],
  ])("rejects a %s without marking the order paid", async (_label, data, reason) => {
    db.addOrder();
    const res = await json(await post(succeeded(data)));

    expect(res).toEqual({ status: 200, body: { received: true, status: "rejected", reason } });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("pending");
    expect(notifier.sends).toHaveLength(0);
    expect(db.ledger()[0]).toMatchObject({ status: "rejected", outcome: reason });
    expect(errorLogs()).toContainEqual(
      expect.objectContaining({ outcome: "rejected", reason, order_id: ORDER_ID })
    );

    // A redelivery can't loop: it is a duplicate of the rejection.
    expect((await json(await post(succeeded(data)))).body).toMatchObject({
      status: "duplicate",
      previous: "rejected",
    });
    expect(db.count("apply_onvo_payment_succeeded")).toBe(1);
  });

  it("records the expected and received amounts for review", async () => {
    db.addOrder();
    await post(succeeded({ amount: 1_889_900 }));
    expect(db.ledger()[0].last_error).toBe("expected=1890000 received=1889900");
  });

  it("rejects a success with no amount instead of skipping the check", async () => {
    db.addOrder();
    const event = succeeded();
    delete (event.data as { amount?: number }).amount;
    const res = await json(await post(event));
    expect(res.body).toMatchObject({ status: "rejected", reason: "invalid_amount" });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("pending");
    expect(db.count("apply_onvo_payment_succeeded")).toBe(0);
  });

  it("rejects a success whose order hint is not even a UUID", async () => {
    db.addOrder();
    const res = await json(await post(succeeded({ metadata: { orderId: "144" } })));
    expect(res.body).toMatchObject({ status: "rejected", reason: "invalid_order_reference" });
    expect(db.count("apply_onvo_payment_succeeded")).toBe(0);
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("pending");
  });

  it("rejects a success for an order that does not exist", async () => {
    const res = await json(await post(succeeded()));
    expect(res.body).toMatchObject({ status: "rejected", reason: "order_not_found" });
    expect(notifier.sends).toHaveLength(0);
  });

  it("flags a success on an already-denied order for manual refund and leaves it denied", async () => {
    db.addOrder({ order_status: "denied", payment_status: "failed" });
    const res = await json(await post(succeeded()));
    expect(res.body).toMatchObject({ status: "rejected", reason: "order_denied" });
    expect(db.orders.get(ORDER_ID)).toMatchObject({ order_status: "denied", payment_status: "failed" });
    expect(db.ledger()[0].last_error).toContain("MANUAL REFUND NEEDED");
  });

  it("ignores a success for an order that is already paid (e.g. reconciled by hand)", async () => {
    db.addOrder({ payment_status: "paid", paid_at: 1 });
    const res = await json(await post(succeeded()));
    expect(res.body).toMatchObject({ status: "ignored", reason: "already_paid" });
    expect(db.orders.get(ORDER_ID)!.paid_at).toBe(1);
    expect(notifier.sends).toHaveLength(0);
  });
});

describe("payment-intent.failed", () => {
  it("keeps the order payable after a decline, so a retry on the same intent can succeed", async () => {
    // Regression: the old key (bare intent id) deduplicated the success, and
    // the old handler had already denied the order.
    db.addOrder();

    const decline = await json(await post(failed()));
    expect(decline.body).toMatchObject({ status: "ignored", reason: "retryable_attempt" });
    expect(db.orders.get(ORDER_ID)).toMatchObject({ payment_status: "pending", order_status: "pending" });
    expect(db.restored).toEqual([]);

    const success = await json(await post(succeeded()));
    expect(success.body).toMatchObject({ status: "processed", reason: "marked_paid" });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("paid");
  });

  it("denies the order and restores stock exactly once on a terminal failure", async () => {
    db.addOrder();
    const res = await json(await post(failed({ status: "canceled" })));
    expect(res.body).toMatchObject({ status: "processed", reason: "marked_failed" });
    expect(db.orders.get(ORDER_ID)).toMatchObject({ payment_status: "failed", order_status: "denied" });

    expect((await json(await post(failed({ status: "canceled" })))).body).toMatchObject({
      status: "duplicate",
    });
    expect(db.restored).toEqual([ORDER_ID]);
  });

  it("never overwrites a successful payment when the failure arrives out of order", async () => {
    db.addOrder();
    await post(succeeded());
    const res = await json(await post(failed({ status: "failed" })));
    expect(res.body).toMatchObject({ status: "ignored", reason: "already_paid" });
    expect(db.orders.get(ORDER_ID)).toMatchObject({ payment_status: "paid", order_status: "pending" });
    expect(db.restored).toEqual([]);
  });

  it("does not cancel an order because an intent it no longer uses failed", async () => {
    db.addOrder({ payment_reference: "pi_current" });
    const res = await json(await post(failed({ status: "canceled" })));
    expect(res.body).toMatchObject({ status: "ignored", reason: "intent_not_associated" });
    expect(db.orders.get(ORDER_ID)!.order_status).toBe("pending");
  });

  it("treats separate declined attempts as separate events", async () => {
    db.addOrder();
    await post(failed({ error: { id: "err_1" } }));
    const second = await json(await post(failed({ error: { id: "err_2" } })));
    expect(second.body).toMatchObject({ status: "ignored", reason: "retryable_attempt" });
    expect(db.ledger()).toHaveLength(2);
  });

  it("ignores a failure that is not linked to one of our orders", async () => {
    const res = await json(await post(failed({ metadata: {}, status: "canceled" })));
    expect(res.body).toMatchObject({ status: "ignored", reason: "order_not_found" });
    expect(db.restored).toEqual([]);
  });

  it("returns 500 and stays retryable when the stock restore transaction fails", async () => {
    db.addOrder();
    db.fail("apply_onvo_payment_failed");
    expect((await post(failed({ status: "canceled" }))).status).toBe(500);
    expect(db.orders.get(ORDER_ID)!.order_status).toBe("pending");

    expect((await json(await post(failed({ status: "canceled" })))).body).toMatchObject({
      status: "processed",
    });
    expect(db.restored).toEqual([ORDER_ID]);
  });
});

describe("order ↔ intent association (trusted payment_reference)", () => {
  const OTHER_ORDER_ID = "0b7e2c11-5d9a-4c1e-9f0a-3c2d1e4f5a6b";

  it("never lets an unrelated intent mark an order paid, even with a valid orderId", async () => {
    db.addOrder({ payment_reference: "pi_the_real_one" });
    const res = await json(await post(succeeded({ id: "pi_unrelated" })));

    expect(res.body).toMatchObject({ status: "rejected", reason: "intent_not_associated" });
    expect(db.orders.get(ORDER_ID)).toMatchObject({ payment_status: "pending", paid_at: null });
    expect(notifier.sends).toEqual([]);
    expect(db.ledger()[0]).toMatchObject({ status: "rejected", effects_applied_at: null, order_id: ORDER_ID });
    expect(db.ledger()[0].last_error).toContain("possible misrouted or second charge");
  });

  it("rejects (not ignores) an unrelated intent on an already-paid order — possible second charge", async () => {
    db.addOrder({ payment_status: "paid", paid_at: 1 });
    const res = await json(await post(succeeded({ id: "pi_second_charge" })));
    expect(res.body).toMatchObject({ status: "rejected", reason: "intent_not_associated" });
    expect(db.orders.get(ORDER_ID)!.paid_at).toBe(1);
    expect(errorLogs()).toContainEqual(
      expect.objectContaining({ outcome: "rejected", reason: "intent_not_associated" })
    );
  });

  it("rejects an order whose payment_reference is not an intent at all (hosted session id)", async () => {
    db.addOrder({ payment_reference: "cs_hosted_session_123" });
    const res = await json(await post(succeeded()));
    expect(res.body).toMatchObject({ status: "rejected", reason: "intent_not_associated" });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("pending");
  });

  it("refuses an event whose orderId names a different order than the intent's owner", async () => {
    db.addOrder(); // owns INTENT_ID
    db.addOrder({ id: OTHER_ORDER_ID, payment_reference: "pi_other" });
    const res = await json(await post(succeeded({ metadata: { orderId: OTHER_ORDER_ID } })));

    expect(res.body).toMatchObject({ status: "rejected", reason: "order_mismatch" });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("pending");
    expect(db.orders.get(OTHER_ORDER_ID)!.payment_status).toBe("pending");
    expect(notifier.sends).toEqual([]);
  });

  it("refuses an intent referenced by more than one order", async () => {
    db.addOrder();
    db.addOrder({ id: OTHER_ORDER_ID }); // same INTENT_ID — data error
    const res = await json(await post(succeeded()));
    expect(res.body).toMatchObject({ status: "rejected", reason: "ambiguous_intent" });
    expect([...db.orders.values()].every((o) => o.payment_status === "pending")).toBe(true);
  });

  it("resolves the order from payment_reference when metadata.orderId is absent", async () => {
    db.addOrder();
    const res = await json(await post(succeeded({ metadata: {} })));
    expect(res.body).toMatchObject({ status: "processed", reason: "marked_paid" });
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("paid");
    // Emails go to the DB-resolved order, not to anything from the payload.
    expect(notifier.sentFor).toEqual([ORDER_ID, ORDER_ID]);
  });

  it("does not deny an order because an unrelated intent failed terminally", async () => {
    db.addOrder({ payment_reference: "pi_the_real_one" });
    const res = await json(await post(failed({ id: "pi_unrelated", status: "canceled" })));
    expect(res.body).toMatchObject({ status: "ignored", reason: "intent_not_associated" });
    expect(db.orders.get(ORDER_ID)).toMatchObject({ order_status: "pending", payment_status: "pending" });
    expect(db.restored).toEqual([]);
  });
});

describe("crash window: order committed paid, event not yet terminal", () => {
  /**
   * Puts the DB in exactly the state a worker leaves when it dies right after
   * apply_onvo_payment_succeeded COMMITS: order paid, effects_applied_at set,
   * ledger row still 'processing' with a live lease, no email sent.
   */
  function crashRightAfterApply() {
    const claim = db.sql.claim_webhook_event({
      p_provider: "onvo",
      p_event_id: `payment-intent.succeeded:${INTENT_ID}`,
      p_event_type: "payment-intent.succeeded",
      p_payment_intent_id: INTENT_ID,
      p_payload_hash: "h",
      p_lease_seconds: 120,
    }) as { id: string };
    const applied = db.sql.apply_onvo_payment_succeeded({
      p_webhook_id: claim.id,
      p_order_id: ORDER_ID,
      p_intent_id: INTENT_ID,
      p_amount: 1_890_000,
      p_currency: "CRC",
    }) as { outcome: string };
    expect(applied.outcome).toBe("paid");
    // …and the process is gone: no notifications, no complete_webhook_event.
  }

  it("resumes after the lease: emails once, no second payment effect, terminal state", async () => {
    db.addOrder();
    crashRightAfterApply();
    const paidAt = db.orders.get(ORDER_ID)!.paid_at;
    expect(db.ledger()[0]).toMatchObject({ status: "processing" });
    expect(db.ledger()[0].effects_applied_at).not.toBeNull();

    // A redelivery while the dead worker's lease is live backs off untouched.
    expect((await post(succeeded())).status).toBe(409);
    expect(notifier.sends).toEqual([]);

    db.clock.now += 121_000;
    const resumed = await json(await post(succeeded()));
    expect(resumed).toEqual({
      status: 200,
      body: { received: true, status: "processed", reason: "resumed_after_apply" },
    });
    // The processor used effects_applied from the claim: apply was not re-run.
    expect(db.count("apply_onvo_payment_succeeded")).toBe(0);
    expect(db.orders.get(ORDER_ID)!.paid_at).toBe(paidAt);
    expect(notifier.sends.sort()).toEqual(["customer_order_confirmation", "order_payment_confirmed"]);
    expect(notifier.sentFor).toEqual([ORDER_ID, ORDER_ID]);
    expect(db.ledger()[0]).toMatchObject({
      status: "processed",
      outcome: "resumed_after_apply",
      attempts: 2,
      locked_until: null,
    });

    // Terminal: any later delivery is a pure duplicate.
    expect((await json(await post(succeeded()))).body).toMatchObject({ status: "duplicate" });
    expect(notifier.sends).toHaveLength(2);
  });

  it("recovers when the apply COMMITTED but its response was lost", async () => {
    db.addOrder();
    db.fail("apply_onvo_payment_succeeded", "commit_then_lost");

    const first = await json(await post(succeeded()));
    expect(first.status).toBe(500); // the worker believes it failed…
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("paid"); // …but it committed
    expect(db.ledger()[0].status).toBe("failed");
    expect(notifier.sends).toEqual([]);
    const paidAt = db.orders.get(ORDER_ID)!.paid_at;

    db.clock.now += 5_000;
    const retry = await json(await post(succeeded()));
    expect(retry.body).toMatchObject({ status: "processed", reason: "resumed_after_apply" });
    expect(db.orders.get(ORDER_ID)!.paid_at).toBe(paidAt);
    expect(notifier.sends).toHaveLength(2);
    expect(db.ledger()[0]).toMatchObject({ status: "processed", attempts: 2 });
  });

  it("does not resend emails when the crash came after they were sent", async () => {
    db.addOrder();
    crashRightAfterApply();
    await notifier.notify("order_payment_confirmed", ORDER_ID);
    await notifier.notify("customer_order_confirmation", ORDER_ID);

    db.clock.now += 121_000;
    expect((await json(await post(succeeded()))).body).toMatchObject({ status: "processed" });
    expect(notifier.sends).toHaveLength(2);
    expect(db.ledger()[0].status).toBe("processed");
  });

  it("is backstopped by the DB re-entry guard if apply runs twice for one event", () => {
    db.addOrder();
    crashRightAfterApply();
    const [row] = db.ledger();
    const paidAt = db.orders.get(ORDER_ID)!.paid_at;
    const again = db.sql.apply_onvo_payment_succeeded({
      p_webhook_id: row.id,
      p_order_id: ORDER_ID,
      p_intent_id: INTENT_ID,
      p_amount: 1_890_000,
      p_currency: "CRC",
    });
    expect(again).toEqual({ outcome: "paid", reason: "already_applied", order_id: ORDER_ID });
    expect(db.orders.get(ORDER_ID)!.paid_at).toBe(paidAt);
  });

  it("closes out a failed-payment event whose deny + restore already committed", async () => {
    db.addOrder();
    db.fail("apply_onvo_payment_failed", "commit_then_lost");
    expect((await post(failed({ status: "canceled" }))).status).toBe(500);
    expect(db.orders.get(ORDER_ID)!.order_status).toBe("denied");

    const retry = await json(await post(failed({ status: "canceled" })));
    expect(retry.body).toMatchObject({ status: "processed", reason: "resumed_after_apply" });
    expect(db.restored).toEqual([ORDER_ID]);
    expect(db.count("apply_onvo_payment_failed")).toBe(1);
  });
});

describe("unknown and inert event types", () => {
  it.each([
    "payment-intent.deferred",
    "checkout-session.succeeded",
    "mobile-transfer.received",
    "subscription.renewal.succeeded",
    "some.future-event",
  ])("acknowledges %s with 200 and changes nothing", async (type) => {
    db.addOrder();
    const res = await json(await post({ type, data: { id: "obj_1", metadata: { orderId: ORDER_ID } } }));
    expect(res).toEqual({
      status: 200,
      body: { received: true, status: "ignored", reason: "unhandled_event_type" },
    });
    expect(db.calls).toEqual([]);
    expect(db.orders.get(ORDER_ID)!.payment_status).toBe("pending");
  });
});
