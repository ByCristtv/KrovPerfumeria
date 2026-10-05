import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { CheckoutError } from "./errors";

/**
 * Proves the coupon reaches the ORDER and the PAYMENT, not just the summary.
 *
 * The discount itself is computed by the apply_order_coupon RPC (mocked here —
 * its maths and its race behaviour are database concerns). What this suite pins
 * is the orchestration around it: the coupon is spent before any payment exists,
 * the payment is prepared for the discounted total, a rejected coupon leaves
 * nothing charged or reserved, and changing the coupon mid-checkout retires the
 * old order rather than editing a total that a payment was already made for.
 */

const { orderService, couponService, processor, tokens } = vi.hoisted(() => ({
  orderService: {
    placeOrder: vi.fn(),
    loadOrder: vi.fn(),
    calculateShipping: vi.fn(),
    setShippingTotals: vi.fn(),
    updateOrder: vi.fn(),
    stampPayment: vi.fn(),
    cancelOrder: vi.fn(),
    itemsMatch: vi.fn(),
  },
  couponService: { applyCouponToOrder: vi.fn() },
  processor: {
    provider: "onvo" as const,
    createPayment: vi.fn(),
    updatePayment: vi.fn(),
    releasePayment: vi.fn(),
  },
  tokens: { signOrderToken: vi.fn(() => "signed-token") },
}));

vi.mock("./orderService", () => orderService);
vi.mock("./couponService", () => couponService);
vi.mock("./payments/registry", () => ({
  getPaymentProcessor: () => processor,
  findProcessorByProvider: () => processor,
}));
vi.mock("@/lib/orders/tokens", () => ({
  ...tokens,
  verifyOrderToken: () => true,
}));

import { submitCheckout } from "./checkoutService";

const SUBTOTAL = 100_000;
const ZONE_RATE = 3_500;
const DISCOUNT = 18_000;
const COUPON_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_COUPON_ID = "33333333-3333-4333-8333-333333333333";

const deps = {
  supabase: { tag: "user-client" } as unknown as SupabaseClient<Database>,
  admin: { tag: "admin-client" } as unknown as SupabaseClient<Database>,
};

const sanJose = {
  address: "200m sur de la iglesia, casa azul",
  canton_code: "101",
  canton_name: "San José",
  province_name: "San José",
  district: "Carmen",
};

const input = (
  extra: {
    user_coupon_id?: string | null;
    session?: { order_id: string; order_token: string };
  } = {}
) => ({
  customer: { name: "María Pérez", email: "maria@correo.com", phone: "88888888" },
  shipping: sanJose,
  items: [{ variant_id: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
  payment_method: "card" as const,
  ...extra,
});

/** What place_order returns: full subtotal, no coupon knowledge. */
const placed = {
  order_id: "order-1",
  order_number: 1001,
  subtotal: SUBTOTAL,
  shipping_cost: ZONE_RATE,
  total: SUBTOTAL + ZONE_RATE,
  item_count: 1,
  shipping: {
    cost: ZONE_RATE,
    zone_code: "gam",
    zone_name: "GAM",
    free_shipping_applied: false,
    free_shipping_threshold: null,
  },
};

const applied = {
  order_id: "order-1",
  user_coupon_id: COUPON_ID,
  coupon_code: "MAESTRO-18",
  coupon_name: "Cupón Maestro",
  discount_amount: DISCOUNT,
  subtotal: SUBTOTAL,
  shipping_cost: ZONE_RATE,
  total: SUBTOTAL - DISCOUNT + ZONE_RATE,
};

beforeEach(() => {
  vi.clearAllMocks();
  orderService.placeOrder.mockResolvedValue(placed);
  orderService.calculateShipping.mockResolvedValue(ZONE_RATE);
  orderService.setShippingTotals.mockResolvedValue(undefined);
  orderService.stampPayment.mockResolvedValue(undefined);
  orderService.updateOrder.mockResolvedValue(undefined);
  orderService.cancelOrder.mockResolvedValue(undefined);
  orderService.itemsMatch.mockReturnValue(true);
  couponService.applyCouponToOrder.mockResolvedValue(applied);
  processor.createPayment.mockResolvedValue({
    kind: "onvo_card",
    intent_id: "intent-1",
    customer_id: "cus-1",
    public_key: "pk",
  });
  processor.updatePayment.mockResolvedValue({ changed: false });
});

describe("a new order — with a coupon", () => {
  it("spends the coupon through the customer's own client, on the order just placed", async () => {
    await submitCheckout(deps, input({ user_coupon_id: COUPON_ID }));

    // The RLS client, not the admin one: the RPC reads auth.uid().
    expect(couponService.applyCouponToOrder).toHaveBeenCalledWith(
      deps.supabase,
      "order-1",
      COUPON_ID
    );
  });

  it("reports the database's discount and the discounted total", async () => {
    const result = await submitCheckout(
      deps,
      input({ user_coupon_id: COUPON_ID })
    );

    expect(result.discount).toBe(DISCOUNT);
    expect(result.user_coupon_id).toBe(COUPON_ID);
    expect(result.total).toBe(SUBTOTAL - DISCOUNT + ZONE_RATE);
  });

  it("prepares the payment for the discounted total, not the full one", async () => {
    await submitCheckout(deps, input({ user_coupon_id: COUPON_ID }));

    expect(processor.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ total: SUBTOTAL - DISCOUNT + ZONE_RATE })
    );
  });

  it("spends the coupon BEFORE the payment exists", async () => {
    await submitCheckout(deps, input({ user_coupon_id: COUPON_ID }));

    expect(
      couponService.applyCouponToOrder.mock.invocationCallOrder[0]
    ).toBeLessThan(processor.createPayment.mock.invocationCallOrder[0]);
  });

  it("needs no extra order write — the RPC already stored the discounted total", async () => {
    await submitCheckout(deps, input({ user_coupon_id: COUPON_ID }));

    expect(orderService.setShippingTotals).not.toHaveBeenCalled();
  });

  it("stacks with free local delivery: both reductions come off one total", async () => {
    await submitCheckout(
      deps,
      {
        ...input({ user_coupon_id: COUPON_ID }),
        shipping: {
          ...sanJose,
          canton_code: "702",
          canton_name: "Pococí",
          province_name: "Limón",
          district: "Cariari",
          local_delivery: true,
        },
      }
    );

    // 100,000 − 18,000 coupon + 0 shipping
    expect(orderService.setShippingTotals).toHaveBeenCalledWith(
      deps.admin,
      "order-1",
      0,
      SUBTOTAL - DISCOUNT
    );
    expect(processor.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ total: SUBTOTAL - DISCOUNT })
    );
  });
});

describe("a new order — the coupon is rejected", () => {
  const rejection = new CheckoutError(
    "coupon_min_subtotal",
    "Este cupón requiere una compra mínima de ₡25.000.",
    409
  );

  beforeEach(() => {
    couponService.applyCouponToOrder.mockRejectedValue(rejection);
  });

  it("surfaces the database's reason to the caller", async () => {
    await expect(
      submitCheckout(deps, input({ user_coupon_id: COUPON_ID }))
    ).rejects.toBe(rejection);
  });

  it("cancels the order, restoring the stock it reserved", async () => {
    await expect(
      submitCheckout(deps, input({ user_coupon_id: COUPON_ID }))
    ).rejects.toThrow();

    expect(orderService.cancelOrder).toHaveBeenCalledWith(
      deps.admin,
      "order-1",
      expect.any(String)
    );
  });

  it("never prepares a payment, so nothing can be charged", async () => {
    await expect(
      submitCheckout(deps, input({ user_coupon_id: COUPON_ID }))
    ).rejects.toThrow();

    expect(processor.createPayment).not.toHaveBeenCalled();
    expect(orderService.stampPayment).not.toHaveBeenCalled();
  });
});

describe("a new order — without a coupon", () => {
  it("does not touch the coupon RPC at all", async () => {
    const result = await submitCheckout(deps, input());

    expect(couponService.applyCouponToOrder).not.toHaveBeenCalled();
    expect(result.discount).toBe(0);
    expect(result.user_coupon_id).toBeNull();
    expect(result.total).toBe(SUBTOTAL + ZONE_RATE);
  });

  it("treats an explicit null the same as omitting it", async () => {
    await submitCheckout(deps, input({ user_coupon_id: null }));

    expect(couponService.applyCouponToOrder).not.toHaveBeenCalled();
  });
});

describe("an existing order", () => {
  const SESSION = { order_id: "order-0", order_token: "tok" };

  const existing = (overrides: Record<string, unknown> = {}) => ({
    id: "order-0",
    order_number: 1000,
    subtotal: SUBTOTAL,
    shipping_cost: ZONE_RATE,
    discount: DISCOUNT,
    total: SUBTOTAL - DISCOUNT + ZONE_RATE,
    user_coupon_id: COUPON_ID,
    order_status: "pending",
    payment_status: "pending",
    payment_provider: "onvo",
    payment_reference: "intent-0",
    items: [{ variant_id: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
    ...overrides,
  });

  it("keeps the order when the coupon is unchanged, and carries the discount into the new total", async () => {
    orderService.loadOrder.mockResolvedValue(existing());
    orderService.calculateShipping.mockResolvedValue(6_000);

    const result = await submitCheckout(
      deps,
      input({ user_coupon_id: COUPON_ID, session: SESSION })
    );

    expect(orderService.cancelOrder).not.toHaveBeenCalled();
    expect(orderService.placeOrder).not.toHaveBeenCalled();
    // subtotal − carried discount + the re-priced shipping
    expect(result.total).toBe(SUBTOTAL - DISCOUNT + 6_000);
    expect(result.discount).toBe(DISCOUNT);
    expect(processor.updatePayment).toHaveBeenCalledWith(
      expect.objectContaining({ total: SUBTOTAL - DISCOUNT + 6_000 }),
      expect.anything()
    );
  });

  it("retires the order and places a fresh one when the customer switches coupons", async () => {
    orderService.loadOrder.mockResolvedValue(existing());

    await submitCheckout(
      deps,
      input({ user_coupon_id: OTHER_COUPON_ID, session: SESSION })
    );

    expect(orderService.cancelOrder).toHaveBeenCalledWith(
      deps.admin,
      "order-0",
      expect.any(String)
    );
    expect(orderService.placeOrder).toHaveBeenCalledTimes(1);
    expect(couponService.applyCouponToOrder).toHaveBeenCalledWith(
      deps.supabase,
      "order-1",
      OTHER_COUPON_ID
    );
  });

  it("cancels BEFORE re-placing, so the old coupon is handed back first", async () => {
    orderService.loadOrder.mockResolvedValue(existing());

    await submitCheckout(
      deps,
      input({ user_coupon_id: OTHER_COUPON_ID, session: SESSION })
    );

    // trg_orders_sync_coupon returns the coupon when the old order is denied; if
    // the replacement were placed first it could be refused as "not available".
    expect(orderService.cancelOrder.mock.invocationCallOrder[0]).toBeLessThan(
      orderService.placeOrder.mock.invocationCallOrder[0]
    );
  });

  it("retires the order when the coupon is removed", async () => {
    orderService.loadOrder.mockResolvedValue(existing());

    const result = await submitCheckout(
      deps,
      input({ user_coupon_id: null, session: SESSION })
    );

    expect(orderService.cancelOrder).toHaveBeenCalledTimes(1);
    expect(couponService.applyCouponToOrder).not.toHaveBeenCalled();
    expect(result.discount).toBe(0);
    expect(result.total).toBe(SUBTOTAL + ZONE_RATE);
  });

  it("does not mistake an order with no coupon for one whose coupon changed", async () => {
    // Legacy rows / mocks may omit the new columns entirely.
    orderService.loadOrder.mockResolvedValue(
      existing({ user_coupon_id: undefined, discount: undefined, total: SUBTOTAL + ZONE_RATE })
    );

    const result = await submitCheckout(deps, input({ session: SESSION }));

    expect(orderService.cancelOrder).not.toHaveBeenCalled();
    expect(result.discount).toBe(0);
    expect(result.total).toBe(SUBTOTAL + ZONE_RATE);
  });
});
