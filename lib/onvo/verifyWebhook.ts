import { timingSafeEqual } from "node:crypto";

/**
 * Verify an Onvo webhook request by comparing the X-Webhook-Secret header
 * to our ONVO_WEBHOOK_SECRET env var.
 *
 * IMPORTANT CAVEAT: Onvo's documentation (as of 2026) shows the header
 * containing the literal webhook secret (prefix: webhook_secret_...), NOT an
 * HMAC signature. This means:
 *   - Anyone who captures one webhook header sees the long-lived secret.
 *   - Replay protection is weak: a captured webhook can be replayed forever.
 *
 * Our webhook processing defends in depth by additionally verifying, inside
 * the apply_onvo_payment_* RPCs (20261025000100):
 *   1. The order is resolved from OUR persisted data: the one order whose
 *      payment_reference is the event's intent id. metadata.orderId is only
 *      cross-checked; an intent no order references never changes any order.
 *   2. The webhook amount (céntimos) and currency match the order total
 *
 * Remaining gap: intent ids are visible to the customer's browser (the SDK
 * needs them), so anyone holding the static secret could still forge a
 * "succeeded" event for a real (order, intent) pair. Closing that needs a
 * server-side GET of the intent from ONVO before marking paid.
 *
 * Even with all three, the security model is weaker than HMAC-based webhooks
 * (Stripe-style). Revisit if/when Onvo publishes an HMAC verification spec.
 *
 * Uses `timingSafeEqual` to prevent timing-attack character leakage during
 * the comparison itself.
 */
export function verifyOnvoWebhookSecret(
  receivedHeader: string | null | undefined,
  expectedSecret: string
): boolean {
  if (!receivedHeader || !expectedSecret) return false;

  const a = Buffer.from(receivedHeader, "utf8");
  const b = Buffer.from(expectedSecret, "utf8");

  // timingSafeEqual requires same-length buffers. Different length is an
  // immediate fail — the length difference itself isn't a useful side-channel
  // (the secret is fixed length, ours is fixed length).
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
