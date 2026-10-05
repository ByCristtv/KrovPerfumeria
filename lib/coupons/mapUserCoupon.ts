import type { Tables } from "@/types/database";
import type {
  CouponStatus,
  CouponTerms,
  DiscountType,
  UserCoupon,
} from "./types";

/**
 * A `user_coupons` row with its `coupons` row embedded — the exact shape
 * `getUserCoupons` selects.
 */
export type UserCouponRow = Tables<"user_coupons"> & {
  coupons: Tables<"coupons"> | null;
};

const STATUSES: readonly CouponStatus[] = [
  "unlocked",
  "claimed",
  "used",
  "expired",
];

/**
 * The generated types give `status` and `discount_type` as plain `string` (they
 * are TEXT + CHECK in Postgres). Narrow them here, once, so the rest of the app
 * works with unions. An unrecognised value is treated as unusable rather than
 * guessed at.
 */
function toStatus(value: string): CouponStatus {
  return (STATUSES as readonly string[]).includes(value)
    ? (value as CouponStatus)
    : "expired";
}

function toDiscountType(value: string): DiscountType {
  return value === "fixed" ? "fixed" : "percentage";
}

/**
 * Row → view model. Returns null when the coupon definition is missing (RLS
 * hides inactive coupons from non-admins, so a retired coupon's row arrives with
 * `coupons: null`) — those simply don't render.
 */
export function mapUserCoupon(row: UserCouponRow): UserCoupon | null {
  const c = row.coupons;
  if (!c) return null;

  const coupon: CouponTerms = {
    code: c.code,
    name: c.name,
    description: c.description,
    discountType: toDiscountType(c.discount_type),
    discountValue: Number(c.discount_value),
    maxDiscountAmount:
      c.max_discount_amount === null ? null : Number(c.max_discount_amount),
    minOrderSubtotal: Number(c.min_order_subtotal),
    levelRequired: c.level_required,
  };

  return {
    id: row.id,
    status: toStatus(row.status),
    unlockedAt: row.unlocked_at,
    claimedAt: row.claimed_at,
    usedAt: row.used_at,
    paymentConfirmedAt: row.payment_confirmed_at,
    expiresAt: row.expires_at,
    usedOrderId: row.used_order_id,
    coupon,
  };
}
