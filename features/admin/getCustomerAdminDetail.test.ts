import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Per-table results + a log of the filters each table query received. */
const { state } = vi.hoisted(() => ({
  state: {
    results: {} as Record<string, { data: unknown; error: any; count?: number | null }>,
    calls: [] as { table: string; method: string; args: unknown[] }[],
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const result = () => state.results[table] ?? { data: null, error: null };
      const builder: any = {
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve, reject),
      };
      for (const method of ["select", "eq", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          state.calls.push({ table, method, args });
          return builder;
        };
      }
      builder.maybeSingle = async () => result();
      return builder;
    },
  }),
}));

import { getCustomerAdminDetail, mapCustomerOrder } from "./getCustomerAdminDetail";

const UID = "11111111-1111-4111-8111-111111111111";

const PROFILE = {
  id: UID,
  full_name: "Aurora Vega",
  username: "aurora",
  avatar_url: null,
  phone: null,
  role: "customer",
  experience_points: 10_500,
  created_at: "2026-01-01T00:00:00Z",
  is_profile_public: true,
  show_in_ranking: false,
};

function rawOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    order_number: 1001,
    customer_name: "Aurora Vega",
    customer_email: "a@example.com",
    customer_phone: "8888-8888",
    subtotal: 30_000,
    discount: 0,
    shipping_cost: 2_900,
    total: 32_900,
    order_status: "received",
    payment_status: "paid",
    source: "web",
    created_at: "2026-10-01T10:00:00Z",
    order_items: [
      {
        id: "i-1",
        product_name: "Sauvage",
        brand_name: "Dior",
        size_ml: 100,
        quantity: 1,
        unit_price: 30_000,
        line_total: 30_000,
      },
    ],
    profile_experience_events: { xp_earned: 1_500 },
    ...overrides,
  };
}

describe("getCustomerAdminDetail", () => {
  beforeEach(() => {
    state.calls = [];
    state.results = {
      profiles: { data: PROFILE, error: null },
      orders: { data: [rawOrder()], error: null, count: 1 },
      profile_xp_adjustments: { data: [], error: null },
    };
  });

  it("returns null for an unknown customer", async () => {
    state.results.profiles = { data: null, error: null };
    expect(await getCustomerAdminDetail(UID)).toBeNull();
  });

  it("throws when the profile itself can't be read (error boundary)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.results.profiles = { data: null, error: { message: "boom" } };
    await expect(getCustomerAdminDetail(UID)).rejects.toThrow();
  });

  it("derives XP + rank from the stored balance via lib/rank", async () => {
    const detail = await getCustomerAdminDetail(UID);
    expect(detail?.xp).toMatchObject({
      experiencePoints: 10_500,
      currentRank: "Alquimista",
      nextRank: "Maestro",
    });
  });

  it("scopes the order history to this customer, newest first", async () => {
    await getCustomerAdminDetail(UID);

    const orderCalls = state.calls.filter((c) => c.table === "orders");
    expect(orderCalls).toContainEqual({ table: "orders", method: "eq", args: ["user_id", UID] });
    expect(orderCalls).toContainEqual({
      table: "orders",
      method: "order",
      args: ["created_at", { ascending: false }],
    });
  });

  it("loads lines and XP in the same orders query (no N+1)", async () => {
    await getCustomerAdminDetail(UID);

    const selects = state.calls.filter((c) => c.table === "orders" && c.method === "select");
    expect(selects).toHaveLength(1);
    expect(String(selects[0].args[0])).toMatch(/order_items\s*\(/);
    expect(String(selects[0].args[0])).toMatch(/profile_experience_events\s*\(/);
  });

  it("maps orders with their items, totals and XP", async () => {
    const detail = await getCustomerAdminDetail(UID);

    expect(detail?.orders).toHaveLength(1);
    expect(detail?.orders[0]).toMatchObject({
      order_number: 1001,
      total: 32_900,
      order_status: "received",
      xp_earned: 1_500,
      items: [{ product_name: "Sauvage", quantity: 1 }],
    });
    expect(detail?.ordersTotal).toBe(1);
    expect(detail?.ordersLoaded).toBe(true);
  });

  it("keeps the page up when orders fail, flagging it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.results.orders = { data: null, error: { message: "boom" } };

    const detail = await getCustomerAdminDetail(UID);

    expect(detail?.orders).toEqual([]);
    expect(detail?.ordersLoaded).toBe(false);
  });

  it("reports adjustments as unavailable when the ledger is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    state.results.profile_xp_adjustments = {
      data: null,
      error: { message: 'relation "public.profile_xp_adjustments" does not exist' },
    };

    const detail = await getCustomerAdminDetail(UID);

    expect(detail?.adjustments).toBeNull();
    expect(detail?.profile.id).toBe(UID);
  });
});

describe("mapCustomerOrder", () => {
  it("handles an order with no XP event and no items", () => {
    const mapped = mapCustomerOrder(
      rawOrder({ order_items: null, profile_experience_events: null }) as never
    );
    expect(mapped.items).toEqual([]);
    expect(mapped.xp_earned).toBeNull();
  });

  it("tolerates the embed coming back as an array", () => {
    const mapped = mapCustomerOrder(
      rawOrder({ profile_experience_events: [{ xp_earned: 50 }] }) as never
    );
    expect(mapped.xp_earned).toBe(50);
  });
});
