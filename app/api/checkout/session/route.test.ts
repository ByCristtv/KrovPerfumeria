// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * POST /api/checkout/session, end to end, for the supplier-availability feature.
 *
 * Real: the route, the zod payload schema, checkoutService and orderService
 * (including the place_order error translation). Faked, because they are the true
 * externals: Supabase, the payment processors and the email notifier.
 *
 * What this pins - the same guarantees supabase/tests/20261029000100_*_test.sql
 * proves inside the database, but at the HTTP boundary a forged request or a
 * stale cart actually hits:
 *   - a line KROV cannot ship (made to order, sold out, drained decant pool) is
 *     refused with a recoverable 409 - and NOTHING downstream happens: no payment
 *     is prepared, no email is sent, no cleanup of a half-made order is needed;
 *   - the client can never smuggle a price, stock or supplier flag into the order;
 *   - an ordinary in-stock purchase still flows through to payment and (for SINPE)
 *     notifications exactly as before.
 */

const VARIANT = "11111111-1111-4111-8111-111111111111";
const OTHER_VARIANT = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "fc006d09-ae68-4f9e-832f-50a458ca5040";

const h = vi.hoisted(() => {
  process.env.ORDER_TOKEN_SECRET = "t".repeat(48);
  return {
    rpcCalls: [] as Array<{ name: string; args: any }>,
    placeOrder: { data: null, error: null } as { data: any; error: any },
    adminCalls: [] as string[],
    cardCreatePayment: vi.fn(),
    sinpeCreatePayment: vi.fn(),
    notifyNewSinpeOrder: vi.fn<(orderId: string, deps?: unknown) => Promise<object>>(
      async () => ({})
    ),
    notifyCustomerOrderConfirmation: vi.fn<
      (orderId: string, deps?: unknown) => Promise<object>
    >(async () => ({})),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      return name === "place_order" ? h.placeOrder : { data: null, error: null };
    },
  }),
}));

// The service-role client. Any use of it means "an order existed to be fixed up"
// (stamp / cancel), so on a refused purchase it must stay untouched.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => {
      h.adminCalls.push(`rpc:${name}`);
      return { data: null, error: null };
    },
    from: (table: string) => {
      h.adminCalls.push(`from:${table}`);
      return { update: () => ({ eq: async () => ({ error: null }) }) };
    },
  }),
}));

vi.mock("@/lib/checkout/payments/registry", () => {
  const card = {
    provider: "onvo",
    createPayment: (...a: unknown[]) => h.cardCreatePayment(...a),
    updatePayment: vi.fn(),
    releasePayment: vi.fn(),
  };
  const sinpe = {
    provider: "manual_sinpe",
    createPayment: (...a: unknown[]) => h.sinpeCreatePayment(...a),
    updatePayment: vi.fn(),
    releasePayment: vi.fn(),
  };
  return {
    getPaymentProcessor: (method: string) => (method === "sinpe" ? sinpe : card),
    findProcessorByProvider: (p: string) => (p === "manual_sinpe" ? sinpe : card),
  };
});

vi.mock("@/lib/notifications/orderNotifier", () => ({
  notifyNewSinpeOrder: (...a: unknown[]) => (h.notifyNewSinpeOrder as any)(...a),
  notifyCustomerOrderConfirmation: (...a: unknown[]) =>
    (h.notifyCustomerOrderConfirmation as any)(...a),
}));

import { POST } from "./route";

// ─────────────────────────────────────────────────────────────────────────────

function payload(over: Record<string, unknown> = {}) {
  return {
    customer: { name: "María Pérez", email: "maria@correo.com", phone: "88888888" },
    shipping: {
      address: "200m sur de la iglesia, casa azul",
      canton_code: "101",
      canton_name: "San José",
      province_name: "San José",
      district: "Carmen",
    },
    items: [{ variant_id: VARIANT, quantity: 1 }],
    payment_method: "card",
    ...over,
  };
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/checkout/session", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

const placedOk = {
  data: {
    order_id: ORDER_ID,
    order_number: 1042,
    subtotal: 21_000,
    shipping_cost: 2_500,
    total: 23_500,
    item_count: 1,
    shipping: { cost: 2_500, zone_code: "gam", zone_name: "GAM" },
  },
  error: null,
};

const stockError = (message: string) => ({ data: null, error: { message } });

beforeEach(() => {
  vi.clearAllMocks();
  h.rpcCalls.length = 0;
  h.adminCalls.length = 0;
  h.placeOrder = placedOk;
  h.cardCreatePayment.mockResolvedValue({
    kind: "onvo_card",
    intent_id: "intent_1",
    customer_id: "cus_1",
    public_key: "pk_test",
  });
  h.sinpeCreatePayment.mockResolvedValue({
    kind: "manual_sinpe",
    instructions_path: `/checkout/sinpe/${ORDER_ID}`,
  });
});

const placeOrderPayload = () =>
  h.rpcCalls.find((c) => c.name === "place_order")?.args?.p_payload;

// ─────────────────────────────────────────────────────────────────────────────
describe("a line KROV cannot ship is refused, and nothing downstream runs", () => {
  it.each([
    ["a made-to-order / sold-out bottle", "Insufficient stock for variant 1111. Available: 0, requested: 1."],
    ["a stale cart that outlived the stock", "Insufficient stock for variant 1111. Available: 0, requested: 2."],
    ["a drained decant pool", "Insufficient decant liquid for product 3333. Available: 2 ml, requested: 5 ml."],
  ])("%s -> 409 stock_unavailable", async (_label, dbMessage) => {
    h.placeOrder = stockError(dbMessage);

    const res = await post(payload());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe("stock_unavailable");
    // The Spanish copy the cart screen shows - no database text in the message.
    // (The response also carries a raw `hint`; that is existing behavior, reported
    // separately, and deliberately not pinned here.)
    expect(json.message).toMatch(/ya no hay stock suficiente/i);
    expect(json.message).not.toMatch(/Insufficient|Available:|variant 1111/);
  });

  it.each(["card", "sinpe"])(
    "with payment method %s: no payment prepared, no email sent, no order to clean up",
    async (payment_method) => {
      h.placeOrder = stockError("Insufficient stock for variant 1111. Available: 0, requested: 1.");

      await post(payload({ payment_method }));

      expect(h.cardCreatePayment).not.toHaveBeenCalled();
      expect(h.sinpeCreatePayment).not.toHaveBeenCalled();
      expect(h.notifyNewSinpeOrder).not.toHaveBeenCalled();
      expect(h.notifyCustomerOrderConfirmation).not.toHaveBeenCalled();
      // place_order is all-or-nothing, so there is nothing for the service role
      // to stamp or cancel.
      expect(h.adminCalls).toEqual([]);
    }
  );

  it("a deactivated variant is a different, still recoverable, error (410)", async () => {
    h.placeOrder = stockError("Variant SKU-1 (Lion) is no longer available for sale.");

    const res = await post(payload());

    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("variant_unavailable");
    expect(h.cardCreatePayment).not.toHaveBeenCalled();
  });

  it("a cart mixing an in-stock line with a refused one fails as a whole", async () => {
    h.placeOrder = stockError("Insufficient stock for variant 2222. Available: 0, requested: 1.");

    const res = await post(
      payload({
        items: [
          { variant_id: VARIANT, quantity: 1 },
          { variant_id: OTHER_VARIANT, quantity: 1 },
        ],
      })
    );

    expect(res.status).toBe(409);
    expect(h.cardCreatePayment).not.toHaveBeenCalled();
    expect(h.adminCalls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("the client cannot dictate price, stock or supplier availability", () => {
  const forged = {
    items: [
      {
        variant_id: VARIANT,
        quantity: 2,
        price: 1,
        unit_price: 1,
        offer_price: 1,
        stock: 999,
        supplier_available: true,
        is_active: true,
        is_on_offer: true,
      },
    ],
    subtotal: 1,
    total: 1,
    discount: 99_999,
    shipping_cost: 0,
    supplier_available: true,
  };

  it("forwards exactly {variant_id, quantity} per line to place_order", async () => {
    h.placeOrder = stockError("Insufficient stock for variant 1111. Available: 0, requested: 2.");

    await post(payload(forged));

    expect(placeOrderPayload().items).toEqual([{ variant_id: VARIANT, quantity: 2 }]);
  });

  it("drops every forged money / supplier field before the database sees it", async () => {
    h.placeOrder = stockError("Insufficient stock for variant 1111. Available: 0, requested: 2.");

    await post(payload(forged));

    const sent = JSON.stringify(placeOrderPayload());
    for (const key of [
      "price", "unit_price", "offer_price", "stock", "supplier_available",
      "is_active", "is_on_offer", "subtotal", "total", "discount", "shipping_cost",
    ]) {
      expect(sent, `"${key}" must not reach place_order`).not.toContain(`"${key}"`);
    }
  });

  it.each([
    ["zero quantity", [{ variant_id: VARIANT, quantity: 0 }]],
    ["negative quantity", [{ variant_id: VARIANT, quantity: -1 }]],
    ["an absurd quantity", [{ variant_id: VARIANT, quantity: 100 }]],
    ["a fractional quantity", [{ variant_id: VARIANT, quantity: 1.5 }]],
    ["a non-uuid variant", [{ variant_id: "not-a-uuid", quantity: 1 }]],
    ["no lines at all", []],
  ])("rejects %s before touching the database", async (_label, items) => {
    const res = await post(payload({ items }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation_failed");
    expect(h.rpcCalls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("an ordinary in-stock purchase is unchanged", () => {
  it("card: places the order, prepares the Onvo payment for the DB total, stays silent", async () => {
    const res = await post(payload());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(h.rpcCalls.filter((c) => c.name === "place_order")).toHaveLength(1);
    expect(h.cardCreatePayment).toHaveBeenCalledTimes(1);
    expect(h.cardCreatePayment.mock.calls[0][0]).toMatchObject({
      order_id: ORDER_ID,
      total: 23_500, // the database's total, never one the client supplied
    });
    expect(json).toMatchObject({
      order_id: ORDER_ID,
      order_number: 1042,
      total: 23_500,
      payment_method: "card",
      payment: { kind: "onvo_card", intent_id: "intent_1" },
    });
    expect(typeof json.order_token).toBe("string");
    // Card orders notify only once the Onvo webhook confirms payment.
    expect(h.notifyNewSinpeOrder).not.toHaveBeenCalled();
    expect(h.notifyCustomerOrderConfirmation).not.toHaveBeenCalled();
    expect(h.sinpeCreatePayment).not.toHaveBeenCalled();
  });

  it("SINPE: prepares the transfer instructions and notifies owner + customer once each", async () => {
    const res = await post(payload({ payment_method: "sinpe" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(h.sinpeCreatePayment).toHaveBeenCalledTimes(1);
    expect(h.cardCreatePayment).not.toHaveBeenCalled();
    expect(json.payment).toEqual({
      kind: "manual_sinpe",
      instructions_path: `/checkout/sinpe/${ORDER_ID}`,
    });
    expect(h.notifyNewSinpeOrder).toHaveBeenCalledTimes(1);
    expect(h.notifyNewSinpeOrder.mock.calls[0][0]).toBe(ORDER_ID);
    expect(h.notifyCustomerOrderConfirmation).toHaveBeenCalledTimes(1);
    expect(h.notifyCustomerOrderConfirmation.mock.calls[0][0]).toBe(ORDER_ID);
  });

  it("stamps the payment provider on the order it just made (service role, orders only)", async () => {
    await post(payload());
    expect(h.adminCalls).toEqual(["from:orders"]);
  });
});
