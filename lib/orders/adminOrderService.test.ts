import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AdminOrderInput } from "@/types/adminOrder";
import { createAdminOrder, type AdminOrderDeps } from "./adminOrderService";
import type { NotifyResult } from "@/lib/notifications/orderNotifier";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The manual-order use case, exercised without a database and without Resend.
 *
 * The behaviour under test is a policy, not a mechanism: an order is persisted
 * first and the customer confirmation is attempted afterwards, so no outcome of
 * the email — absent address, provider outage, a duplicate submit — can reach
 * back and undo a sale the store has already taken.
 */

const ORDER_ID = "11111111-1111-1111-1111-111111111111";
const VARIANT = "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

const RPC_RESULT = {
  order_id: ORDER_ID,
  order_number: 1042,
  subtotal: 40_000,
  shipping_cost: 2_900,
  discount: 0,
  total: 42_900,
  item_count: 1,
};

/** A Supabase stand-in whose only capability is the one RPC this use case calls. */
function makeSupabase(
  response: { data: unknown; error: unknown } = { data: RPC_RESULT, error: null }
) {
  const rpc = vi.fn().mockResolvedValue(response);
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  };
}

function makeInput(email?: string | null): AdminOrderInput {
  return {
    customer: {
      name: "Ana Solano",
      phone: "8888-8888",
      ...(email === undefined ? {} : { email: email as string }),
    },
    shipping: {
      address: "200m sur de la iglesia, casa azul",
      canton_code: "101",
      canton_name: "San José",
      province_name: "San José",
      district: "Carmen",
    },
    items: [{ variant_id: VARIANT, quantity: 2 }],
    shipping_method: "delivery",
  };
}

/**
 * A notifier fake with the real one's two guarantees: it never throws, and the
 * (order_id, type) claim is single-use — a second call for the same order is a
 * no-op that reports "skipped". That second property is what the retry test
 * relies on, so it is modelled rather than assumed.
 */
function makeNotifier(
  behaviour: (orderId: string) => NotifyResult = () => ({
    status: "sent",
    id: "msg_1",
  })
) {
  const claimed = new Set<string>();
  return vi.fn(async (orderId: string): Promise<NotifyResult> => {
    if (claimed.has(orderId)) {
      return { status: "skipped", reason: "already sent or in progress" };
    }
    const result = behaviour(orderId);
    if (result.status === "sent") claimed.add(orderId);
    return result;
  });
}

function deps(
  supabase: SupabaseClient<Database>,
  notifyCustomer?: AdminOrderDeps["notifyCustomer"]
): AdminOrderDeps {
  return { supabase, notifyCustomer };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createAdminOrder — with a customer email", () => {
  it("creates the order and attempts the confirmation exactly once", async () => {
    const { client, rpc } = makeSupabase();
    const notify = makeNotifier();

    const outcome = await createAdminOrder(
      deps(client, notify),
      makeInput("ana@example.com")
    );

    expect(outcome.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("place_admin_order", expect.anything());
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(ORDER_ID);
    expect(outcome.ok && outcome.notification).toEqual({
      attempted: true,
      status: "sent",
      id: "msg_1",
    });
  });

  it("sends the confirmation only after the order is persisted", async () => {
    const sequence: string[] = [];
    const rpc = vi.fn(async () => {
      sequence.push("rpc");
      return { data: RPC_RESULT, error: null };
    });
    const notify = vi.fn(async (): Promise<NotifyResult> => {
      sequence.push("notify");
      return { status: "sent", id: "msg_1" };
    });

    await createAdminOrder(
      deps({ rpc } as unknown as SupabaseClient<Database>, notify),
      makeInput("ana@example.com")
    );

    expect(sequence).toEqual(["rpc", "notify"]);
  });

  it("normalises the address before it reaches the notification layer", async () => {
    const { client, rpc } = makeSupabase();
    await createAdminOrder(
      deps(client, makeNotifier()),
      makeInput("  Ana@Example.COM ")
    );

    const args = rpc.mock.calls[0][1] as { p_payload: any };
    expect(args.p_payload.customer.email).toBe("ana@example.com");
  });
});

describe("createAdminOrder — without a customer email", () => {
  it.each([
    ["omitted", undefined],
    ["null", null],
    ["empty", ""],
    ["whitespace only", "   "],
  ])(
    "creates the order and never calls the email provider (%s)",
    async (_label, email) => {
      const { client, rpc } = makeSupabase();
      const notify = makeNotifier();

      const outcome = await createAdminOrder(deps(client, notify), makeInput(email));

      expect(outcome.ok).toBe(true);
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(notify).not.toHaveBeenCalled();
      expect(outcome.ok && outcome.notification).toEqual({
        attempted: false,
        reason: "no customer email",
      });
    }
  );

  it("does not treat the missing address as an error", async () => {
    const { client } = makeSupabase();
    const outcome = await createAdminOrder(
      deps(client, makeNotifier()),
      makeInput(null)
    );

    expect(outcome.ok).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("createAdminOrder — when the email provider fails", () => {
  it("keeps the order and reports the failure as non-fatal", async () => {
    const { client } = makeSupabase();
    const notify = makeNotifier(() => ({ status: "failed", reason: "resend 503" }));

    const outcome = await createAdminOrder(
      deps(client, notify),
      makeInput("ana@example.com")
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.data.order_id).toBe(ORDER_ID);
    expect(outcome.ok && outcome.notification).toEqual({
      attempted: true,
      status: "failed",
      reason: "resend 503",
    });
  });

  it("absorbs a notifier that throws outright", async () => {
    const { client } = makeSupabase();
    const notify = vi.fn(async () => {
      throw new Error("RESEND_API_KEY env var is missing");
    });

    const outcome = await createAdminOrder(
      deps(client, notify),
      makeInput("ana@example.com")
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.notification).toEqual({
      attempted: true,
      status: "failed",
      reason: "RESEND_API_KEY env var is missing",
    });
  });

  it("logs the failure with the order id and no customer data", async () => {
    const { client } = makeSupabase();
    const notify = makeNotifier(() => ({ status: "failed", reason: "resend 503" }));

    await createAdminOrder(deps(client, notify), makeInput("ana@example.com"));

    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(consoleError.mock.calls[0]);
    expect(logged).toContain(ORDER_ID);
    expect(logged).not.toContain("ana@example.com");
    expect(logged).not.toContain("8888-8888");
  });
});

describe("createAdminOrder — idempotency", () => {
  it("does not re-send the confirmation when the same order is retried", async () => {
    const { client } = makeSupabase();
    const notify = makeNotifier();
    const input = makeInput("ana@example.com");

    const first = await createAdminOrder(deps(client, notify), input);
    const second = await createAdminOrder(deps(client, notify), input);

    expect(first.ok && first.notification).toMatchObject({ status: "sent" });
    // The claim ledger, not this use case, is what makes the retry safe — the
    // notifier is invoked again and declines.
    expect(second.ok && second.notification).toMatchObject({
      attempted: true,
      status: "skipped",
    });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe("createAdminOrder — validation and RPC failures", () => {
  it("rejects a district that does not belong to the cantón, without touching the DB", async () => {
    const { client, rpc } = makeSupabase();
    const notify = makeNotifier();
    const input = makeInput("ana@example.com");
    input.shipping.district = "Cariari"; // real district, wrong cantón

    const outcome = await createAdminOrder(deps(client, notify), input);

    expect(outcome).toMatchObject({ ok: false, kind: "validation" });
    expect(rpc).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects arbitrary free text supplied as a district", async () => {
    const { client, rpc } = makeSupabase();
    const input = makeInput();
    input.shipping.district = "por la casa del vecino";

    const outcome = await createAdminOrder(deps(client, makeNotifier()), input);

    expect(outcome).toMatchObject({ ok: false, kind: "validation" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC failure and sends nothing", async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: "Insufficient stock", code: "P0001" },
    });
    const notify = makeNotifier();

    const outcome = await createAdminOrder(
      deps(client, notify),
      makeInput("ana@example.com")
    );

    expect(outcome).toMatchObject({ ok: false, kind: "rpc" });
    expect(notify).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Free Cariari delivery — decided on the server, from the validated address
// ─────────────────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const USER_COUPON_ID = "5b6c7d8e-9f01-4a2b-8c3d-4e5f6a7b8c9d";

function cariariInput(overrides: Partial<AdminOrderInput["shipping"]> = {}): AdminOrderInput {
  const input = makeInput();
  input.shipping = {
    address: "Frente al parque, casa verde",
    canton_code: "702",
    canton_name: "Pococí",
    province_name: "Limón",
    district: "Cariari",
    ...overrides,
  };
  return input;
}

describe("createAdminOrder — free local delivery (Limón › Pococí › Cariari)", () => {
  it("tells the RPC to waive shipping for a Cariari delivery", async () => {
    const { client, rpc } = makeSupabase({
      data: { ...RPC_RESULT, shipping_cost: 0, local_delivery: true },
      error: null,
    });

    const outcome = await createAdminOrder(deps(client, makeNotifier()), cariariInput());

    const args = rpc.mock.calls[0][1] as { p_payload: any };
    expect(args.p_payload.shipping.free_local_delivery).toBe(true);
    expect(outcome.ok && outcome.drift).toEqual({
      couponIgnored: false,
      localDeliveryIgnored: false,
    });
  });

  it("does not waive shipping for another district of Pococí", async () => {
    const { client, rpc } = makeSupabase();
    await createAdminOrder(deps(client, makeNotifier()), cariariInput({ district: "Guápiles" }));

    const args = rpc.mock.calls[0][1] as { p_payload: any };
    expect(args.p_payload.shipping.free_local_delivery).toBe(false);
  });

  it("does not waive shipping on a pickup order (already free)", async () => {
    const { client, rpc } = makeSupabase();
    const input = cariariInput();
    input.shipping_method = "pickup";
    await createAdminOrder(deps(client, makeNotifier()), input);

    const args = rpc.mock.calls[0][1] as { p_payload: any };
    expect(args.p_payload.shipping.free_local_delivery).toBe(false);
  });

  it("ignores a free-shipping flag forged by the browser", async () => {
    const { client, rpc } = makeSupabase();
    const input = makeInput(); // San José, Carmen
    (input.shipping as any).free_local_delivery = true;

    await createAdminOrder(deps(client, makeNotifier()), input);

    const args = rpc.mock.calls[0][1] as { p_payload: any };
    expect(args.p_payload.shipping.free_local_delivery).toBe(false);
  });

  it("flags drift when an outdated database still charged shipping", async () => {
    const { client } = makeSupabase({ data: { ...RPC_RESULT, shipping_cost: 2_900 }, error: null });

    const outcome = await createAdminOrder(deps(client, makeNotifier()), cariariInput());

    expect(outcome.ok && outcome.drift.localDeliveryIgnored).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coupons — forwarded as an intent; spent by the RPC in the same transaction
// ─────────────────────────────────────────────────────────────────────────────

function couponInput(): AdminOrderInput {
  const input = makeInput();
  input.customer.user_id = CUSTOMER_ID;
  input.user_coupon_id = USER_COUPON_ID;
  return input;
}

describe("createAdminOrder — level coupons", () => {
  it("forwards the coupon id and no manual discount", async () => {
    const { client, rpc } = makeSupabase({
      data: { ...RPC_RESULT, user_coupon_id: USER_COUPON_ID, discount: 3_200 },
      error: null,
    });

    const outcome = await createAdminOrder(deps(client, makeNotifier()), couponInput());

    const args = rpc.mock.calls[0][1] as { p_payload: any };
    expect(args.p_payload.user_coupon_id).toBe(USER_COUPON_ID);
    expect(args.p_payload.discount).toBeUndefined();
    expect(outcome.ok && outcome.drift.couponIgnored).toBe(false);
  });

  it("refuses a coupon without a linked account, before touching the DB", async () => {
    const { client, rpc } = makeSupabase();
    const input = couponInput();
    delete input.customer.user_id;

    const outcome = await createAdminOrder(deps(client, makeNotifier()), input);

    expect(outcome).toMatchObject({ ok: false, kind: "validation" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a coupon combined with a manual discount, before touching the DB", async () => {
    const { client, rpc } = makeSupabase();
    const input = couponInput();
    input.discount = 1_000;

    const outcome = await createAdminOrder(deps(client, makeNotifier()), input);

    expect(outcome).toMatchObject({ ok: false, kind: "validation" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a coupon rejection from the RPC as an RPC failure (no order)", async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: "coupon_not_available", code: "P0001" },
    });
    const notify = makeNotifier();

    const outcome = await createAdminOrder(deps(client, notify), couponInput());

    expect(outcome).toMatchObject({ ok: false, kind: "rpc" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("flags drift when an outdated database ignored the coupon", async () => {
    const { client } = makeSupabase(); // RPC_RESULT has no user_coupon_id

    const outcome = await createAdminOrder(deps(client, makeNotifier()), couponInput());

    expect(outcome.ok && outcome.drift.couponIgnored).toBe(true);
  });
});
