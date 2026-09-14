"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { AdminOrderInput, AdminOrderResult } from "@/types/adminOrder";
import { notifyOrderPaid } from "@/lib/notifications/orderNotifier";
import {
  createAdminOrder,
  type CustomerNotification,
} from "@/lib/orders/adminOrderService";

/**
 * Server actions for admin order management UI (Phase 7).
 *
 * Three layers of defense:
 *   1. proxy.ts redirects non-admins away from /admin/* before render
 *   2. The underlying RPCs run is_admin() guards internally
 *   3. This module translates RPC errors → friendly Spanish messages
 *
 * Each action returns the same envelope: { ok, message, data? }.
 * Callers (Client Components via useTransition) read it and decide UI feedback.
 */

export interface ActionResult<TData = unknown> {
  ok: boolean;
  message: string;
  data?: TData;
}

// ─────────────────────────────────────────────────────────────────────────────
// advanceOrderStatusAction
// ─────────────────────────────────────────────────────────────────────────────
// pending → received → shipped (no skips, no rollbacks)

export async function advanceOrderStatusAction(
  orderId: string,
  newStatus: "received" | "shipped"
): Promise<ActionResult<{ previous_status: string; new_status: string }>> {
  if (!isUuid(orderId)) {
    return { ok: false, message: "ID de pedido inválido." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("advance_order_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
  });

  if (error) {
    return rpcError(error, fallbackMessages.advance);
  }

  // Both list and detail need to refresh.
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);

  const result = data as unknown as {
    previous_status: string;
    new_status: string;
  };
  return {
    ok: true,
    message:
      newStatus === "received"
        ? "Pedido marcado como recibido."
        : "Pedido marcado como enviado.",
    data: result,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// denyOrderAction
// ─────────────────────────────────────────────────────────────────────────────
// Cancel an order from any non-shipped state. Restores stock via the RPC.
// If the order was already paid, this only records intent — the actual
// money refund happens in the Onvo dashboard (or admin SINPE transfer for
// manual orders).

export async function denyOrderAction(
  orderId: string,
  reason: string
): Promise<
  ActionResult<{
    denied: boolean;
    needs_external_refund?: boolean;
  }>
> {
  if (!isUuid(orderId)) {
    return { ok: false, message: "ID de pedido inválido." };
  }
  if (!reason || reason.trim().length === 0) {
    return {
      ok: false,
      message: "Por favor proporciona una razón para cancelar el pedido.",
    };
  }
  if (reason.length > 500) {
    return { ok: false, message: "La razón es demasiado larga (máx 500)." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("deny_order_admin", {
    p_order_id: orderId,
    p_reason: reason.trim(),
  });

  if (error) {
    return rpcError(error, fallbackMessages.deny);
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);

  const result = data as unknown as {
    denied: boolean;
    needs_external_refund?: boolean;
    reason?: string;
  };

  if (result.denied === false && result.reason === "already_denied") {
    return {
      ok: true,
      message: "El pedido ya estaba cancelado.",
      data: result,
    };
  }

  const baseMsg = "Pedido cancelado y stock restaurado.";
  const refundNote = result.needs_external_refund
    ? " Recuerda procesar el reembolso desde Onvo."
    : "";

  return { ok: true, message: baseMsg + refundNote, data: result };
}

// ─────────────────────────────────────────────────────────────────────────────
// markOrderPaidAction
// ─────────────────────────────────────────────────────────────────────────────
// For offline payments (SINPE Móvil to store, cash in person, etc.). Only
// works if order is fresh-pending (payment_status=pending AND order_status=pending).

export async function markOrderPaidAction(
  orderId: string,
  reference?: string,
  note?: string
): Promise<ActionResult> {
  if (!isUuid(orderId)) {
    return { ok: false, message: "ID de pedido inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_order_paid", {
    p_order_id: orderId,
    p_reference: reference?.trim() || undefined,
    p_note: note?.trim() || undefined,
  });

  if (error) {
    return rpcError(error, fallbackMessages.markPaid);
  }

  // The order just transitioned to paid — notify the owner (mainly the "SINPE
  // pending → paid" confirmation). Idempotent and non-throwing: if the Onvo
  // webhook already sent a paid notification for this order, this is a no-op,
  // and a Resend failure never affects the mark-paid result.
  await notifyOrderPaid(orderId);

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);

  return {
    ok: true,
    message:
      "Pedido marcado como pagado. Ahora puedes avanzarlo a 'Recibido' cuando estés listo para prepararlo.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// createAdminOrderAction
// ─────────────────────────────────────────────────────────────────────────────
// Manual order on behalf of a customer who contacted the store off-site.
// Delegates to the place_admin_order RPC (admin-guarded, atomic, deducts stock,
// always payment_status='pending'). Reuses the website's order machinery.

export async function createAdminOrderAction(
  input: AdminOrderInput
): Promise<ActionResult<AdminOrderResult>> {
  const supabase = await createClient();
  const outcome = await createAdminOrder({ supabase }, input);

  if (!outcome.ok) {
    return outcome.kind === "validation"
      ? { ok: false, message: outcome.message }
      : rpcError(outcome.error, fallbackMessages.create);
  }

  revalidatePath("/admin/orders");

  return {
    ok: true,
    message:
      "Pedido creado. Pendiente de pago." +
      confirmationNote(outcome.notification),
    data: outcome.data,
  };
}

/**
 * A one-line postscript about the customer confirmation, appended to the success
 * message. Never changes `ok`: the order is created either way, and the admin
 * needs to know whether to follow up by hand — not to be told the sale failed.
 * Silent when there was no address to write to, which is the ordinary case for a
 * WhatsApp order.
 */
function confirmationNote(notification: CustomerNotification): string {
  if (!notification.attempted) return "";
  switch (notification.status) {
    case "sent":
      return " Se envió la confirmación al cliente.";
    case "failed":
      return " No se pudo enviar el correo de confirmación; avísale al cliente por otro medio.";
    default:
      // "skipped" — already sent for this order, or the notifier declined it.
      return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}

const fallbackMessages = {
  advance: "No pudimos avanzar el estado del pedido.",
  deny: "No pudimos cancelar el pedido.",
  markPaid: "No pudimos marcar el pedido como pagado.",
  create: "No pudimos crear el pedido.",
} as const;

/**
 * Translate a PostgreSQL exception from one of our RPCs to a friendly message.
 * Pattern-matches the RAISE EXCEPTION text. If unknown, log + return generic.
 *
 * Generic over the caller's TData so the {ok:false} return value type-narrows
 * to match the action's declared return type. (rpcError never sets `data`,
 * so the type variable only exists to satisfy assignment.)
 */
function rpcError<TData>(
  error: PostgrestError,
  fallback: string
): ActionResult<TData> {
  const msg = error.message ?? "";

  if (/Insufficient privilege/i.test(msg)) {
    return {
      ok: false,
      message: "No tienes permiso para realizar esta acción.",
    };
  }
  if (/does not exist/i.test(msg)) {
    return { ok: false, message: "El pedido no existe." };
  }
  if (/Cannot advance to received|Cannot advance to shipped/i.test(msg)) {
    return {
      ok: false,
      message:
        "No se puede avanzar el pedido desde su estado actual. Actualiza la página para ver el estado más reciente.",
    };
  }
  if (/Cannot deny a shipped order/i.test(msg)) {
    return {
      ok: false,
      message:
        "No se puede cancelar un pedido que ya fue enviado. Contacta soporte técnico.",
    };
  }
  if (/cannot mark as paid/i.test(msg)) {
    return {
      ok: false,
      message:
        "Este pedido no puede marcarse como pagado (puede estar ya pagado, cancelado, o en otro estado).",
    };
  }
  if (/A reason is required/i.test(msg)) {
    return {
      ok: false,
      message: "Por favor proporciona una razón para cancelar el pedido.",
    };
  }
  if (/Insufficient stock|insufficient_stock|decant liquid|stock/i.test(msg)) {
    return {
      ok: false,
      message:
        "No hay stock suficiente para uno de los productos. Ajusta las cantidades e inténtalo de nuevo.",
    };
  }
  if (/no longer exists|no longer available/i.test(msg)) {
    return {
      ok: false,
      message:
        "Uno de los productos ya no está disponible. Quítalo del pedido e inténtalo de nuevo.",
    };
  }
  if (/discount cannot/i.test(msg)) {
    return { ok: false, message: "El descuento no es válido para este pedido." };
  }

  // Unknown error — log it so we can investigate.
  console.error("[admin/orders/actions] unexpected RPC error", error);
  return { ok: false, message: fallback };
}
