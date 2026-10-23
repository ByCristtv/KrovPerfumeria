import { createClient } from "@/lib/supabase/server";
import { paginate, type Paginated } from "@/lib/pagination";
import { getRankFromXP, type UserRank } from "@/lib/rank";
import type { Database } from "@/types/database";

/** Customers per page in Admin → Clientes (other admin lists use 20). */
export const CUSTOMERS_PAGE_SIZE = 16;

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];

export type AdminCustomerRow = Pick<
  ProfileRow,
  | "id"
  | "full_name"
  | "username"
  | "avatar_url"
  | "phone"
  | "role"
  | "experience_points"
  | "created_at"
> & {
  /** Derived from `experience_points` via lib/rank.ts — never stored. */
  rank: UserRank;
};

export interface CustomersAdminPage extends Paginated<AdminCustomerRow> {
  /** True when the query failed, so the page can show an error instead of "empty". */
  error: boolean;
  /** The requested page is past the last one (PostgREST 416); the page redirects. */
  outOfRange: boolean;
}

/** PostgREST: "Requested range not satisfiable" — offset beyond the exact count. */
const RANGE_NOT_SATISFIABLE = "PGRST103";

export const CUSTOMER_COLUMNS =
  "id, full_name, username, avatar_url, phone, role, experience_points, created_at";

/** Roles listed as customers. Admin accounts are staff, not clientes. */
const CUSTOMER_ROLES: ProfileRow["role"][] = ["customer", "wholesale"];

/**
 * Fetch one page of registered customers for Admin → Clientes.
 *
 * Runs with the request-bound server client, so the "Admins can view all
 * profiles" RLS policy applies (non-admins are redirected by proxy.ts first, and
 * would only ever see their own row anyway). XP lives on the same row and the
 * rank is a pure function of it, so one `.range()` query with an exact count
 * returns everything the table needs — no per-row lookups.
 *
 * Never throws: a failure returns an empty page with `error: true`.
 */
export async function getCustomersAdminPage(
  page: number,
  search?: string,
  pageSize: number = CUSTOMERS_PAGE_SIZE
): Promise<CustomersAdminPage> {
  const supabase = await createClient();
  const offset = (Math.max(1, Math.floor(page) || 1) - 1) * pageSize;

  let query = supabase
    .from("profiles")
    .select(CUSTOMER_COLUMNS, { count: "exact" })
    .in("role", CUSTOMER_ROLES);

  // Same sanitizing as the orders list: ',' '(' ')' separate PostgREST .or()
  // filters and '*' is its wildcard, so strip them before interpolating.
  const safe = search?.trim().replace(/[,()*]/g, "");
  if (safe) {
    query = query.or(`full_name.ilike.*${safe}*,username.ilike.*${safe}*`);
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);

  if (error) {
    const outOfRange = error.code === RANGE_NOT_SATISFIABLE;
    if (!outOfRange) console.error("getCustomersAdminPage failed:", error.message);
    return {
      rows: [],
      total: 0,
      currentPage: 1,
      totalPages: 1,
      pageSize,
      error: !outOfRange,
      outOfRange,
    };
  }

  const total = count ?? 0;
  const { currentPage, totalPages } = paginate(total, page, pageSize);

  return {
    rows: (data ?? []).map((row) => ({
      ...(row as Omit<AdminCustomerRow, "rank">),
      rank: getRankFromXP(row.experience_points),
    })),
    total,
    currentPage,
    totalPages,
    pageSize,
    error: false,
    outOfRange: false,
  };
}
