import { formatPrice } from "@/lib/format";

/**
 * The coupon error contract between Postgres and the app.
 *
 * `apply_order_coupon` / `claim_user_coupon` signal failure with
 * `RAISE EXCEPTION '<code>'` (the min-subtotal code carries its amount after a
 * colon). This module is the ONLY place those strings are interpreted, so a new
 * code is a one-line change here and an unknown one degrades to a generic
 * message instead of leaking raw SQL text to a customer.
 */

export type CouponErrorCode =
  | "coupon_login_required"
  | "coupon_invalid_request"
  | "coupon_order_invalid"
  | "coupon_not_applicable"
  | "coupon_not_found"
  | "coupon_inactive"
  | "coupon_expired"
  | "coupon_not_available"
  | "coupon_no_discount"
  | "coupon_min_subtotal";

export interface ParsedCouponError {
  code: CouponErrorCode;
  /** Present for `coupon_min_subtotal`: the floor, in CRC. */
  minSubtotal?: number;
}

const KNOWN: ReadonlySet<string> = new Set<CouponErrorCode>([
  "coupon_login_required",
  "coupon_invalid_request",
  "coupon_order_invalid",
  "coupon_not_applicable",
  "coupon_not_found",
  "coupon_inactive",
  "coupon_expired",
  "coupon_not_available",
  "coupon_no_discount",
  "coupon_min_subtotal",
]);

/** Recognise a coupon error in a Postgres/PostgREST message, or return null. */
export function parseCouponError(
  message: string | null | undefined
): ParsedCouponError | null {
  if (!message) return null;

  const [code, amount] = message.trim().split(":");
  if (!KNOWN.has(code)) return null;

  const parsed: ParsedCouponError = { code: code as CouponErrorCode };
  if (code === "coupon_min_subtotal" && amount !== undefined) {
    const min = Number(amount);
    if (Number.isFinite(min)) parsed.minSubtotal = min;
  }
  return parsed;
}

/** Customer-facing Spanish message for a coupon error. */
export function couponErrorMessage(error: ParsedCouponError): string {
  switch (error.code) {
    case "coupon_login_required":
      return "Inicia sesión para usar tus cupones.";
    case "coupon_min_subtotal":
      return error.minSubtotal !== undefined
        ? `Este cupón requiere una compra mínima de ${formatPrice(
            error.minSubtotal
          )}.`
        : "Tu compra no alcanza el mínimo de este cupón.";
    case "coupon_expired":
      return "Este cupón venció.";
    case "coupon_not_available":
      return "Este cupón ya no está disponible (puede que ya lo hayas usado en otro pedido).";
    case "coupon_not_applicable":
      return "Los cupones no se combinan con precios mayoristas.";
    case "coupon_inactive":
      return "Este cupón ya no está activo.";
    case "coupon_no_discount":
      return "Este cupón no genera descuento en tu compra.";
    case "coupon_not_found":
    case "coupon_order_invalid":
    case "coupon_invalid_request":
      return "No pudimos aplicar el cupón. Quítalo e inténtalo de nuevo.";
  }
}

/** HTTP status for a coupon failure surfaced through the checkout route. */
export function couponErrorStatus(error: ParsedCouponError): number {
  switch (error.code) {
    case "coupon_login_required":
      return 401;
    case "coupon_not_found":
      return 404;
    case "coupon_order_invalid":
    case "coupon_invalid_request":
      return 400;
    default:
      // Recoverable by choosing differently — the customer's coupon, not our bug.
      return 409;
  }
}
