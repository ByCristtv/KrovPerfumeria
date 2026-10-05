import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format";
import {
  calculateCouponDiscount,
  describeBenefit,
  describeConditions,
  describeRejection,
  effectiveStatus,
  evaluateCoupon,
  groupCoupons,
  isSpendable,
} from "./discount";
import type { CouponStatus, CouponTerms, UserCoupon } from "./types";

const NOW = new Date("2026-10-05T12:00:00Z");
const PAST = "2026-10-01T00:00:00Z";
const FUTURE = "2026-11-01T00:00:00Z";

const terms = (overrides: Partial<CouponTerms> = {}): CouponTerms => ({
  code: "MAESTRO-18",
  name: "Cupón Maestro",
  description: null,
  discountType: "percentage",
  discountValue: 18,
  maxDiscountAmount: null,
  minOrderSubtotal: 25_000,
  levelRequired: 5,
  ...overrides,
});

const userCoupon = (
  status: CouponStatus,
  overrides: Partial<UserCoupon> = {},
  couponTerms: Partial<CouponTerms> = {}
): UserCoupon => ({
  id: `uc-${status}`,
  status,
  unlockedAt: "2026-09-01T00:00:00Z",
  claimedAt: null,
  usedAt: null,
  paymentConfirmedAt: null,
  expiresAt: null,
  usedOrderId: null,
  coupon: terms(couponTerms),
  ...overrides,
});

describe("calculateCouponDiscount", () => {
  it.each([
    [5, 100_000, 5_000],
    [8, 100_000, 8_000],
    [12, 100_000, 12_000],
    [18, 100_000, 18_000],
  ])("takes %i%% off a ₡%i subtotal", (percent, subtotal, expected) => {
    expect(
      calculateCouponDiscount(terms({ discountValue: percent }), subtotal)
    ).toBe(expected);
  });

  it("rounds a percentage to the nearest colón", () => {
    // 12% of 33,333 = 3,999.96
    expect(
      calculateCouponDiscount(terms({ discountValue: 12 }), 33_333)
    ).toBe(4_000);
  });

  it("caps a percentage discount at max_discount_amount", () => {
    expect(
      calculateCouponDiscount(
        terms({ discountValue: 18, maxDiscountAmount: 10_000 }),
        200_000
      )
    ).toBe(10_000);
  });

  it("does not apply the cap when the discount is already below it", () => {
    expect(
      calculateCouponDiscount(
        terms({ discountValue: 18, maxDiscountAmount: 50_000 }),
        100_000
      )
    ).toBe(18_000);
  });

  it("takes a fixed amount off, as is", () => {
    expect(
      calculateCouponDiscount(
        terms({ discountType: "fixed", discountValue: 5_000 }),
        40_000
      )
    ).toBe(5_000);
  });

  it("never discounts more than the subtotal", () => {
    expect(
      calculateCouponDiscount(
        terms({ discountType: "fixed", discountValue: 50_000 }),
        30_000
      )
    ).toBe(30_000);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "gives no discount for an unusable subtotal (%s)",
    (subtotal) => {
      expect(calculateCouponDiscount(terms(), subtotal)).toBe(0);
    }
  );
});

describe("effectiveStatus", () => {
  it("reports an unexpired unlocked/claimed coupon as stored", () => {
    expect(effectiveStatus(userCoupon("unlocked", { expiresAt: FUTURE }), NOW)).toBe("unlocked");
    expect(effectiveStatus(userCoupon("claimed"), NOW)).toBe("claimed");
  });

  it("treats a coupon past its deadline as expired even before the sweep flips it", () => {
    expect(effectiveStatus(userCoupon("claimed", { expiresAt: PAST }), NOW)).toBe("expired");
  });

  it("never resurrects a used coupon, whatever its expiry says", () => {
    expect(effectiveStatus(userCoupon("used", { expiresAt: PAST }), NOW)).toBe("used");
  });

  it("keeps an expired coupon expired", () => {
    expect(effectiveStatus(userCoupon("expired"), NOW)).toBe("expired");
  });
});

describe("isSpendable", () => {
  it.each([
    ["unlocked", true],
    ["claimed", true],
    ["used", false],
    ["expired", false],
  ] as const)("%s → %s", (status, expected) => {
    expect(isSpendable(userCoupon(status), NOW)).toBe(expected);
  });
});

describe("evaluateCoupon", () => {
  it("approves a cart at or above the minimum and prices it", () => {
    expect(evaluateCoupon(userCoupon("claimed"), 100_000, NOW)).toEqual({
      ok: true,
      discount: 18_000,
    });
  });

  it("treats the minimum as inclusive", () => {
    expect(evaluateCoupon(userCoupon("claimed"), 25_000, NOW)).toEqual({
      ok: true,
      discount: 4_500,
    });
  });

  it("rejects a cart one colón under the minimum and says by how much", () => {
    expect(evaluateCoupon(userCoupon("claimed"), 24_999, NOW)).toEqual({
      ok: false,
      reason: "min_subtotal",
      shortfall: 1,
    });
  });

  it("accepts an unlocked (not yet claimed) coupon — checkout claims it implicitly", () => {
    expect(evaluateCoupon(userCoupon("unlocked"), 50_000, NOW).ok).toBe(true);
  });

  it("rejects used and expired coupons", () => {
    expect(evaluateCoupon(userCoupon("used"), 50_000, NOW)).toEqual({
      ok: false,
      reason: "used",
    });
    expect(
      evaluateCoupon(userCoupon("claimed", { expiresAt: PAST }), 50_000, NOW)
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a coupon that would take nothing off", () => {
    expect(
      evaluateCoupon(
        userCoupon("claimed", {}, { minOrderSubtotal: 0, discountValue: 5 }),
        0,
        NOW
      )
    ).toEqual({ ok: false, reason: "no_discount" });
  });
});

describe("copy", () => {
  it("describes a percentage benefit", () => {
    expect(describeBenefit(terms())).toBe("18% de descuento");
  });

  it("describes a fixed benefit in colones", () => {
    expect(
      describeBenefit(terms({ discountType: "fixed", discountValue: 5_000 }))
    ).toBe(`${formatPrice(5_000)} de descuento`);
  });

  it("lists the minimum spend and the single-use rule", () => {
    expect(describeConditions(terms())).toEqual([
      `Compra mínima ${formatPrice(25_000)}`,
      "Un solo uso",
    ]);
  });

  it("omits the minimum when there is none, and adds a cap when there is one", () => {
    expect(
      describeConditions(terms({ minOrderSubtotal: 0, maxDiscountAmount: 10_000 }))
    ).toEqual([`Descuento máximo ${formatPrice(10_000)}`, "Un solo uso"]);
  });

  it("explains a below-minimum rejection with the shortfall", () => {
    const text = describeRejection(
      { ok: false, reason: "min_subtotal", shortfall: 5_000 },
      { minOrderSubtotal: 25_000 }
    );
    expect(text).toContain(formatPrice(25_000));
    expect(text).toContain(formatPrice(5_000));
  });
});

describe("groupCoupons", () => {
  it("splits coupons into available / used / expired, deriving expiry from the date", () => {
    const groups = groupCoupons(
      [
        userCoupon("unlocked", { id: "a" }),
        userCoupon("claimed", { id: "b" }),
        userCoupon("used", { id: "c" }),
        userCoupon("expired", { id: "d" }),
        userCoupon("claimed", { id: "e", expiresAt: PAST }),
      ],
      NOW
    );

    expect(groups.available.map((c) => c.id).sort()).toEqual(["a", "b"]);
    expect(groups.used.map((c) => c.id)).toEqual(["c"]);
    expect(groups.expired.map((c) => c.id).sort()).toEqual(["d", "e"]);
  });

  it("lists the highest-level coupon first among the usable ones", () => {
    const groups = groupCoupons(
      [
        userCoupon("claimed", { id: "low" }, { levelRequired: 2 }),
        userCoupon("unlocked", { id: "high" }, { levelRequired: 5 }),
      ],
      NOW
    );
    expect(groups.available.map((c) => c.id)).toEqual(["high", "low"]);
  });

  it("returns three empty groups for no coupons", () => {
    expect(groupCoupons([], NOW)).toEqual({
      available: [],
      used: [],
      expired: [],
    });
  });
});
