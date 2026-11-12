import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  describeLinkXp,
  linkErrorMessage,
  linkOrderToCustomer,
  mapUnlinkedOrderRow,
  matchSignals,
  phoneKey,
  previewLinkXp,
  searchLinkableCustomers,
} from "./orderLinking";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("previewLinkXp — mirrors grant_order_xp's eligibility and formula", () => {
  it("awards now for received and shipped orders, on subtotal − discount", () => {
    expect(previewLinkXp({ order_status: "received", subtotal: 42_900, discount: 0 })).toEqual({
      kind: "now",
      xp: 2_100, // floor(42.9) × 50
    });
    expect(previewLinkXp({ order_status: "shipped", subtotal: 40_000, discount: 3_200 })).toEqual({
      kind: "now",
      xp: 1_800, // floor(36.8) × 50
    });
  });

  it("defers pending orders to the status trigger", () => {
    expect(previewLinkXp({ order_status: "pending", subtotal: 10_000, discount: 0 })).toEqual({
      kind: "later",
      xp: 500,
    });
  });

  it("never awards a cancelled order", () => {
    expect(previewLinkXp({ order_status: "denied", subtotal: 50_000, discount: 0 })).toEqual({
      kind: "never",
    });
  });

  it("rounds down below ₡1.000 to zero", () => {
    expect(previewLinkXp({ order_status: "received", subtotal: 999, discount: 0 })).toEqual({
      kind: "now",
      xp: 0,
    });
  });
});

describe("matchSignals / phoneKey", () => {
  it("compares phones by their last 8 digits, ignoring formatting and +506", () => {
    expect(phoneKey("8888-1234")).toBe("88881234");
    expect(phoneKey("+506 8888 1234")).toBe("88881234");
    expect(phoneKey("123")).toBeNull();
    expect(phoneKey(null)).toBeNull();

    expect(
      matchSignals(
        { customer_email: null, customer_phone: "+506 8888-1234" },
        { email: "ana@correo.com", phone: "88881234" }
      )
    ).toEqual({ email: false, phone: true });
  });

  it("compares emails case-insensitively, and never matches a missing one", () => {
    expect(
      matchSignals(
        { customer_email: " Ana@Correo.com ", customer_phone: null },
        { email: "ana@correo.com", phone: null }
      )
    ).toEqual({ email: true, phone: false });
    expect(
      matchSignals({ customer_email: null, customer_phone: null }, { email: "", phone: null })
    ).toEqual({ email: false, phone: false });
  });
});

describe("mapUnlinkedOrderRow", () => {
  it("turns PostgREST NUMERIC strings into numbers and blanks into null", () => {
    const row = mapUnlinkedOrderRow({
      id: ORDER_ID,
      order_number: 1042,
      customer_name: "Ana",
      customer_email: "",
      customer_phone: "8888-1234",
      subtotal: "40000.00",
      discount: "0.00",
      shipping_cost: "2900.00",
      total: "42900.00",
      order_status: "shipped",
      payment_status: "paid",
      payment_provider: null,
      source: "admin",
      created_at: "2026-01-02T03:04:05Z",
      total_count: 7,
    });
    expect(row).toMatchObject({
      subtotal: 40_000,
      shipping_cost: 2_900,
      total: 42_900,
      customer_email: null,
      payment_provider: null,
    });
  });
});

function rpcClient(response: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(response);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("linkOrderToCustomer", () => {
  it("refuses malformed ids without calling the database", async () => {
    const { client, rpc } = rpcClient({ data: null, error: null });
    expect(await linkOrderToCustomer(client, "nope", USER_ID)).toMatchObject({ ok: false });
    expect(await linkOrderToCustomer(client, ORDER_ID, "nope")).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls the link RPC once and maps its result", async () => {
    const { client, rpc } = rpcClient({
      data: {
        order_id: ORDER_ID,
        order_number: 1042,
        order_status: "shipped",
        user_id: USER_ID,
        customer_name: "Ana Solano",
        customer_email: "ana@correo.com",
        xp_status: "granted",
        xp_awarded: 2100,
        xp_balance: 3250,
      },
      error: null,
    });

    const outcome = await linkOrderToCustomer(client, ORDER_ID, USER_ID);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("admin_link_order_to_customer", {
      p_order_id: ORDER_ID,
      p_user_id: USER_ID,
    });
    expect(outcome).toEqual({
      ok: true,
      data: expect.objectContaining({ xp_status: "granted", xp_awarded: 2100, xp_balance: 3250 }),
    });
  });

  it("marks an already-linked order as stale (reload, don't retry)", async () => {
    const { client } = rpcClient({ data: null, error: { message: "link_order_already_linked" } });
    const outcome = await linkOrderToCustomer(client, ORDER_ID, USER_ID);
    expect(outcome).toMatchObject({ ok: false, stale: true });
    expect(!outcome.ok && outcome.message).toMatch(/ya fue ligado/);
  });

  it("does not mark other failures as stale", async () => {
    const { client } = rpcClient({ data: null, error: { message: "link_customer_not_eligible" } });
    expect(await linkOrderToCustomer(client, ORDER_ID, USER_ID)).toMatchObject({
      ok: false,
      stale: false,
    });
  });
});

describe("linkErrorMessage", () => {
  it.each([
    ["Insufficient privilege: admin only.", /permiso/],
    ["link_order_not_found", /ya no existe/],
    ["link_customer_not_found", /cuenta seleccionada/],
    ["link_customer_not_eligible", /administradores/],
    ["link_invalid_request", /no es válida/],
    ["Could not find the function public.admin_link_order_to_customer", /migración 20261110000200/],
    ["something unexpected", /No pudimos/],
  ])("%s", (raw, expected) => {
    expect(linkErrorMessage(raw)).toMatch(expected);
  });
});

describe("describeLinkXp", () => {
  it("states the XP awarded and the new balance", () => {
    expect(describeLinkXp({ xp_status: "granted", xp_awarded: 2100, xp_balance: 3250 })).toBe(
      "Se otorgaron 2,100 XP. Balance actual: 3,250 XP."
    );
  });

  it("never claims XP for a pending or cancelled order", () => {
    expect(describeLinkXp({ xp_status: "pending_status", xp_awarded: 0, xp_balance: 0 })).toMatch(
      /Aún no se otorgan XP/
    );
    expect(describeLinkXp({ xp_status: "not_eligible", xp_awarded: 0, xp_balance: 0 })).toMatch(
      /cancelado/
    );
    expect(describeLinkXp({ xp_status: "already_granted", xp_awarded: 0, xp_balance: 10 })).toMatch(
      /ya se habían otorgado/
    );
  });
});

describe("searchLinkableCustomers", () => {
  function client(profiles: any[], found: any[]) {
    const rpc = vi.fn().mockResolvedValue({ data: found, error: null });
    const inFn = vi.fn().mockResolvedValue({ data: profiles, error: null });
    const select = vi.fn(() => ({ in: inFn }));
    const from = vi.fn(() => ({ select }));
    return { client: { rpc, from } as unknown as SupabaseClient<Database>, rpc, from, inFn };
  }

  const row = (id: string, name: string) => ({
    user_id: id,
    full_name: name,
    email: `${name.toLowerCase()}@correo.com`,
    phone: "88881234",
    address_province: null,
    address_canton: null,
    address_district: null,
    address_exact: null,
    address_reference: null,
  });

  it("keeps customer and wholesale accounts, drops admins, adds member-since and XP", async () => {
    const { client: c, inFn } = client(
      [
        { id: USER_ID, role: "customer", created_at: "2025-01-01T00:00:00Z", experience_points: 1200 },
        { id: ADMIN_ID, role: "admin", created_at: "2024-01-01T00:00:00Z", experience_points: 0 },
      ],
      [row(USER_ID, "Ana"), row(ADMIN_ID, "Staff")]
    );

    const outcome = await searchLinkableCustomers(c, "an");

    expect(inFn).toHaveBeenCalledWith("id", [USER_ID, ADMIN_ID]);
    expect(outcome).toEqual({
      ok: true,
      data: [
        expect.objectContaining({
          user_id: USER_ID,
          role: "customer",
          member_since: "2025-01-01T00:00:00Z",
          experience_points: 1200,
        }),
      ],
    });
  });

  it("does not query profiles when the search found nobody", async () => {
    const { client: c, from } = client([], []);
    expect(await searchLinkableCustomers(c, "zz")).toEqual({ ok: true, data: [] });
    expect(from).not.toHaveBeenCalled();
  });
});
