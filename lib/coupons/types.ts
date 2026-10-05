/**
 * Level-coupon domain vocabulary.
 *
 * The database is the authority (see supabase/migrations/20261005000100_level_coupons.sql);
 * these types are the shape the UI works with after `mapUserCoupon` has narrowed
 * the loosely-typed rows.
 */

/** Stored lifecycle state of a customer's coupon. */
export type CouponStatus = "unlocked" | "claimed" | "used" | "expired";

export type DiscountType = "percentage" | "fixed";

/** The terms of a coupon — everything needed to price it and describe it. */
export interface CouponTerms {
  code: string;
  name: string;
  description: string | null;
  discountType: DiscountType;
  /** Percent (0–100) or a CRC amount, depending on `discountType`. */
  discountValue: number;
  /** Cap on a percentage discount, in CRC. */
  maxDiscountAmount: number | null;
  /** Inclusive floor on the order SUBTOTAL (goods only), in CRC. */
  minOrderSubtotal: number;
  /** 1-based level that unlocks it. */
  levelRequired: number;
}

/** One customer's copy of a coupon. */
export interface UserCoupon {
  id: string;
  /** What the database stored. May lag `expiresAt` until the hourly sweep. */
  status: CouponStatus;
  unlockedAt: string;
  claimedAt: string | null;
  usedAt: string | null;
  /** Set once the order's payment is confirmed; null while only on hold. */
  paymentConfirmedAt: string | null;
  expiresAt: string | null;
  usedOrderId: string | null;
  coupon: CouponTerms;
}

/**
 * Why a coupon cannot be applied to a given cart right now.
 *
 *   used / expired  — no longer spendable
 *   min_subtotal    — spendable, but the cart is below its floor (`shortfall` says by how much)
 */
export type CouponRejection =
  | { reason: "used" }
  | { reason: "expired" }
  | { reason: "min_subtotal"; shortfall: number }
  | { reason: "no_discount" };

export type CouponEvaluation =
  | { ok: true; discount: number }
  | ({ ok: false } & CouponRejection);

/** Which section of /profile/coupons a coupon belongs in. */
export type CouponGroup = "available" | "used" | "expired";
