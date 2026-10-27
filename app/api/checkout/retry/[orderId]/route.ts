import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyOrderToken } from "@/lib/orders/tokens";

/**
 * POST /api/checkout/retry/[orderId]
 *
 * HOSTED RETRY IS DISABLED (2026-10-26). This route used to mint an Onvo
 * hosted checkout session and overwrite orders.payment_reference with the
 * SESSION id. The webhook now only accepts a payment whose intent id IS the
 * order's persisted payment_reference (20261025000100), and a hosted session's
 * intent id is never known to us — so a retry paid here would charge the
 * customer without ever confirming the order (the order #144 failure mode).
 * The guards below still answer accurately; a payable order gets a 410 telling
 * the customer to contact us. Re-enable only together with a way to persist
 * the session's payment intent id.
 *
 * Used by:
 *   - "Reintentar pago" button on /orders/[id] (shown when ?cancelled=1)
 *   - Future: support tooling for customers stuck mid-payment
 *
 * Authorization:
 *   - RLS path: logged-in user owning the order
 *   - Token path: ?token=<hmac> matching signOrderToken(orderId)
 *   - Neither → 404 (don't leak existence)
 *
 * Guards:
 *   - Order is pending (payment_status='pending', order_status='pending')
 *   - Provider is onvo (forward-compat)
 *   - Age < 25 min — sweep cancels at 30 min; 5-min buffer prevents the race
 *     where a retry session is paid AFTER sweep has already denied the order.
 *     The webhook handler also guards against this case in defense-in-depth.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const token = request.nextUrl.searchParams.get("token");

  // ──────── UUID format guard ────────
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return notFoundResponse();
  }

  // ──────── Authorize: RLS or token ────────
  const userClient = await createClient();
  const { data: probe } = await userClient
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .maybeSingle();

  let authorized = probe !== null;
  if (!authorized && verifyOrderToken(orderId, token)) {
    authorized = true;
  }
  if (!authorized) {
    return notFoundResponse();
  }

  // ──────── Fetch order via admin (RLS bypass, we've already proved auth) ────────
  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id, order_number, total, order_status, payment_status, payment_provider, created_at"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error("[retry] order fetch failed", { orderId, error });
    return errorResponse("internal_error", "No pudimos cargar el pedido.", 500);
  }
  if (!order) {
    return notFoundResponse();
  }

  // ──────── State guards ────────
  if (order.payment_status === "paid") {
    return errorResponse(
      "already_paid",
      "Este pedido ya fue pagado. Revisa tu correo para los detalles.",
      409
    );
  }
  if (order.order_status === "denied") {
    return errorResponse(
      "order_denied",
      "Este pedido fue cancelado y no puede ser pagado. Por favor crea uno nuevo.",
      410
    );
  }
  if (order.payment_provider !== "onvo") {
    return errorResponse(
      "unsupported_provider",
      "Este pedido no admite reintentos automáticos. Contáctanos por WhatsApp.",
      400
    );
  }

  // ──────── Age check ────────
  const ageMinutes =
    (Date.now() - new Date(order.created_at).getTime()) / 60_000;
  if (ageMinutes > 25) {
    return errorResponse(
      "order_expired",
      "Este pedido es demasiado antiguo para reintentar el pago. Por favor contáctanos por WhatsApp para completarlo.",
      410
    );
  }

  // ──────── Hosted retry disabled — see header ────────
  console.warn("[retry] hosted retry requested but disabled", { orderId });
  return errorResponse(
    "retry_unavailable",
    "No podemos reintentar este pago en línea. Contáctanos por WhatsApp y te ayudamos a completarlo.",
    410
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function notFoundResponse() {
  return NextResponse.json(
    { error: "not_found", message: "Pedido no encontrado." },
    { status: 404 }
  );
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  hint?: string
) {
  return NextResponse.json(
    { error: code, message, ...(hint && { hint }) },
    { status }
  );
}
