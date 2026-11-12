import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, type SupabaseMockConfig } from "@/test/helpers/supabaseMock";

const { createClientMock, revalidatePathMock, fetchLadderMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  fetchLadderMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/features/loyalty/rankLadder", () => ({ fetchRankLadder: fetchLadderMock }));

import {
  createCouponRewardAction,
  deleteCouponRewardAction,
  issueCouponRewardRetroactivelyAction,
  saveLevelThresholdsAction,
  setCouponRewardActiveAction,
  updateCouponRewardAction,
} from "./actions";
import { TEST_LADDER } from "@/test/helpers/rankLadder";
import type { RewardTermsInput } from "@/lib/loyalty/rewardTerms";

const ADMIN = "22222222-2222-4222-8222-222222222222";
const REWARD = "33333333-3333-4333-8333-333333333333";
const STAMP = "2026-11-09T10:00:00.123456+00:00";

function asAdmin(rpc?: SupabaseMockConfig["rpc"]) {
  const mock = makeSupabaseMock({ user: { id: ADMIN }, profileRole: "admin", rpc });
  createClientMock.mockReturnValue(mock.client);
  return mock;
}

const thresholds = (...values: Array<string | number>) =>
  TEST_LADDER.map((tier, i) => ({ level: tier.level, value: values[i] }));

const TERMS: RewardTermsInput = {
  name: "Cupón 15",
  description: "",
  discountType: "percentage",
  discountValue: "15",
  minOrderSubtotal: "20000",
  maxDiscountAmount: "",
  validDays: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchLadderMock.mockResolvedValue(TEST_LADDER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("authorization — every action", () => {
  const calls: Array<[string, () => Promise<{ ok: boolean; message: string }>]> = [
    ["save thresholds", () => saveLevelThresholdsAction({ thresholds: thresholds(0, 800, 5_000, 10_000, 18_000), expectedUpdatedAt: null })],
    ["create", () => createCouponRewardAction({ level: 4, terms: TERMS, isActive: true })],
    ["update", () => updateCouponRewardAction(REWARD, { terms: TERMS, expectedUpdatedAt: null })],
    ["toggle", () => setCouponRewardActiveAction(REWARD, false)],
    ["delete", () => deleteCouponRewardAction(REWARD)],
    ["back-issue", () => issueCouponRewardRetroactivelyAction(REWARD, false)],
  ];

  it.each(calls)("%s: refuses a signed-out caller without calling the RPC", async (_name, call) => {
    const mock = makeSupabaseMock({ user: null });
    createClientMock.mockReturnValue(mock.client);
    const res = await call();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/sesión/i);
    expect(mock.client.rpc).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it.each(calls)("%s: refuses a customer without calling the RPC", async (_name, call) => {
    const mock = makeSupabaseMock({ user: { id: ADMIN }, profileRole: "customer" });
    createClientMock.mockReturnValue(mock.client);
    const res = await call();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/permiso/i);
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("maps the database's own admin gate (loyalty_forbidden) to a permission error", async () => {
    asAdmin(() => ({ data: null, error: { message: "loyalty_forbidden" } }));
    const res = await setCouponRewardActiveAction(REWARD, false);
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/permiso/i) });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("never writes levels or coupons directly — only through the RPCs", async () => {
    const mock = asAdmin(() => ({ data: { changed_levels: 1, customers_reached: 0, coupons_issued: 0 }, error: null }));
    await saveLevelThresholdsAction({ thresholds: thresholds(0, 800, 5_000, 10_000, 18_000), expectedUpdatedAt: null });
    await createCouponRewardAction({ level: 4, terms: TERMS, isActive: true });
    expect(mock.captured.update).toBeUndefined();
    expect(mock.captured.insert).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("saveLevelThresholdsAction", () => {
  it("sends the WHOLE ladder, atomically, with the optimistic-lock token", async () => {
    const mock = asAdmin(() => ({
      data: { changed_levels: 1, customers_reached: 3, coupons_issued: 4, updated_at: STAMP },
      error: null,
    }));

    const res = await saveLevelThresholdsAction({
      thresholds: thresholds("0", "800", "5000", "10000", "18000"),
      expectedUpdatedAt: STAMP,
    });

    expect(mock.captured.rpc).toEqual({
      name: "admin_update_level_thresholds",
      args: {
        p_thresholds: [
          { level_number: 1, required_xp: 0 },
          { level_number: 2, required_xp: 800 },
          { level_number: 3, required_xp: 5_000 },
          { level_number: 4, required_xp: 10_000 },
          { level_number: 5, required_xp: 18_000 },
        ],
        p_expected_updated_at: STAMP,
      },
    });
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ changedLevels: 1, customersReached: 3, couponsIssued: 4 });
    expect(res.message).toMatch(/3 clientes alcanzaron un rango nuevo/);
    // Every rank anywhere on the site reads the ladder from the root layout.
    expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["identical adjacent thresholds", [0, 1_000, 1_000, 10_000, 18_000], /Conocedor/],
    ["a decreasing threshold", [0, 1_000, 5_000, 4_000, 18_000], /Alquimista/],
    ["a negative value", [0, -1, 5_000, 10_000, 18_000], /negativa/],
    ["a non-integer value", [0, "1000.5", 5_000, 10_000, 18_000], /entero/],
    ["a moved entry rank", [10, 1_000, 5_000, 10_000, 18_000], /rango inicial/],
  ])("rejects %s before reaching the database", async (_label, values, message) => {
    const mock = asAdmin();
    const res = await saveLevelThresholdsAction({ thresholds: thresholds(...values), expectedUpdatedAt: null });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(message);
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("refuses a proposal that misses or repeats a rank", async () => {
    const mock = asAdmin();
    const missing = await saveLevelThresholdsAction({
      thresholds: thresholds(0, 1_000, 5_000, 10_000, 18_000).slice(0, 4),
      expectedUpdatedAt: null,
    });
    const repeated = await saveLevelThresholdsAction({
      thresholds: [...thresholds(0, 1_000, 5_000, 10_000, 18_000).slice(0, 4), { level: 2, value: 1_200 }],
      expectedUpdatedAt: null,
    });
    expect(missing.ok).toBe(false);
    expect(repeated.ok).toBe(false);
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("explains a database-side rejection and does not revalidate", async () => {
    asAdmin(() => ({ data: null, error: { message: "levels_not_increasing:4" } }));
    const res = await saveLevelThresholdsAction({ thresholds: thresholds(0, 900, 5_000, 10_000, 18_000), expectedUpdatedAt: null });
    expect(res).toEqual({ ok: false, message: expect.stringMatching(/^Alquimista debe requerir más XP/) });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("reports a concurrent edit instead of overwriting it", async () => {
    asAdmin(() => ({ data: null, error: { message: "levels_stale" } }));
    const res = await saveLevelThresholdsAction({ thresholds: thresholds(0, 900, 5_000, 10_000, 18_000), expectedUpdatedAt: STAMP });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/Otro administrador/);
  });

  it("says the migration is missing when the RPC does not exist yet", async () => {
    asAdmin(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.admin_update_level_thresholds" } as { message: string } }));
    const res = await saveLevelThresholdsAction({ thresholds: thresholds(0, 900, 5_000, 10_000, 18_000), expectedUpdatedAt: null });
    expect(res.message).toMatch(/migraciones/);
  });

  it("does not revalidate a save that changed nothing", async () => {
    asAdmin(() => ({ data: { changed_levels: 0, customers_reached: 0, coupons_issued: 0 }, error: null }));
    const res = await saveLevelThresholdsAction({ thresholds: thresholds(0, 1_000, 5_000, 10_000, 18_000), expectedUpdatedAt: null });
    expect(res.ok).toBe(true);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("coupon reward actions", () => {
  it("creates a reward on the chosen rank with typed terms", async () => {
    const mock = asAdmin(() => ({ data: { id: REWARD, code: "ALQUIMISTA-15" }, error: null }));
    const res = await createCouponRewardAction({
      level: 4,
      terms: { ...TERMS, maxDiscountAmount: "30000", validDays: "30" },
      isActive: false,
    });
    expect(mock.captured.rpc).toEqual({
      name: "admin_create_coupon_reward",
      args: {
        p_level_number: 4,
        p_name: "Cupón 15",
        p_description: null,
        p_discount_type: "percentage",
        p_discount_value: 15,
        p_min_order_subtotal: 20_000,
        p_max_discount_amount: 30_000,
        p_valid_days: 30,
        p_is_active: false,
      },
    });
    expect(res).toMatchObject({ ok: true, data: { id: REWARD, code: "ALQUIMISTA-15" } });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/rewards");
    expect(revalidatePathMock).toHaveBeenCalledWith("/ranking");
  });

  it.each<[string, Partial<RewardTermsInput>]>([
    ["0 %", { discountValue: "0" }],
    ["over 100 %", { discountValue: "120" }],
    ["fractional colones", { discountType: "fixed", discountValue: "99.5" }],
    ["a cap on a fixed amount", { discountType: "fixed", discountValue: "5000", maxDiscountAmount: "100" }],
  ])("rejects %s without calling the RPC", async (_label, overrides) => {
    const mock = asAdmin();
    const res = await createCouponRewardAction({ level: 4, terms: { ...TERMS, ...overrides }, isActive: true });
    expect(res.ok).toBe(false);
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });

  it("edits only the editable terms (never the type or the rank) and sends the lock token", async () => {
    const mock = asAdmin(() => ({ data: {}, error: null }));
    const res = await updateCouponRewardAction(REWARD, {
      terms: { ...TERMS, discountValue: "11" },
      expectedUpdatedAt: STAMP,
    });
    expect(mock.captured.rpc?.name).toBe("admin_update_coupon_reward");
    expect(mock.captured.rpc?.args).toEqual({
      p_coupon_id: REWARD,
      p_name: "Cupón 15",
      p_description: null,
      p_discount_value: 11,
      p_min_order_subtotal: 20_000,
      p_max_discount_amount: null,
      p_valid_days: null,
      p_expected_updated_at: STAMP,
    });
    expect(res.message).toMatch(/ya entregados conservan sus condiciones/);
  });

  it("deactivates without touching issued coupons, and says so", async () => {
    const mock = asAdmin(() => ({ data: {}, error: null }));
    const res = await setCouponRewardActiveAction(REWARD, false);
    expect(mock.captured.rpc).toEqual({
      name: "admin_set_coupon_reward_active",
      args: { p_coupon_id: REWARD, p_is_active: false },
    });
    expect(res.message).toMatch(/siguen siendo válidos/);
  });

  it("explains why an issued reward cannot be deleted", async () => {
    asAdmin(() => ({ data: null, error: { message: "reward_has_issued_coupons" } }));
    const res = await deleteCouponRewardAction(REWARD);
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/Desactívala/) });
  });

  it("back-issue: a dry run only counts, the real run issues and revalidates", async () => {
    const mock = asAdmin((_name, args) => {
      const dry = (args as { p_dry_run: boolean }).p_dry_run;
      return { data: { dry_run: dry, eligible: 7, issued: dry ? 0 : 7 }, error: null };
    });

    const preview = await issueCouponRewardRetroactivelyAction(REWARD, true);
    expect(preview.data).toEqual({ eligible: 7, issued: 0 });
    expect(mock.captured.rpc?.args).toEqual({ p_coupon_id: REWARD, p_dry_run: true });
    expect(revalidatePathMock).not.toHaveBeenCalled();

    const run = await issueCouponRewardRetroactivelyAction(REWARD, false);
    expect(run).toMatchObject({ ok: true, data: { eligible: 7, issued: 7 } });
    expect(run.message).toMatch(/7 clientes/);
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/rewards");
  });

  it.each(["not-a-uuid", "", "33333333-3333-4333-8333"])("rejects reward id %j", async (id) => {
    const mock = asAdmin();
    expect((await deleteCouponRewardAction(id)).ok).toBe(false);
    expect((await setCouponRewardActiveAction(id, true)).ok).toBe(false);
    expect(mock.client.rpc).not.toHaveBeenCalled();
  });
});
