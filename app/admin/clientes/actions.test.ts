import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, type SupabaseMockConfig } from "@/test/helpers/supabaseMock";

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { adjustCustomerXpAction } from "./actions";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

function adminMock(rpc?: SupabaseMockConfig["rpc"]) {
  return makeSupabaseMock({ user: { id: ADMIN }, profileRole: "admin", rpc });
}

describe("adjustCustomerXpAction", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── authorization ─────────────────────────────────────────────────────────
  describe("authorization", () => {
    it("refuses an anonymous caller without touching the RPC", async () => {
      const mock = makeSupabaseMock({ user: null });
      createClientMock.mockReturnValue(mock.client);

      const res = await adjustCustomerXpAction(CUSTOMER, { direction: "add", amount: "10" });

      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/sesión/i);
      expect(mock.client.rpc).not.toHaveBeenCalled();
    });

    it.each(["customer", "wholesale", null])(
      "refuses a %s caller without touching the RPC",
      async (role) => {
        const mock = makeSupabaseMock({ user: { id: CUSTOMER }, profileRole: role });
        createClientMock.mockReturnValue(mock.client);

        const res = await adjustCustomerXpAction(CUSTOMER, { direction: "add", amount: "10" });

        expect(res.ok).toBe(false);
        expect(res.message).toMatch(/permiso/i);
        expect(mock.client.rpc).not.toHaveBeenCalled();
      }
    );

    it("maps the RPC's own admin check to a permission error", async () => {
      // Role looked like admin to the action, but the DB disagrees (is_admin()).
      const mock = adminMock(() => ({
        data: null,
        error: { message: "Insufficient privilege: admin only." },
      }));
      createClientMock.mockReturnValue(mock.client);

      const res = await adjustCustomerXpAction(CUSTOMER, { direction: "add", amount: "10" });

      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/permiso/i);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("never writes to profiles directly — only through the RPC", async () => {
      const mock = adminMock(() => ({
        data: { delta: 10, balance_before: 0, balance_after: 10 },
        error: null,
      }));
      createClientMock.mockReturnValue(mock.client);

      await adjustCustomerXpAction(CUSTOMER, { direction: "add", amount: "10" });

      expect(mock.captured.update).toBeUndefined();
      expect(mock.captured.insert).toBeUndefined();
    });
  });

  // ── input validation ──────────────────────────────────────────────────────
  describe("validation", () => {
    it.each([
      ["a bad customer id", "nope", { direction: "add", amount: "10" }],
      ["a zero amount", CUSTOMER, { direction: "add", amount: "0" }],
      ["a negative amount", CUSTOMER, { direction: "add", amount: "-5" }],
      ["a fractional amount", CUSTOMER, { direction: "deduct", amount: "2.5" }],
      ["an amount over the cap", CUSTOMER, { direction: "add", amount: "100001" }],
      ["an unknown direction", CUSTOMER, { direction: "steal", amount: "5" }],
      ["a missing payload", CUSTOMER, null],
    ])("rejects %s before calling Supabase", async (_label, id, input) => {
      const mock = adminMock();
      createClientMock.mockReturnValue(mock.client);

      const res = await adjustCustomerXpAction(id as string, input as never);

      expect(res.ok).toBe(false);
      expect(createClientMock).not.toHaveBeenCalled();
      expect(mock.client.rpc).not.toHaveBeenCalled();
    });
  });

  // ── RPC call + results ────────────────────────────────────────────────────
  it("adds XP through admin_adjust_customer_xp with a signed delta", async () => {
    const mock = adminMock(() => ({
      data: { adjustment_id: "a-1", delta: 1200, balance_before: 0, balance_after: 1200 },
      error: null,
    }));
    createClientMock.mockReturnValue(mock.client);

    const res = await adjustCustomerXpAction(CUSTOMER, {
      direction: "add",
      amount: "1200",
      reason: "  compensación ",
    });

    expect(mock.captured.rpc).toEqual({
      name: "admin_adjust_customer_xp",
      args: { p_user_id: CUSTOMER, p_delta: 1200, p_reason: "compensación" },
    });
    expect(res).toMatchObject({
      ok: true,
      data: { delta: 1200, balance_before: 0, balance_after: 1200, rank: "Coleccionista" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith(`/admin/clientes/${CUSTOMER}`);
  });

  it("deducts XP with a negative delta and omits a blank reason", async () => {
    const mock = adminMock(() => ({
      data: { delta: -300, balance_before: 1000, balance_after: 700 },
      error: null,
    }));
    createClientMock.mockReturnValue(mock.client);

    const res = await adjustCustomerXpAction(CUSTOMER, {
      direction: "deduct",
      amount: "300",
      reason: "   ",
    });

    expect(mock.captured.rpc?.args).toEqual({
      p_user_id: CUSTOMER,
      p_delta: -300,
      p_reason: undefined,
    });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/restaron 300/i);
    expect(res.data?.rank).toBe("Aficionado");
  });

  it.each([
    ["XP balance cannot go negative (current: 50).", /negativo/i],
    ["Customer not found.", /no existe/i],
    ["Admins cannot adjust their own XP.", /propio/i],
    [
      "Could not find the function public.admin_adjust_customer_xp(p_delta, p_reason, p_user_id) in the schema cache",
      /migración/i,
    ],
  ])("maps the RPC error %j to a friendly message", async (dbMessage, expected) => {
    const mock = adminMock(() => ({ data: null, error: { message: dbMessage } }));
    createClientMock.mockReturnValue(mock.client);

    const res = await adjustCustomerXpAction(CUSTOMER, { direction: "deduct", amount: "100" });

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(expected);
  });
});
