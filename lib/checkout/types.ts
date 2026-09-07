/**
 * Checkout domain vocabulary.
 *
 * Two distinct concepts that are easy to conflate:
 *   - PaymentMethodId — what the customer picks in the UI ("card", "sinpe").
 *   - PaymentProvider — what gets stamped on orders.payment_provider and drives
 *     server-side behavior (sweep_abandoned_orders filters on 'onvo'; the retry
 *     route rejects anything else).
 *
 * They map 1:1 today, but they are not the same axis: a future PayPal method and
 * an Apple Pay method could both route through one provider, and 'manual_sinpe'
 * could gain a second UI entry point. Keeping them separate means the registry
 * stays the only place the mapping lives.
 */

/** What the customer selects in the checkout form. */
export type PaymentMethodId = "card" | "sinpe";

/**
 * Value written to orders.payment_provider. The column is free-text with no CHECK
 * constraint, so this union is the only thing keeping it honest — widen it here,
 * never inline a bare string at a call site.
 *
 * ⚠ 'onvo' is load-bearing beyond this module:
 *   - sweep_abandoned_orders() cancels ONLY payment_provider='onvo' orders after
 *     30 min. 'manual_sinpe' is therefore exempt by design — SINPE orders wait
 *     for manual admin validation instead of auto-cancelling.
 *   - app/api/checkout/retry/[orderId] rejects any provider !== 'onvo'.
 */
export type PaymentProvider = "onvo" | "manual_sinpe";

/** A single line as requested by the client (already zod-validated). */
export interface CheckoutLineItem {
  variant_id: string;
  quantity: number;
}

/** Contact block collected by the form. */
export interface CheckoutCustomer {
  name: string;
  email: string;
  phone: string;
}

/** Shipping block collected by the form, plus the CR-geo derived display names. */
export interface CheckoutShipping {
  address: string;
  canton_code: string;
  canton_name: string;
  province_name: string;
  district?: string;
  reference?: string;
  /**
   * The customer's "Cariari centro" opt-in. Carried as a request only —
   * lib/shipping/localDelivery.ts decides whether it actually applies.
   */
  local_delivery?: boolean;
}

/**
 * Reference to the checkout's live pending order, round-tripped by the client.
 * `order_token` is an HMAC of `order_id` (lib/orders/tokens.ts) and is what
 * proves the client legitimately received this order from us — order_id alone is
 * guessable-shaped and must never be trusted on its own.
 */
export interface CheckoutSessionRef {
  order_id: string;
  order_token: string;
}
