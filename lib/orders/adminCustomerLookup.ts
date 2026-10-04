import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { AdminCustomerMatch } from "@/types/adminOrder";
import { normalizeOptionalEmail } from "@/schemas/adminOrder";

/**
 * Registered-customer lookups for the admin manual-order form.
 *
 * Two questions, deliberately separate:
 *   - search:  "who is this?" — fuzzy, by name / email / phone, for the picker.
 *   - by email: "does THIS address belong to someone?" — exact, for the hint
 *     under the email field. A fuzzy match here would be wrong: typing
 *     "ana@x.com" must never offer "banana@x.com" as the same person.
 *
 * Authorization stays in the RPCs (is_admin() raises for anyone else), so the
 * client passed in must be the request-scoped one carrying the admin's session —
 * never the service-role client, which would bypass that guard.
 */

/** Mirrors the RPC's own floor; shorter terms return nothing server-side. */
export const CUSTOMER_SEARCH_MIN_LENGTH = 2;
const CUSTOMER_SEARCH_LIMIT = 8;
const MAX_QUERY_LENGTH = 100;

export type CustomerLookupOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

type CustomerRow =
  Database["public"]["Functions"]["admin_search_customers"]["Returns"][number];

/**
 * Row → form-friendly shape. Every nullable column is treated as nullable even
 * where the generated types say otherwise, because they are generated from the
 * function signature and cannot express "this LEFT JOIN may have matched
 * nothing".
 */
export function toCustomerMatch(row: CustomerRow): AdminCustomerMatch {
  const hasAddress = Boolean(row.address_canton && row.address_province);
  return {
    user_id: row.user_id,
    full_name: row.full_name ?? null,
    email: row.email,
    phone: row.phone ?? null,
    address: hasAddress
      ? {
          province: row.address_province,
          canton: row.address_canton,
          district: row.address_district ?? "",
          exact_address: row.address_exact ?? "",
          reference: row.address_reference ?? null,
        }
      : null,
  };
}

export async function searchCustomers(
  supabase: SupabaseClient<Database>,
  rawQuery: string
): Promise<CustomerLookupOutcome<AdminCustomerMatch[]>> {
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  if (query.length < CUSTOMER_SEARCH_MIN_LENGTH) {
    return { ok: true, data: [] };
  }

  const { data, error } = await supabase.rpc("admin_search_customers", {
    p_query: query,
    p_limit: CUSTOMER_SEARCH_LIMIT,
  });

  if (error) return { ok: false, message: lookupErrorMessage(error.message) };
  return { ok: true, data: (data ?? []).map(toCustomerMatch) };
}

/** `data: null` = no registered account owns this email (a normal answer). */
export async function findCustomerByEmail(
  supabase: SupabaseClient<Database>,
  rawEmail: string
): Promise<CustomerLookupOutcome<AdminCustomerMatch | null>> {
  const email = normalizeOptionalEmail(rawEmail);
  // Not worth a round trip until it plausibly is an address.
  if (!email || !EMAIL_SHAPE.test(email) || email.length > 254) {
    return { ok: true, data: null };
  }

  const { data, error } = await supabase.rpc("admin_find_customer_by_email", {
    p_email: email,
  });

  if (error) return { ok: false, message: lookupErrorMessage(error.message) };
  const row = data?.[0];
  return { ok: true, data: row ? toCustomerMatch(row) : null };
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function lookupErrorMessage(raw: string): string {
  if (/Insufficient privilege/i.test(raw)) {
    return "No tienes permiso para buscar clientes.";
  }
  // Anything else is ours to investigate, not the admin's to read. Log context
  // only — never the search term, which may be a customer's email or phone.
  console.error("[admin/orders] customer lookup failed");
  return "No pudimos buscar clientes. Inténtalo de nuevo.";
}
