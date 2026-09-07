import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Proves the "Cariari centro" rule reaches the ORDER, not just the summary.
 *
 * The display-side rule is covered by lib/shipping/localDelivery.test.ts. What
 * matters here is the wiring: shipping is computed inside Postgres, so unless
 * `submitCheckout` writes the override back and prepares the payment for the
 * reduced total, a customer would see "Gratis" and still be charged for
 * delivery. Everything below the service — the RPCs, the payment provider — is
 * mocked, because none of it is the thing under test.
 */

const { orderService, processor, tokens } = vi.hoisted(() => ({
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
  processor: {
    provider: "onvo" as const,
    createPayment: vi.fn(),
    updatePayment: vi.fn(),
    releasePayment: vi.fn(),
  },
  tokens: { signOrderToken: vi.fn(() => "signed-token") },
}));

vi.mock("./orderService", () => orderService);
vi.mock("./payments/registry", () => ({
  getPaymentProcessor: () => processor,
  findProcessorByProvider: () => processor,
}));
vi.mock("@/lib/orders/tokens", () => ({
  ...tokens,
  verifyOrderToken: () => true,
}));

import { submitCheckout } from "./checkoutService";

const SUBTOTAL = 40_000;
const ZONE_RATE = 3_500;

const deps = {
  supabase: {} as SupabaseClient<Database>,
  admin: {} as SupabaseClient<Database>,
};

const cariariShipping = {
  address: "200m sur de la escuela, casa verde",
  canton_code: "702",
  canton_name: "Pococí",
  province_name: "Limón",
  district: "Cariari",
};

const input = (
  shipping: Partial<typeof cariariShipping> & { local_delivery?: boolean } = {}
) => ({
  customer: { name: "María Pérez", email: "maria@correo.com", phone: "88888888" },
  shipping: { ...cariariShipping, ...shipping },
  items: [{ variant_id: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
  payment_method: "card" as const,
});

/** What place_order returns: the zone rate, before any override. */
const placedAtZoneRate = {
  order_id: "order-1",
  order_number: 1001,
  subtotal: SUBTOTAL,
  shipping_cost: ZONE_RATE,
  total: SUBTOTAL + ZONE_RATE,
  item_count: 1,
  shipping: {
    cost: ZONE_RATE,
    zone_code: "rural",
    zone_name: "Rural",
    free_shipping_applied: false,
    free_shipping_threshold: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  orderService.placeOrder.mockResolvedValue(placedAtZoneRate);
  orderService.calculateShipping.mockResolvedValue(ZONE_RATE);
  orderService.setShippingTotals.mockResolvedValue(undefined);
  orderService.stampPayment.mockResolvedValue(undefined);
  orderService.itemsMatch.mockReturnValue(true);
  processor.createPayment.mockResolvedValue({
    kind: "onvo_card",
    intent_id: "intent-1",
    customer_id: "cus-1",
    public_key: "pk",
  });
});

describe("a new order — free shipping activates", () => {
  it("reports a zero shipping cost to the client", async () => {
    const result = await submitCheckout(deps, input({ local_delivery: true }));

    expect(result.shipping_cost).toBe(0);
    expect(result.total).toBe(SUBTOTAL);
  });

  it("writes the reduced cost and total back to the order", async () => {
    await submitCheckout(deps, input({ local_delivery: true }));

    // Without this the row would keep place_order's zone rate, and the customer
    // would be charged for delivery they were told was free.
    expect(orderService.setShippingTotals).toHaveBeenCalledWith(
      deps.admin,
      "order-1",
      0,
      SUBTOTAL
    );
  });

  it("prepares the payment for the reduced total, not the zone-rate total", async () => {
    await submitCheckout(deps, input({ local_delivery: true }));

    expect(processor.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ total: SUBTOTAL })
    );
  });

  it("writes the override before charging, so a failed write charges nothing", async () => {
    orderService.setShippingTotals.mockRejectedValue(new Error("db down"));

    await expect(
      submitCheckout(deps, input({ local_delivery: true }))
    ).rejects.toThrow("db down");

    expect(processor.createPayment).not.toHaveBeenCalled();
    expect(orderService.cancelOrder).toHaveBeenCalledWith(
      deps.admin,
      "order-1",
      "Shipping override failed"
    );
  });
});

describe("a new order — standard shipping is retained", () => {
  it("leaves the zone rate alone when the box is unchecked", async () => {
    const result = await submitCheckout(deps, input({ local_delivery: false }));

    expect(result.shipping_cost).toBe(ZONE_RATE);
    expect(result.total).toBe(SUBTOTAL + ZONE_RATE);
    expect(orderService.setShippingTotals).not.toHaveBeenCalled();
  });

  it("leaves it alone when the flag is absent entirely", async () => {
    const result = await submitCheckout(deps, input());
    expect(result.shipping_cost).toBe(ZONE_RATE);
  });

  it("ignores the flag for another district of the same cantón", async () => {
    const result = await submitCheckout(
      deps,
      input({ district: "Guápiles", local_delivery: true })
    );

    expect(result.shipping_cost).toBe(ZONE_RATE);
    expect(orderService.setShippingTotals).not.toHaveBeenCalled();
  });

  it("ignores a forged flag on a Cariari-named district elsewhere", async () => {
    const result = await submitCheckout(
      deps,
      input({
        canton_code: "401",
        canton_name: "Heredia",
        province_name: "Heredia",
        district: "Cariari",
        local_delivery: true,
      })
    );

    expect(result.shipping_cost).toBe(ZONE_RATE);
    expect(processor.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ total: SUBTOTAL + ZONE_RATE })
    );
  });
});

describe("editing an existing order", () => {
  const pending = {
    id: "order-1",
    order_number: 1001,
    subtotal: SUBTOTAL,
    shipping_cost: ZONE_RATE,
    total: SUBTOTAL + ZONE_RATE,
    order_status: "pending" as const,
    payment_status: "pending" as const,
    payment_provider: "onvo" as const,
    payment_reference: "intent-1",
    items: [{ variant_id: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
  };
  const session = { order_id: "order-1", order_token: "signed-token" };

  beforeEach(() => {
    orderService.loadOrder.mockResolvedValue(pending);
    processor.updatePayment.mockResolvedValue({ changed: false });
  });

  it("applies the override on the update path too", async () => {
    const result = await submitCheckout(deps, {
      ...input({ local_delivery: true }),
      session,
    });

    expect(result.shipping_cost).toBe(0);
    expect(orderService.updateOrder).toHaveBeenCalledWith(
      deps.admin,
      "order-1",
      expect.objectContaining({ shipping_cost: 0, total: SUBTOTAL })
    );
  });

  it("restores the standard rate when the box is unticked on an edit", async () => {
    const result = await submitCheckout(deps, {
      ...input({ local_delivery: false }),
      session,
    });

    expect(result.shipping_cost).toBe(ZONE_RATE);
    expect(orderService.updateOrder).toHaveBeenCalledWith(
      deps.admin,
      "order-1",
      expect.objectContaining({ shipping_cost: ZONE_RATE })
    );
  });

  it("restores the standard rate when the address is edited away from Cariari", async () => {
    // The stale-checkbox path: the flag is still true, the address no longer is.
    const result = await submitCheckout(deps, {
      ...input({
        canton_code: "101",
        canton_name: "San José",
        province_name: "San José",
        district: "Carmen",
        local_delivery: true,
      }),
      session,
    });

    expect(result.shipping_cost).toBe(ZONE_RATE);
    expect(result.total).toBe(SUBTOTAL + ZONE_RATE);
  });
});
