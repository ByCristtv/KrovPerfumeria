/**
 * Onvo API types — based on https://docs.onvopay.com/llms-full.txt (2026).
 *
 * Names match Onvo's camelCase convention exactly. Don't snake_case at this
 * boundary — translate to/from our own conventions in the route handlers.
 */

/** A single line on a checkout session. */
export interface OnvoLineItem {
  quantity: number;
  /** Amount in smallest unit (céntimos for CRC: ₡5,000 → 500000). */
  unitAmount: number;
  currency: "CRC" | "USD";
  description?: string;
}

/** Input to POST /v1/checkout/sessions/one-time-link */
export interface OnvoCreateCheckoutSessionInput {
  lineItems: OnvoLineItem[];
  /** URL Onvo redirects to after successful payment. */
  redirectUrl: string;
  /** URL Onvo redirects to if the user cancels. Optional but recommended. */
  cancelUrl?: string;
  /**
   * Custom string key-value pairs. Forwarded to the underlying payment intent,
   * surfaced in webhook events as `data.metadata`. We use this to attach our
   * own order_id so the webhook handler can look up the order.
   */
  metadata?: Record<string, string>;
}

/** Response from POST /v1/checkout/sessions/one-time-link */
export interface OnvoCheckoutSession {
  id: string;
  /** Hosted-checkout URL to redirect the customer to. */
  url: string;
  /** Lifecycle status. Initial is 'open'. */
  status: "open" | "complete" | "expired" | string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedded checkout (Web SDK): Customers + Payment Intents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input to POST /v1/customers. Built from the checkout form. Onvo's customer
 * address only requires `country` at the API level; the descriptive CR address
 * lives on our own order record, so we send the country code only.
 */
export interface OnvoCreateCustomerInput {
  name: string;
  email: string;
  phone: string;
  address?: {
    /** ISO 3166-1 alpha-2. Costa Rica → "CR". */
    country: string;
  };
}

/** Response from POST /v1/customers. We only consume `id`. */
export interface OnvoCustomer {
  id: string;
}

/** Input to POST /v1/payment-intents. */
export interface OnvoCreatePaymentIntentInput {
  /** Amount in the currency's smallest unit (céntimos for CRC: ₡5,000 → 500000). */
  amount: number;
  currency: "CRC" | "USD";
  description?: string;
  /** Associates the intent with an Onvo customer. Optional at the API level. */
  customerId?: string;
  /**
   * Forwarded to the webhook as `data.metadata`. We attach our order_id so the
   * webhook handler (payment-intent.succeeded/failed) can correlate the intent
   * back to the order — same lookup key the hosted flow used.
   */
  metadata?: Record<string, string>;
}

/** Response from POST /v1/payment-intents. */
export interface OnvoPaymentIntent {
  id: string;
  amount: number;
  currency: "CRC" | "USD" | string;
  /** Lifecycle status. Initial is 'requires_payment_method'. */
  status: "requires_payment_method" | "succeeded" | "canceled" | string;
}

/**
 * Input to POST /v1/payment-intents/{id}/cancel.
 *
 * We deliberately DON'T use POST /v1/payment-intents/{id} ("Actualizar una
 * Intención de pago"). Onvo documents that the endpoint exists, but their
 * OpenAPI spec does not confirm `amount` is updatable — and if it silently
 * ignored an amount change, the customer would be charged the old total and the
 * webhook's amount check would then refuse to mark the order paid, leaving a
 * charged-but-unpaid order. Cancel + create a fresh intent instead: unambiguous,
 * and an unconfirmed intent costs nothing.
 */
export interface OnvoCancelPaymentIntentInput {
  /** Optional free-text reason, surfaced in the Onvo dashboard. */
  reason?: string;
}

/**
 * Webhook event types we care about. Onvo may add more — code MUST treat
 * unknown types as a no-op, not an error (don't break their retry loop).
 */
export type OnvoWebhookEventType =
  | "payment-intent.succeeded"
  | "payment-intent.failed"
  | "payment-intent.deferred"
  | "checkout-session.succeeded"
  | "subscription.renewal.succeeded"
  | "subscription.renewal.failed"
  | "mobile-transfer.received";

/**
 * Generic webhook envelope. The shape of `data` depends on event type; we
 * keep it loose here and narrow it in lib/onvo/webhook/event.ts.
 *
 * There is NO top-level event id (ONVO sends only `type` + `data`), and
 * `data.id` is the OBJECT id — shared by every event about that intent. See
 * webhookEventKey() for the idempotency key we derive instead.
 */
export interface OnvoWebhookEvent {
  type: OnvoWebhookEventType | string;
  data: {
    /** Object id — for payment-intent.* events this is the intent id; for
     *  checkout-session.* it's the session id. */
    id: string;
    amount?: number;
    currency?: string;
    /** Intent status after the event. A declined card leaves it at
     *  `requires_payment_method` — still payable on the same intent. */
    status?: string;
    metadata?: Record<string, string>;
    /** payment-intent.failed only: why the attempt failed. `id` identifies
     *  the attempt. */
    error?: { id?: string; code?: string; message?: string; type?: string };
    /** Forward-compatible: any other fields Onvo includes. */
    [key: string]: unknown;
  };
}
