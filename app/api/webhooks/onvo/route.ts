import { NextRequest, NextResponse } from "next/server";
import { getOnvoEnv } from "@/lib/onvo/env";
import { verifyOnvoWebhookSecret } from "@/lib/onvo/verifyWebhook";
import { parseOnvoWebhook } from "@/lib/onvo/webhook/event";
import { processOnvoWebhook, type ProcessResult } from "@/lib/onvo/webhook/processor";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/webhooks/onvo
 *
 * Receives payment-status callbacks from Onvo. This is the SOURCE OF TRUTH
 * for whether a payment succeeded — the customer's browser is not trusted.
 * Canonical URL: https://www.krovperfumeria.com/api/webhooks/onvo. The apex
 * domain answers 308; deliveries sent there never reached this route (order
 * #144), so ONVO must always be configured with the www URL.
 *
 * This route is a thin adapter: authenticate → parse → delegate to
 * lib/onvo/webhook/processor.ts → map the outcome to HTTP.
 *
 * Response policy. ONVO documents: "respond 2xx only when the event was
 * received and processed correctly; any other status is recorded as a failed
 * delivery". Its retry schedule is NOT documented, so nothing here relies on
 * retries happening — the ledger makes them safe when they do.
 *
 *   401  missing / wrong X-Webhook-Secret
 *   400  body is not JSON, or the envelope can't be keyed (no type/data/id)
 *   409  the same event is being processed by a concurrent delivery
 *   500  transient failure (DB, unexpected error) or missing server config —
 *        the event is left re-claimable so a redelivery resumes it
 *   200  processed, intentionally ignored, duplicate of a handled event, or
 *        REJECTED (permanent business exception: intent not associated with
 *        the order via payment_reference, amount/currency mismatch, unknown
 *        order, paid-after-cancel). Rejections are stored in
 *        processed_webhooks with status='rejected' and logged at error level;
 *        a redelivery could never change their outcome, so they are not retried.
 *
 * Security caveat:
 *   - Onvo's webhook authentication is a static shared secret in the
 *     X-Webhook-Secret header rather than HMAC over the body. We compensate
 *     with order/amount/currency checks inside the apply_* RPCs. See
 *     lib/onvo/verifyWebhook.ts for the full caveat.
 */
export async function POST(request: NextRequest) {
  // ────────── 1. Authenticate the webhook ──────────
  let webhookSecret: string;
  try {
    webhookSecret = getOnvoEnv().webhookSecret;
  } catch (err) {
    console.error("[onvo-webhook] server misconfigured — cannot verify webhook", {
      failure_category: "config_error",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const headerSecret = request.headers.get("x-webhook-secret");
  if (!verifyOnvoWebhookSecret(headerSecret, webhookSecret)) {
    console.warn("[onvo-webhook] rejected: invalid or missing X-Webhook-Secret", {
      header_present: headerSecret !== null,
    });
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // ────────── 2. Parse the event ──────────
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (err) {
    console.error("[onvo-webhook] could not read request body", {
      failure_category: "internal_error",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "body_unreadable" }, { status: 500 });
  }

  const parsed = parseOnvoWebhook(rawBody);
  if (!parsed.ok) {
    console.error("[onvo-webhook] malformed payload — NOT processed", {
      failure_category: parsed.reason,
      detail: parsed.detail,
      body_bytes: rawBody.length,
    });
    return NextResponse.json({ error: parsed.reason }, { status: 400 });
  }

  // ────────── 3. Process ──────────
  let result: ProcessResult;
  try {
    result = await processOnvoWebhook(parsed.event, { admin: createAdminClient() });
  } catch (err) {
    // processOnvoWebhook never throws; this guards createAdminClient (env).
    console.error("[onvo-webhook] could not start processing", {
      failure_category: "config_error",
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  return toResponse(result);
}

function toResponse(result: ProcessResult): NextResponse {
  switch (result.status) {
    case "processed":
    case "ignored":
    case "rejected":
      return NextResponse.json({
        received: true,
        status: result.status,
        reason: result.reason,
      });
    case "duplicate":
      return NextResponse.json({
        received: true,
        status: "duplicate",
        previous: result.previous,
      });
    case "in_progress":
      return NextResponse.json(
        { error: "in_progress" },
        { status: 409, headers: { "Retry-After": "120" } }
      );
    case "retryable_error":
      return NextResponse.json(
        { error: "retryable_error", category: result.category },
        { status: 500 }
      );
  }
}
