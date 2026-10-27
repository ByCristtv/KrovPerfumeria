import { createHash } from "node:crypto";
import type { OnvoWebhookEvent } from "@/lib/onvo/types";

/**
 * Pure parsing + idempotency-key logic for ONVO webhooks. No I/O, so every rule
 * here is unit-tested directly (event.test.ts).
 *
 * What ONVO documents (docs.onvopay.com/webhooks, verified 2026-10-25):
 *   - Body is `{ type, data }` — there is NO top-level event id.
 *   - payment-intent.* `data.id` is the PAYMENT INTENT id, shared by every
 *     event about that intent.
 *   - A declined card emits `payment-intent.failed` with `data.status:
 *     "requires_payment_method"` (intent still payable) and a `data.error`
 *     object carrying its own `id`.
 *   - Amounts are integers in the currency's minor unit.
 *   - Events may arrive out of order; process them idempotently.
 */

/** Event types that drive order state. Everything else is acknowledged inert. */
export type PaymentIntentEventType =
  | "payment-intent.succeeded"
  | "payment-intent.failed";

const PAYMENT_INTENT_EVENTS: readonly string[] = [
  "payment-intent.succeeded",
  "payment-intent.failed",
];

/**
 * Intent statuses after which no further payment attempt is possible. Anything
 * else on a failed event (notably `requires_payment_method`, or a missing
 * status) is a failed ATTEMPT on a still-payable intent.
 */
const TERMINAL_INTENT_STATUSES: readonly string[] = ["failed", "canceled", "cancelled"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedWebhook =
  /** An event that may change an order. Fields are shape-checked only. */
  | {
      kind: "payment_intent";
      type: PaymentIntentEventType;
      intentId: string;
      /** metadata.orderId exactly as sent (may be missing or not a UUID). */
      orderRef: string | null;
      amount: number | null;
      currency: string | null;
      intentStatus: string | null;
      /** data.error.id on failed events — distinguishes attempts. */
      attemptId: string | null;
      errorCode: string | null;
      payloadHash: string;
    }
  /** A well-formed event we deliberately don't act on. */
  | { kind: "inert"; type: string; objectId: string | null };

export type ParseResult =
  | { ok: true; event: ParsedWebhook }
  | { ok: false; reason: "invalid_json" | "malformed_event"; detail: string };

/** SHA-256 of the raw body, stored as processed_webhooks.payload_hash. */
export function hashPayload(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

/**
 * Parse the raw request body. Only the ENVELOPE is enforced here (JSON, `type`,
 * `data`, and `data.id` for payment-intent events): without those we can't
 * even key the event, so it is malformed. Business problems (missing order
 * reference, missing amount, …) are NOT parse errors — they are recorded in the
 * ledger as rejections by the processor so they stay visible.
 */
export function parseOnvoWebhook(rawBody: string): ParseResult {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "invalid_json", detail: "body is not valid JSON" };
  }

  if (!isRecord(body) || typeof body.type !== "string" || body.type === "") {
    return { ok: false, reason: "malformed_event", detail: "missing event type" };
  }
  if (!isRecord(body.data)) {
    return { ok: false, reason: "malformed_event", detail: "missing data object" };
  }

  const envelope = body as unknown as OnvoWebhookEvent;
  const data = envelope.data;
  const objectId = nonEmptyString(data.id);

  if (!PAYMENT_INTENT_EVENTS.includes(envelope.type)) {
    return { ok: true, event: { kind: "inert", type: envelope.type, objectId } };
  }

  if (!objectId) {
    return {
      ok: false,
      reason: "malformed_event",
      detail: `${envelope.type} without data.id`,
    };
  }

  const error = isRecord(data.error) ? data.error : null;

  return {
    ok: true,
    event: {
      kind: "payment_intent",
      type: envelope.type as PaymentIntentEventType,
      intentId: objectId,
      orderRef: isRecord(data.metadata) ? nonEmptyString(data.metadata.orderId) : null,
      amount: typeof data.amount === "number" ? data.amount : null,
      currency: nonEmptyString(data.currency),
      intentStatus: nonEmptyString(data.status),
      attemptId: error ? nonEmptyString(error.id) : null,
      errorCode: error ? nonEmptyString(error.code) : null,
      payloadHash: hashPayload(rawBody),
    },
  };
}

/**
 * The idempotency key stored in processed_webhooks.event_id.
 *
 *   succeeded → "payment-intent.succeeded:<intent>"
 *       An intent succeeds at most once, so redeliveries collapse.
 *   failed    → "payment-intent.failed:<intent>:<error.id>"
 *       Each declined attempt is its own event; a redelivery of the same
 *       attempt collapses. Without error.id we fall back to the payload hash,
 *       which still collapses byte-identical redeliveries.
 *
 * Including the type is what stops a decline from suppressing the later
 * success on the same intent (the old key was the bare intent id).
 */
export function webhookEventKey(
  event: Extract<ParsedWebhook, { kind: "payment_intent" }>
): string {
  if (event.type === "payment-intent.succeeded") {
    return `${event.type}:${event.intentId}`;
  }
  const attempt = event.attemptId ?? `sha256-${event.payloadHash}`;
  return `${event.type}:${event.intentId}:${attempt}`;
}

/** True when a failed event means the intent can never be paid. */
export function isTerminalFailure(intentStatus: string | null): boolean {
  return intentStatus !== null && TERMINAL_INTENT_STATUSES.includes(intentStatus.toLowerCase());
}

/** metadata.orderId must be one of our order UUIDs to be looked up at all. */
export function isOrderId(value: string | null): value is string {
  return value !== null && UUID_RE.test(value);
}

/** Minor-unit amounts are integers; anything else can't be validated. */
export function isMinorUnitAmount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
