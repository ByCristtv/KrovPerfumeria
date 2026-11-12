import type { Tables } from "@/types/database";
import type {
  CouponStatus,
  CouponTerms,
  DiscountType,
  UserCoupon,
} from "./types";

/**
 * The terms snapshotted onto every issued coupon by migration 20261109000100.
 * Optional here because types/database.ts is generated and does not know the
 * columns until `pnpm update-types` runs after the migration — and because,
 * before the migration, the rows simply do not carry them.
 */
export interface UserCouponSnapshotColumns {
  coupon_code?: string | null;
  coupon_name?: string | null;
  coupon_description?: string | null;
  discount_type?: string | null;
  discount_value?: number | string | null;
  max_discount_amount?: number | string | null;
  min_order_subtotal?: number | string | null;
  level_required?: number | null;
  issue_source?: string | null;
}

/**
 * A `user_coupons` row with its `coupons` row embedded — the exact shape
 * `getUserCoupons` selects.
 */
export type UserCouponRow = Tables<"user_coupons"> &
  UserCouponSnapshotColumns & {
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
 * The terms the customer EARNED. Issued coupons carry an immutable snapshot
 * (what `apply_order_coupon` charges), so an admin editing or retiring the
 * definition later changes nothing here. Rows from before the snapshot
 * migration fall back to the embedded definition — exactly what the database
 * charged for them at the time.
 */
function termsOf(row: UserCouponRow): CouponTerms | null {
  if (row.coupon_code && row.discount_type && row.discount_value != null && row.level_required != null) {
    return {
      code: row.coupon_code,
      name: row.coupon_name ?? row.coupon_code,
      description: row.coupon_description ?? null,
      discountType: toDiscountType(row.discount_type),
      discountValue: Number(row.discount_value),
      maxDiscountAmount:
        row.max_discount_amount === null || row.max_discount_amount === undefined
          ? null
          : Number(row.max_discount_amount),
      minOrderSubtotal: Number(row.min_order_subtotal ?? 0),
      levelRequired: row.level_required,
    };
  }

  const c = row.coupons;
  if (!c) return null;
  return {
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
}

/**
 * Row → view model. Returns null only when neither a snapshot nor the
 * definition is readable (a pre-snapshot row whose definition RLS now hides
 * because it was retired) — those simply don't render.
 */
export function mapUserCoupon(row: UserCouponRow): UserCoupon | null {
  const coupon = termsOf(row);
  if (!coupon) return null;

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
