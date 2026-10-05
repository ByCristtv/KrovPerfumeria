import { formatPrice } from "@/lib/format";
import type {
  CouponEvaluation,
  CouponGroup,
  CouponStatus,
  CouponTerms,
  UserCoupon,
} from "./types";

/**
 * Pure coupon maths + presentation helpers.
 *
 * ⚠ DISPLAY ONLY. `calculateCouponDiscount` mirrors `apply_order_coupon()` in
 * SQL so the checkout can PREVIEW what the database will charge, but the
 * database recomputes from the order's own stored subtotal and is the only
 * thing that decides the amount. If the two ever disagree, the order total —
 * not this number — is what the customer pays. Keep them in lock-step.
 */

/**
 * The discount a coupon takes off a goods subtotal, in whole colones.
 *
 * Shipping is never discounted (callers pass the SUBTOTAL), a percentage is
 * rounded to the colón and optionally capped, and no discount can exceed the
 * subtotal it applies to — an order can't go negative.
 */
export function calculateCouponDiscount(
  terms: Pick<
    CouponTerms,
    "discountType" | "discountValue" | "maxDiscountAmount"
  >,
  subtotal: number
): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;

  let discount =
    terms.discountType === "percentage"
      ? Math.round((subtotal * terms.discountValue) / 100)
      : terms.discountValue;

  if (terms.discountType === "percentage" && terms.maxDiscountAmount !== null) {
    discount = Math.min(discount, terms.maxDiscountAmount);
  }

  return Math.max(0, Math.min(discount, subtotal));
}

/**
 * Stored status with expiry applied.
 *
 * The database only flips `status` to 'expired' on an hourly sweep, so a coupon
 * can sit as 'unlocked' for up to an hour after its deadline. Deriving it here
 * means the UI is never that stale (and `apply_order_coupon` independently
 * refuses an expired coupon, so this is purely about honest display).
 */
export function effectiveStatus(
  coupon: Pick<UserCoupon, "status" | "expiresAt">,
  now: Date = new Date()
): CouponStatus {
  if (coupon.status === "used") return "used";
  if (coupon.status === "expired") return "expired";
  if (coupon.expiresAt && new Date(coupon.expiresAt) <= now) return "expired";
  return coupon.status;
}

/** Can this coupon still be spent (ignoring any particular cart)? */
export function isSpendable(
  coupon: Pick<UserCoupon, "status" | "expiresAt">,
  now: Date = new Date()
): boolean {
  const status = effectiveStatus(coupon, now);
  return status === "unlocked" || status === "claimed";
}

/** Can this coupon be applied to a cart with this goods subtotal — and for how much? */
export function evaluateCoupon(
  coupon: UserCoupon,
  subtotal: number,
  now: Date = new Date()
): CouponEvaluation {
  const status = effectiveStatus(coupon, now);
  if (status === "used") return { ok: false, reason: "used" };
  if (status === "expired") return { ok: false, reason: "expired" };

  if (subtotal < coupon.coupon.minOrderSubtotal) {
    return {
      ok: false,
      reason: "min_subtotal",
      shortfall: coupon.coupon.minOrderSubtotal - subtotal,
    };
  }

  const discount = calculateCouponDiscount(coupon.coupon, subtotal);
  return discount > 0
    ? { ok: true, discount }
    : { ok: false, reason: "no_discount" };
}

/** "18% de descuento" / "₡5.000 de descuento". */
export function describeBenefit(
  terms: Pick<CouponTerms, "discountType" | "discountValue">
): string {
  return terms.discountType === "percentage"
    ? `${terms.discountValue}% de descuento`
    : `${formatPrice(terms.discountValue)} de descuento`;
}

/** The conditions, as short phrases ready to join: "Compra mínima ₡20.000". */
export function describeConditions(
  terms: Pick<CouponTerms, "minOrderSubtotal" | "maxDiscountAmount">
): string[] {
  const conditions: string[] = [];
  if (terms.minOrderSubtotal > 0) {
    conditions.push(`Compra mínima ${formatPrice(terms.minOrderSubtotal)}`);
  }
  if (terms.maxDiscountAmount !== null) {
    conditions.push(`Descuento máximo ${formatPrice(terms.maxDiscountAmount)}`);
  }
  conditions.push("Un solo uso");
  return conditions;
}

/** Spanish sentence for a rejection — shown in the selector and in the toast. */
export function describeRejection(
  evaluation: Extract<CouponEvaluation, { ok: false }>,
  terms: Pick<CouponTerms, "minOrderSubtotal">
): string {
  switch (evaluation.reason) {
    case "min_subtotal":
      return `Requiere una compra mínima de ${formatPrice(
        terms.minOrderSubtotal
      )}. Te faltan ${formatPrice(evaluation.shortfall)}.`;
    case "used":
      return "Este cupón ya fue utilizado.";
    case "expired":
      return "Este cupón venció.";
    case "no_discount":
      return "Este cupón no aplica a tu compra.";
  }
}

/**
 * Bucket coupons for /profile/coupons.
 *
 * `used` includes a coupon on hold for an unpaid order: from the customer's side
 * it is spent until that order fails, at which point the database hands it back
 * and it reappears under "available".
 */
export function groupCoupons(
  coupons: UserCoupon[],
  now: Date = new Date()
): Record<CouponGroup, UserCoupon[]> {
  const groups: Record<CouponGroup, UserCoupon[]> = {
    available: [],
    used: [],
    expired: [],
  };

  for (const coupon of coupons) {
    const status = effectiveStatus(coupon, now);
    if (status === "used") groups.used.push(coupon);
    else if (status === "expired") groups.expired.push(coupon);
    else groups.available.push(coupon);
  }

  // Biggest benefit first among the usable ones; most recently spent first.
  groups.available.sort(
    (a, b) => b.coupon.levelRequired - a.coupon.levelRequired
  );
  groups.used.sort(
    (a, b) => timestamp(b.usedAt) - timestamp(a.usedAt)
  );
  groups.expired.sort(
    (a, b) => timestamp(b.expiresAt) - timestamp(a.expiresAt)
  );

  return groups;
}

function timestamp(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}
