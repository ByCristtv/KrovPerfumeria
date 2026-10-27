import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type AdminClient = SupabaseClient<Database>;

/**
 * Data-access wrapper around the webhook ledger RPCs from
 * 20261025000100_onvo_webhook_event_ledger.sql.
 *
 * The RPCs are typed only after `pnpm update-types` runs against the DB
 * post-migration, so — as in lib/notifications/store.ts — we cast narrowly HERE
 * and nowhere else.
 *
 * Unlike the notification store, every function here THROWS WebhookStoreError
 * on a database error: the caller must turn that into a retryable 5xx, never
 * into a silent 200.
 */

export const WEBHOOK_PROVIDER = "onvo";

/** How long a claim blocks duplicate deliveries before it can be re-claimed. */
export const WEBHOOK_LEASE_SECONDS = 120;

/** A database/transport failure. Always transient from the webhook's view. */
export class WebhookStoreError extends Error {
  constructor(
    readonly operation: string,
    underlying: unknown
  ) {
    super(`${operation} failed: ${describe(underlying)}`);
    this.name = "WebhookStoreError";
  }
}

export type ClaimResult =
  | {
      claimed: true;
      id: string;
      attempts: number;
      /** A previous attempt already committed the order change. */
      effects_applied: boolean;
      order_id: string | null;
    }
  | {
      claimed: false;
      id: string;
      status: "processing" | "processed" | "ignored" | "rejected";
      outcome?: string | null;
      order_id: string | null;
    };

export type TerminalStatus = "processed" | "ignored" | "rejected";

/** Why an intent could not be tied to exactly one order via payment_reference. */
export type AssociationFailure =
  | "intent_not_associated"
  | "order_mismatch"
  | "ambiguous_intent"
  | "order_not_found";

export interface SucceededResult {
  outcome: "paid" | "ignored" | "rejected";
  reason:
    | "marked_paid"
    | "already_applied"
    | "already_paid"
    | AssociationFailure
    | "order_denied"
    | "payment_not_pending"
    | "currency_mismatch"
    | "amount_mismatch";
  /** Trusted: resolved from orders.payment_reference, never from the payload. */
  order_id: string | null;
  expected_amount?: number;
}

export interface FailedResult {
  outcome: "failed" | "ignored";
  reason:
    | "marked_failed"
    | "already_applied"
    | "already_paid"
    | "already_final"
    | "retryable_attempt"
    | "order_shipped"
    | AssociationFailure;
  /** Trusted: resolved from orders.payment_reference, never from the payload. */
  order_id: string | null;
}

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

async function call<T>(admin: AdminClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  let response: Awaited<ReturnType<Rpc>>;
  try {
    response = await rpc(fn, args);
  } catch (err) {
    throw new WebhookStoreError(fn, err);
  }
  if (response.error) throw new WebhookStoreError(fn, response.error);
  if (response.data === null || response.data === undefined) {
    throw new WebhookStoreError(fn, "empty response");
  }
  return response.data as T;
}

export function claimWebhookEvent(
  admin: AdminClient,
  args: { eventId: string; eventType: string; intentId: string; payloadHash: string }
): Promise<ClaimResult> {
  return call<ClaimResult>(admin, "claim_webhook_event", {
    p_provider: WEBHOOK_PROVIDER,
    p_event_id: args.eventId,
    p_event_type: args.eventType,
    p_payment_intent_id: args.intentId,
    p_payload_hash: args.payloadHash,
    p_lease_seconds: WEBHOOK_LEASE_SECONDS,
  });
}

/** Close out a claimed event. Returns false if the row was no longer processing. */
export function completeWebhookEvent(
  admin: AdminClient,
  args: {
    id: string;
    status: TerminalStatus | "failed";
    outcome?: string | null;
    error?: string | null;
  }
): Promise<boolean> {
  return call<boolean>(admin, "complete_webhook_event", {
    p_id: args.id,
    p_status: args.status,
    p_outcome: args.outcome ?? null,
    p_error: args.error ?? null,
  });
}

export function applyPaymentSucceeded(
  admin: AdminClient,
  args: {
    webhookId: string;
    /** metadata.orderId — an untrusted cross-check, may be null. */
    orderHint: string | null;
    intentId: string;
    amount: number;
    currency: string;
  }
): Promise<SucceededResult> {
  return call<SucceededResult>(admin, "apply_onvo_payment_succeeded", {
    p_webhook_id: args.webhookId,
    p_order_id: args.orderHint,
    p_intent_id: args.intentId,
    p_amount: args.amount,
    p_currency: args.currency,
  });
}

export function applyPaymentFailed(
  admin: AdminClient,
  args: { webhookId: string; orderHint: string | null; intentId: string; terminal: boolean }
): Promise<FailedResult> {
  return call<FailedResult>(admin, "apply_onvo_payment_failed", {
    p_webhook_id: args.webhookId,
    p_order_id: args.orderHint,
    p_intent_id: args.intentId,
    p_terminal: args.terminal,
  });
}

/** Error text safe to log/store: messages and codes only, never payloads. */
function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause !== null) {
    const { message, code } = cause as { message?: unknown; code?: unknown };
    return [code, message].filter((v) => typeof v === "string").join(" ") || "unknown error";
  }
  return String(cause);
}
