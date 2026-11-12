import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  LinkableCustomer,
  LinkOrderResult,
  LinkXpStatus,
  UnlinkedOrderRow,
} from "@/types/orderLinking";
import { calculateOrderXp } from "@/lib/rank";
import { formatPrice, formatXp } from "@/lib/format";
import { searchCustomers, type CustomerLookupOutcome } from "./adminCustomerLookup";

/**
 * "Ligar Pedidos": attach a historical guest order to a registered account.
 *
 * Everything that decides anything lives in the database
 * (admin_link_order_to_customer, migration 20261110000200): the lock, the
 * still-unlinked check, the account check and the XP award through the one
 * grant_order_xp. This module is the typed adapter around it plus the pure,
 * display-only helpers the dialog needs (XP preview, "same phone" hints).
 *
 * Every function takes the REQUEST-SCOPED client: the RPCs run is_admin()
 * against the caller's session. Never hand them the service-role client.
 */

// ─────────────────────────────────────────────────────────────────────────────
// RPC signatures — not in types/database.ts until `pnpm update-types` runs
// after migration 20261110000200; this block and the cast in `linkRpc` can
// then be deleted.
// ─────────────────────────────────────────────────────────────────────────────

interface LinkRpcSignatures {
  admin_list_unlinked_orders: {
    args: {
      p_search: string | null;
      p_order_status: string | null;
      p_payment_status: string | null;
      p_limit: number;
      p_offset: number;
    };
    returns: (Record<keyof UnlinkedOrderRow, unknown> & { total_count: number | string })[];
  };
  admin_link_order_to_customer: {
    args: { p_order_id: string; p_user_id: string };
    returns: Record<keyof LinkOrderResult, unknown>;
  };
}

interface LinkRpcError {
  message: string;
  code?: string;
}

export async function linkRpc<N extends keyof LinkRpcSignatures>(
  client: SupabaseClient<Database>,
  name: N,
  args: LinkRpcSignatures[N]["args"]
): Promise<{ data: LinkRpcSignatures[N]["returns"] | null; error: LinkRpcError | null }> {
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: LinkRpcError | null }>;
  const { data, error } = await rpc(name, args as unknown as Record<string, unknown>);
  return { data: (data as LinkRpcSignatures[N]["returns"] | null) ?? null, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// XP preview — DISPLAY ONLY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statuses whose XP is awarded at link time. Mirrors grant_order_xp's guard
 * (migration 20261110000200): an order earns XP once it reaches `received`, and
 * a `shipped` order went through `received` first.
 */
export const LINK_XP_ELIGIBLE_STATUSES: readonly string[] = ["received", "shipped"];

export type LinkXpPreview =
  /** XP lands on the account as part of the link. */
  | { kind: "now"; xp: number }
  /** Not received yet — the existing trigger awards it later, to this account. */
  | { kind: "later"; xp: number }
  /** Cancelled: no XP, now or later. */
  | { kind: "never" };

/**
 * What linking this order would do to the customer's XP. The database decides
 * for real (and reports `already_granted` in the rare case a previous owner was
 * credited); this is what the confirmation step shows beforehand.
 */
export function previewLinkXp(
  order: Pick<UnlinkedOrderRow, "order_status" | "subtotal" | "discount">
): LinkXpPreview {
  const xp = calculateOrderXp(order.subtotal - order.discount);
  if (LINK_XP_ELIGIBLE_STATUSES.includes(order.order_status)) return { kind: "now", xp };
  if (order.order_status === "pending") return { kind: "later", xp };
  return { kind: "never" };
}

// ─────────────────────────────────────────────────────────────────────────────
// "Is this the same person?" hints
// ─────────────────────────────────────────────────────────────────────────────

/** Digits only, last 8 — Costa Rican numbers with or without +506 / dashes. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/**
 * Which of the order's contact details the candidate account shares. A hint for
 * the admin choosing between similar names — never a rule: plenty of genuine
 * matches share neither (a new number, an order taken without email).
 */
export function matchSignals(
  order: Pick<UnlinkedOrderRow, "customer_email" | "customer_phone">,
  customer: Pick<LinkableCustomer, "email" | "phone">
): { email: boolean; phone: boolean } {
  const orderEmail = order.customer_email?.trim().toLowerCase();
  const orderPhone = phoneKey(order.customer_phone);
  return {
    email: Boolean(orderEmail) && orderEmail === customer.email.trim().toLowerCase(),
    phone: orderPhone !== null && orderPhone === phoneKey(customer.phone),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// List rows
// ─────────────────────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const textOrNull = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

/** RPC row → list row. NUMERIC arrives as a string through PostgREST. */
export function mapUnlinkedOrderRow(
  row: Record<string, unknown>
): UnlinkedOrderRow {
  return {
    id: String(row.id),
    order_number: num(row.order_number),
    customer_name: String(row.customer_name ?? ""),
    customer_email: textOrNull(row.customer_email),
    customer_phone: textOrNull(row.customer_phone),
    subtotal: num(row.subtotal),
    discount: num(row.discount),
    shipping_cost: num(row.shipping_cost),
    total: num(row.total),
    order_status: String(row.order_status ?? ""),
    payment_status: String(row.payment_status ?? ""),
    payment_provider: textOrNull(row.payment_provider),
    source: String(row.source ?? ""),
    created_at: String(row.created_at ?? ""),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer search — registered CUSTOMER accounts only
// ─────────────────────────────────────────────────────────────────────────────

const LINKABLE_ROLES: readonly string[] = ["customer", "wholesale"];

/**
 * Reuses the manual-order customer search (admin_search_customers: name, email
 * or phone, admin-guarded, reads auth.users server-side), then keeps only
 * customer accounts and adds what tells similar names apart — member-since date
 * and XP — from `profiles`, which the admin session may read under RLS.
 *
 * Admin accounts are dropped here for the UX; the link RPC refuses them anyway.
 */
export async function searchLinkableCustomers(
  supabase: SupabaseClient<Database>,
  rawQuery: string
): Promise<CustomerLookupOutcome<LinkableCustomer[]>> {
  const found = await searchCustomers(supabase, rawQuery);
  if (!found.ok || found.data.length === 0) return found.ok ? { ok: true, data: [] } : found;

  const ids = found.data.map((c) => c.user_id);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, created_at, experience_points")
    .in("id", ids);

  if (error) {
    console.error("[admin/orders/link] profile lookup failed");
    return { ok: false, message: "No pudimos buscar clientes. Inténtalo de nuevo." };
  }

  const profiles = new Map((data ?? []).map((p) => [p.id, p]));
  const customers: LinkableCustomer[] = [];
  for (const match of found.data) {
    const profile = profiles.get(match.user_id);
    if (!profile || !LINKABLE_ROLES.includes(profile.role)) continue;
    customers.push({
      user_id: match.user_id,
      full_name: match.full_name,
      email: match.email,
      phone: match.phone,
      role: profile.role as LinkableCustomer["role"],
      member_since: profile.created_at ?? null,
      experience_points: num(profile.experience_points),
    });
  }
  return { ok: true, data: customers };
}

// ─────────────────────────────────────────────────────────────────────────────
// The link
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LinkOrderOutcome =
  | { ok: true; data: LinkOrderResult }
  /** `stale`: the order is no longer linkable (linked by someone else, or gone). */
  | { ok: false; message: string; stale?: boolean };

const XP_STATUSES: readonly LinkXpStatus[] = [
  "granted",
  "already_granted",
  "pending_status",
  "not_eligible",
];

export async function linkOrderToCustomer(
  supabase: SupabaseClient<Database>,
  orderId: string,
  userId: string
): Promise<LinkOrderOutcome> {
  if (typeof orderId !== "string" || !UUID_RE.test(orderId)) {
    return { ok: false, message: "ID de pedido inválido." };
  }
  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    return { ok: false, message: "Selecciona un cliente válido." };
  }

  const { data, error } = await linkRpc(supabase, "admin_link_order_to_customer", {
    p_order_id: orderId,
    p_user_id: userId,
  });

  if (error) {
    return {
      ok: false,
      message: linkErrorMessage(error.message),
      stale: /link_order_(already_linked|not_found)/.test(error.message ?? ""),
    };
  }
  if (!data) {
    console.error("[admin/orders/link] link RPC returned no data", { orderId });
    return { ok: false, message: "No pudimos ligar el pedido. Inténtalo de nuevo." };
  }

  const status = String(data.xp_status) as LinkXpStatus;
  return {
    ok: true,
    data: {
      order_id: String(data.order_id),
      order_number: num(data.order_number),
      order_status: String(data.order_status ?? ""),
      user_id: String(data.user_id),
      customer_name: String(data.customer_name ?? ""),
      customer_email: String(data.customer_email ?? ""),
      xp_status: XP_STATUSES.includes(status) ? status : "not_eligible",
      xp_awarded: num(data.xp_awarded),
      xp_balance: data.xp_balance === null || data.xp_balance === undefined ? null : num(data.xp_balance),
    },
  };
}

/** Error contract of admin_link_order_to_customer / admin_list_unlinked_orders. */
export function linkErrorMessage(raw: string | null | undefined): string {
  const msg = raw ?? "";
  if (/Insufficient privilege/i.test(msg)) {
    return "No tienes permiso para realizar esta acción.";
  }
  if (/link_order_already_linked/.test(msg)) {
    return "Este pedido ya fue ligado a una cuenta (quizá por otro administrador). Actualiza la lista.";
  }
  if (/link_order_not_found/.test(msg)) {
    return "El pedido ya no existe.";
  }
  if (/link_customer_not_found/.test(msg)) {
    return "La cuenta seleccionada ya no existe.";
  }
  if (/link_customer_not_eligible/.test(msg)) {
    return "Solo puedes ligar pedidos a cuentas de clientes, no a administradores.";
  }
  if (/link_invalid_request/.test(msg)) {
    return "La solicitud no es válida. Actualiza la página e inténtalo de nuevo.";
  }
  // The RPC itself is missing: migration not applied yet.
  if (/admin_(link_order_to_customer|list_unlinked_orders)|Could not find the function/i.test(msg)) {
    return "Falta aplicar la migración 20261110000200 en la base de datos.";
  }
  console.error("[admin/orders/link] unexpected RPC error");
  return "No pudimos completar la operación. Inténtalo de nuevo.";
}

/** The confirmation line about XP, in plain Spanish (no HTML). */
export function describeLinkXp(result: Pick<LinkOrderResult, "xp_status" | "xp_awarded" | "xp_balance">): string {
  const balance =
    result.xp_balance === null ? "" : ` Balance actual: ${formatXp(result.xp_balance)} XP.`;
  switch (result.xp_status) {
    case "granted":
      return result.xp_awarded > 0
        ? `Se otorgaron ${formatXp(result.xp_awarded)} XP.${balance}`
        : `El pedido no suma XP (menos de ${formatPrice(1000)} en productos).${balance}`;
    case "already_granted":
      return "Los XP de este pedido ya se habían otorgado antes; no se sumaron de nuevo.";
    case "pending_status":
      return "Aún no se otorgan XP: el pedido no ha sido recibido. Se sumarán automáticamente a esta cuenta cuando lo marques como Recibido.";
    case "not_eligible":
      return "El pedido está cancelado, así que no suma XP.";
  }
}
