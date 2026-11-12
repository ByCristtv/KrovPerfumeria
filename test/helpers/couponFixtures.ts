import type { UserCoupon } from "@/lib/coupons/types";

/** A customer's issued coupon, defaulting to "8% off, ₡25.000 minimum, claimed". */
export function userCoupon(
  id: string,
  name: string,
  overrides: Partial<UserCoupon["coupon"]> = {},
  status: UserCoupon["status"] = "claimed",
  expiresAt: string | null = null
): UserCoupon {
  return {
    id,
    status,
    unlockedAt: "2026-09-01T00:00:00Z",
    claimedAt: status === "claimed" ? "2026-09-02T00:00:00Z" : null,
    usedAt: null,
    paymentConfirmedAt: null,
    expiresAt,
    usedOrderId: null,
    coupon: {
      code: name.toUpperCase().replace(/\s+/g, "-"),
      name,
      description: null,
      discountType: "percentage",
      discountValue: 8,
      maxDiscountAmount: null,
      minOrderSubtotal: 25_000,
      levelRequired: 3,
      ...overrides,
    },
  };
}
