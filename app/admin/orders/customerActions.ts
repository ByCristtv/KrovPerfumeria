"use server";

import { createClient } from "@/lib/supabase/server";
import {
  findCustomerByEmail,
  searchCustomers,
  type CustomerLookupOutcome,
} from "@/lib/orders/adminCustomerLookup";
import type { AdminCustomerMatch } from "@/types/adminOrder";

/**
 * Server actions behind the manual-order form's customer picker and the
 * "this email is registered" hint.
 *
 * They exist because registered emails live in auth.users, which the browser
 * client cannot read. Both call admin-guarded RPCs with the REQUEST-SCOPED
 * client, so authorization is the database's is_admin() check — this module adds
 * no permission logic of its own and must never be handed the service-role
 * client.
 *
 * Like every server action these are public POST endpoints; the RPC guard is
 * what makes that safe.
 */

export async function searchCustomersAction(
  query: string
): Promise<CustomerLookupOutcome<AdminCustomerMatch[]>> {
  if (typeof query !== "string") return { ok: true, data: [] };
  return searchCustomers(await createClient(), query);
}

export async function findCustomerByEmailAction(
  email: string
): Promise<CustomerLookupOutcome<AdminCustomerMatch | null>> {
  if (typeof email !== "string") return { ok: true, data: null };
  return findCustomerByEmail(await createClient(), email);
}
