import { formatPrice } from "@/lib/format";
import { parseCouponError } from "./errors";

/**
 * Coupon failures from `place_admin_order`, worded for the ADMIN.
 *
 * The codes are the shared contract parsed by `parseCouponError` (the same ones
 * the web checkout receives — both paths run `redeem_user_coupon_for_order`),
 * plus two that only the manual-order RPC raises. The customer-facing copy in
 * ./errors.ts speaks to the buyer ("inicia sesión", "tu compra"); an admin
 * taking a WhatsApp order needs to know what to change in the form instead.
 *
 * Returns null when the message is not a coupon error, so the caller can keep
 * matching its other cases.
 */
export function adminCouponErrorMessage(
  raw: string | null | undefined
): string | null {
  const message = raw?.trim() ?? "";

  // Admin-only codes, raised before any stock moves.
  if (message.startsWith("coupon_customer_required")) {
    return "Para aplicar un cupón, selecciona la cuenta registrada del cliente.";
  }
  if (message.startsWith("coupon_manual_discount_conflict")) {
    return "Un cupón no se combina con un descuento manual. Usa solo uno.";
  }

  const parsed = parseCouponError(message);
  if (!parsed) return null;

  switch (parsed.code) {
    case "coupon_min_subtotal":
      return parsed.minSubtotal !== undefined
        ? `El cupón requiere una compra mínima de ${formatPrice(parsed.minSubtotal)} en productos.`
        : "El subtotal no alcanza el mínimo del cupón.";
    case "coupon_expired":
      return "El cupón venció. Actualiza la lista de cupones del cliente.";
    case "coupon_not_available":
      return "El cupón ya no está disponible: el cliente pudo haberlo usado en otro pedido. Actualiza la lista de cupones.";
    case "coupon_not_found":
      return "El cupón no pertenece a este cliente o ya no existe.";
    case "coupon_not_applicable":
      return "Los cupones no aplican a pedidos con precio mayorista.";
    case "coupon_no_discount":
      return "El cupón no genera descuento en este pedido.";
    case "coupon_inactive":
      return "El cupón ya no está activo.";
    case "coupon_login_required":
    case "coupon_order_invalid":
    case "coupon_invalid_request":
      return "No pudimos aplicar el cupón. Quítalo e inténtalo de nuevo.";
  }
}
