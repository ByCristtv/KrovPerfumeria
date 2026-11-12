"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { CustomerLookupOutcome } from "@/lib/orders/adminCustomerLookup";
import {
  linkOrderToCustomer,
  searchLinkableCustomers,
} from "@/lib/orders/orderLinking";
import type { LinkableCustomer, LinkOrderResult } from "@/types/orderLinking";

/**
 * Server actions behind Admin → Ligar Pedidos.
 *
 * Defense in depth, same layering as the other admin actions:
 *   1. proxy.ts keeps non-admins off /admin/* before anything renders.
 *   2. The link action re-checks the caller's role: a server action is a public
 *      POST endpoint and can be called without ever loading the page.
 *   3. Both RPCs run is_admin() themselves against the request-scoped client.
 *      That is the real gate — nothing here writes to a table directly.
 */

export async function searchLinkableCustomersAction(
  query: string
): Promise<CustomerLookupOutcome<LinkableCustomer[]>> {
  if (typeof query !== "string") return { ok: true, data: [] };
  return searchLinkableCustomers(await createClient(), query);
}

/** `stale` = the order can no longer be linked from this screen; reload it. */
export type LinkOrderActionResult =
  | { ok: true; message: string; data: LinkOrderResult }
  | { ok: false; message: string; stale?: boolean };

export async function linkOrderToCustomerAction(
  orderId: string,
  userId: string
): Promise<LinkOrderActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Tu sesión expiró. Vuelve a iniciar sesión." };
  }
  const { data: caller } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (caller?.role !== "admin") {
    return { ok: false, message: "No tienes permiso para realizar esta acción." };
  }

  const outcome = await linkOrderToCustomer(supabase, orderId, userId);
  if (!outcome.ok) return { ok: false, message: outcome.message, stale: outcome.stale };

  const { data } = outcome;
  revalidatePath("/admin/orders/link");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${data.order_id}`);
  revalidatePath(`/admin/clientes/${data.user_id}`);

  return {
    ok: true,
    message: `Pedido #${data.order_number} ligado a ${data.customer_name}.`,
    data,
  };
}
