import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  notifyCustomerOrderConfirmation,
  notifyOrderPaid,
  type NotifyResult,
} from "@/lib/notifications/orderNotifier";
import {
  isMinorUnitAmount,
  isOrderId,
  isTerminalFailure,
  webhookEventKey,
  type ParsedWebhook,
} from "./event";
import {
  WebhookStoreError,
  applyPaymentFailed,
  applyPaymentSucceeded,
  claimWebhookEvent,
  completeWebhookEvent,
  type ClaimResult,
  type TerminalStatus,
} from "./store";

type AdminClient = SupabaseClient<Database>;
type PaymentIntentEvent = Extract<ParsedWebhook, { kind: "payment_intent" }>;
type ClaimedEvent = Extract<ClaimResult, { claimed: true }>;

/** Collaborators, injectable so tests run without a DB or Resend. */
export interface WebhookDeps {
  admin: AdminClient;
  notifyOrderPaid?: (orderId: string, deps: { admin: AdminClient }) => Promise<NotifyResult>;
  notifyCustomerOrderConfirmation?: (
    orderId: string,
    deps: { admin: AdminClient }
  ) => Promise<NotifyResult>;
}

/** Why a delivery must be retried. Logged as `failure_category`. */
export type FailureCategory = "ledger_unavailable" | "database_error" | "internal_error";

/** What happened to one delivery. The route maps this to an HTTP status. */
export type ProcessResult =
  | { status: TerminalStatus; reason: string; orderId: string | null }
  | { status: "duplicate"; previous: string; orderId: string | null }
  | { status: "in_progress" }
  | { status: "retryable_error"; category: FailureCategory };

/** Handler verdict, before it is written to the ledger. */
interface Verdict {
  status: TerminalStatus;
  reason: string;
  orderId: string | null;
  /** Non-sensitive detail kept in processed_webhooks.last_error for review. */
  note?: string;
}

/**
 * Process one authenticated, parsed ONVO webhook.
 *
 *   1. claim     — atomic, leased reservation of the idempotency key. Losing
 *                  the claim means a duplicate (done) or a concurrent delivery
 *                  (in progress); either way, zero side effects.
 *   2. apply     — one DB transaction validates and changes the order AND
 *                  records effects_applied_at on the ledger row.
 *   3. effects   — post-commit side effects (emails), idempotent via the
 *                  order_notifications ledger.
 *   4. complete  — only now is the event marked processed / ignored / rejected.
 *
 * Any throw between claim and complete marks the event `failed` (re-claimable)
 * and returns retryable_error, so ONVO's redelivery resumes it. A re-claimed
 * event whose order change already committed skips straight to step 3.
 *
 * Never throws.
 */
export async function processOnvoWebhook(
  event: ParsedWebhook,
  deps: WebhookDeps
): Promise<ProcessResult> {
  if (event.kind === "inert") {
    log("info", "event ignored", {
      event_type: event.type,
      object_id: event.objectId,
      outcome: "ignored",
      reason: "unhandled_event_type",
    });
    return { status: "ignored", reason: "unhandled_event_type", orderId: null };
  }

  const eventKey = webhookEventKey(event);
  const base: LogFields = {
    event_type: event.type,
    event_key: eventKey,
    intent_id: event.intentId,
    // Untrusted payload value; trusted ids are logged as order_id once the DB
    // has resolved the order.
    order_hint: event.orderRef,
  };

  // ── 1. Claim ──
  let claim: ClaimResult;
  try {
    claim = await claimWebhookEvent(deps.admin, {
      eventId: eventKey,
      eventType: event.type,
      intentId: event.intentId,
      payloadHash: event.payloadHash,
    });
  } catch (err) {
    log("error", "could not claim event — retryable", {
      ...base,
      outcome: "retryable_error",
      failure_category: "ledger_unavailable",
      error: errorMessage(err),
    });
    return { status: "retryable_error", category: "ledger_unavailable" };
  }

  if (!claim.claimed) {
    if (claim.status === "processing") {
      log("warn", "concurrent delivery in progress", { ...base, outcome: "in_progress" });
      return { status: "in_progress" };
    }
    log("info", "duplicate delivery", {
      ...base,
      order_id: claim.order_id,
      outcome: "duplicate",
      reason: claim.status,
    });
    return { status: "duplicate", previous: claim.status, orderId: claim.order_id };
  }

  const fields: LogFields = { ...base, attempt: claim.attempts };

  // ── 2–3. Apply + side effects ──
  let verdict: Verdict;
  try {
    verdict =
      event.type === "payment-intent.succeeded"
        ? await handleSucceeded(event, claim, deps, fields)
        : await handleFailed(event, claim, deps);
  } catch (err) {
    const category: FailureCategory =
      err instanceof WebhookStoreError ? "database_error" : "internal_error";
    log("error", "processing failed — retryable", {
      ...fields,
      outcome: "retryable_error",
      failure_category: category,
      error: errorMessage(err),
    });
    try {
      await completeWebhookEvent(deps.admin, {
        id: claim.id,
        status: "failed",
        error: `${category}: ${errorMessage(err)}`,
      });
    } catch (markErr) {
      // The lease still expires, after which the event is re-claimable.
      log("error", "could not mark event failed", {
        ...fields,
        failure_category: "ledger_unavailable",
        error: errorMessage(markErr),
      });
    }
    return { status: "retryable_error", category };
  }

  // ── 4. Complete ──
  try {
    await completeWebhookEvent(deps.admin, {
      id: claim.id,
      status: verdict.status,
      outcome: verdict.reason,
      error: verdict.note ?? null,
    });
  } catch (err) {
    // The order change (if any) is committed and every side effect has run, so
    // the delivery IS handled. The row stays 'processing' until its lease
    // expires; any redelivery then re-claims it and only closes it out.
    log("error", "event handled but ledger completion failed", {
      ...fields,
      order_id: verdict.orderId,
      failure_category: "ledger_unavailable",
      error: errorMessage(err),
    });
  }

  const level = verdict.status === "rejected" ? "error" : "info";
  log(level, verdict.status === "rejected" ? "event rejected — MANUAL REVIEW" : "event handled", {
    ...fields,
    order_id: verdict.orderId,
    outcome: verdict.status,
    reason: verdict.reason,
    ...(verdict.note && { note: verdict.note }),
  });

  return { status: verdict.status, reason: verdict.reason, orderId: verdict.orderId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleSucceeded(
  event: PaymentIntentEvent,
  claim: ClaimedEvent,
  deps: WebhookDeps,
  fields: LogFields
): Promise<Verdict> {
  // Crash recovery: a previous attempt of THIS event committed the paid state
  // (effects_applied_at is written in the same transaction) and died before
  // closing out. Only the idempotent notifications are left; the order change
  // is never re-applied. claim.order_id is the trusted order from that commit.
  if (claim.effects_applied && claim.order_id) {
    await sendPaidNotifications(claim.order_id, deps, fields);
    return { status: "processed", reason: "resumed_after_apply", orderId: claim.order_id };
  }

  // metadata.orderId is only a hint — the DB resolves the order from the
  // persisted payment_reference. A hint that isn't even a UUID contradicts
  // that, so refuse rather than guess.
  if (event.orderRef !== null && !isOrderId(event.orderRef)) {
    return { status: "rejected", reason: "invalid_order_reference", orderId: null };
  }
  if (!isMinorUnitAmount(event.amount) || !event.currency) {
    return {
      status: "rejected",
      reason: "invalid_amount",
      orderId: null,
      note: `amount=${String(event.amount)} currency=${String(event.currency)}`,
    };
  }

  const result = await applyPaymentSucceeded(deps.admin, {
    webhookId: claim.id,
    orderHint: event.orderRef,
    intentId: event.intentId,
    amount: event.amount,
    currency: event.currency,
  });

  if (result.outcome === "paid") {
    // 'marked_paid' or 'already_applied' (the DB's own re-entry guard). Either
    // way the order id comes from the DB, never from the payload.
    if (!result.order_id) {
      throw new Error("apply_onvo_payment_succeeded returned paid without an order id");
    }
    await sendPaidNotifications(result.order_id, deps, fields);
    return { status: "processed", reason: result.reason, orderId: result.order_id };
  }

  if (result.outcome === "ignored") {
    return { status: "ignored", reason: result.reason, orderId: result.order_id };
  }

  return {
    status: "rejected",
    reason: result.reason,
    orderId: result.order_id,
    note: rejectionNote(result.reason, event, result.expected_amount),
  };
}

async function handleFailed(
  event: PaymentIntentEvent,
  claim: ClaimedEvent,
  deps: WebhookDeps
): Promise<Verdict> {
  // Crash recovery: the deny + stock restore already committed; nothing else
  // follows a failure, so just close the event out.
  if (claim.effects_applied && claim.order_id) {
    return { status: "processed", reason: "resumed_after_apply", orderId: claim.order_id };
  }

  // A failed attempt puts nothing at stake; a non-UUID hint can't be checked.
  if (event.orderRef !== null && !isOrderId(event.orderRef)) {
    return { status: "ignored", reason: "invalid_order_reference", orderId: null };
  }

  const result = await applyPaymentFailed(deps.admin, {
    webhookId: claim.id,
    orderHint: event.orderRef,
    intentId: event.intentId,
    terminal: isTerminalFailure(event.intentStatus),
  });

  if (result.outcome === "failed") {
    return { status: "processed", reason: result.reason, orderId: result.order_id };
  }
  return {
    status: "ignored",
    reason: result.reason,
    orderId: result.order_id,
    note: event.errorCode ? `error_code=${event.errorCode}` : undefined,
  };
}

/**
 * Card payment confirmed → OWNER alert + CUSTOMER "Confirmed / Paid" email.
 * Both are idempotent through order_notifications, so a resumed event never
 * double-sends. A provider failure is logged (the ledger row stays `failed` and
 * re-claimable) but does not fail the webhook: the payment state is committed
 * and retrying the delivery cannot fix an email outage.
 */
async function sendPaidNotifications(
  orderId: string,
  deps: WebhookDeps,
  fields: LogFields
): Promise<void> {
  const notifyOwner = deps.notifyOrderPaid ?? notifyOrderPaid;
  const notifyCustomer = deps.notifyCustomerOrderConfirmation ?? notifyCustomerOrderConfirmation;

  const results = await Promise.allSettled([
    notifyOwner(orderId, { admin: deps.admin }),
    notifyCustomer(orderId, { admin: deps.admin }),
  ]);

  const thrown = results.find((r) => r.status === "rejected");
  if (thrown) {
    // Contract says notifiers never throw; if one does, retry the event.
    throw thrown.reason;
  }

  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled" && r.value.status === "failed") {
      log("error", "notification failed (payment state unaffected)", {
        ...fields,
        order_id: orderId,
        failure_category: "notification_failed",
        notification: i === 0 ? "order_payment_confirmed" : "customer_order_confirmation",
        error: r.value.reason,
      });
    }
  }
}

function rejectionNote(
  reason: string,
  event: PaymentIntentEvent,
  expectedAmount: number | undefined
): string | undefined {
  switch (reason) {
    case "amount_mismatch":
      return `expected=${String(expectedAmount)} received=${String(event.amount)}`;
    case "currency_mismatch":
      return `received_currency=${String(event.currency)}`;
    case "intent_not_associated":
      return "succeeded intent is not this order's payment_reference — possible misrouted or second charge, review manually";
    case "order_mismatch":
      return "metadata.orderId names a different order than the intent's payment_reference — review manually";
    case "ambiguous_intent":
      return "several orders reference this intent — data error, review manually";
    case "order_not_found":
      return "no order references this intent — charge with no order, review manually";
    case "order_denied":
      return "payment succeeded for an already-denied order — MANUAL REFUND NEEDED";
    case "payment_not_pending":
      return "payment succeeded for an order that is failed/refunded — review manually";
    default:
      return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Structured fields only — ids, outcomes, categories. Never the webhook secret,
 * the raw payload, or customer data (name/email/phone ride in data.customer).
 */
interface LogFields {
  event_type?: string;
  event_key?: string;
  intent_id?: string;
  object_id?: string | null;
  /** metadata.orderId as sent — untrusted. */
  order_hint?: string | null;
  /** Order resolved by the DB from payment_reference — trusted. */
  order_id?: string | null;
  attempt?: number;
  outcome?: string;
  reason?: string;
  failure_category?: string;
  notification?: string;
  note?: string;
  error?: string;
}

function log(level: "info" | "warn" | "error", message: string, fields: LogFields): void {
  console[level](`[onvo-webhook] ${message}`, fields);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}
