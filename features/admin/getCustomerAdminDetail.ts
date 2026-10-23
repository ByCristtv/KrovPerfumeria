import { createClient } from "@/lib/supabase/server";
import { getProfileXpData, type ProfileXpData } from "@/lib/rank";
import type { AdminOrderRow } from "@/features/admin/getOrdersAdminPage";
import type { Database } from "@/types/database";

type Tables = Database["public"]["Tables"];

/** Most recent orders shown on the customer page; the total is still counted. */
export const CUSTOMER_ORDERS_LIMIT = 50;

/** Most recent manual XP adjustments shown on the customer page. */
export const CUSTOMER_ADJUSTMENTS_LIMIT = 10;

export type AdminCustomerProfile = Pick<
  Tables["profiles"]["Row"],
  | "id"
  | "full_name"
  | "username"
  | "avatar_url"
  | "phone"
  | "role"
  | "experience_points"
  | "created_at"
  | "is_profile_public"
  | "show_in_ranking"
>;

export type CustomerOrderItem = Pick<
  Tables["order_items"]["Row"],
  "id" | "product_name" | "brand_name" | "size_ml" | "quantity" | "unit_price" | "line_total"
>;

/** An order in the customer's history: the admin list row plus its lines. */
export interface CustomerOrder extends AdminOrderRow {
  subtotal: number;
  discount: number;
  shipping_cost: number;
  items: CustomerOrderItem[];
  /** XP this order granted (null while it hasn't reached `received`). */
  xp_earned: number | null;
}

export type CustomerXpAdjustment = Pick<
  Tables["profile_xp_adjustments"]["Row"],
  "id" | "delta" | "balance_before" | "balance_after" | "reason" | "created_at"
>;

export interface CustomerAdminDetail {
  profile: AdminCustomerProfile;
  xp: ProfileXpData;
  orders: CustomerOrder[];
  /** All of the customer's orders, which may exceed `orders.length`. */
  ordersTotal: number;
  /** False when the order query failed — the page says so instead of "no orders". */
  ordersLoaded: boolean;
  /** `null` when the ledger can't be read (e.g. migration not applied yet). */
  adjustments: CustomerXpAdjustment[] | null;
}

const PROFILE_COLUMNS =
  "id, full_name, username, avatar_url, phone, role, experience_points, created_at, is_profile_public, show_in_ranking";

// One query for the whole history: order_items and the one-to-one XP event are
// embedded, so there is no per-order follow-up.
const ORDER_COLUMNS = `
  id, order_number, customer_name, customer_email, customer_phone,
  subtotal, discount, shipping_cost, total,
  order_status, payment_status, source, created_at,
  order_items ( id, product_name, brand_name, size_ml, quantity, unit_price, line_total ),
  profile_experience_events ( xp_earned )
`;

interface RawOrder extends Omit<CustomerOrder, "items" | "xp_earned"> {
  order_items: CustomerOrderItem[] | null;
  // One-to-one embed: PostgREST returns an object (or null), but tolerate an array.
  profile_experience_events: { xp_earned: number } | { xp_earned: number }[] | null;
}

export function mapCustomerOrder(raw: RawOrder): CustomerOrder {
  const { order_items, profile_experience_events, ...order } = raw;
  const event = Array.isArray(profile_experience_events)
    ? profile_experience_events[0]
    : profile_experience_events;
  return {
    ...order,
    items: order_items ?? [],
    xp_earned: event?.xp_earned ?? null,
  };
}

/**
 * Everything Admin → Clientes → [id] renders, in three parallel queries
 * (profile, orders + lines, XP adjustments).
 *
 * Request-bound server client: RLS ("Admins can view all profiles / orders",
 * "Admins can view XP adjustments") does the authorization. Returns `null` when
 * the profile does not exist; throws only if the profile itself can't be read.
 */
export async function getCustomerAdminDetail(
  userId: string
): Promise<CustomerAdminDetail | null> {
  const supabase = await createClient();

  const [profileRes, ordersRes, adjustmentsRes] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
    supabase
      .from("orders")
      .select(ORDER_COLUMNS, { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(CUSTOMER_ORDERS_LIMIT),
    supabase
      .from("profile_xp_adjustments")
      .select("id, delta, balance_before, balance_after, reason, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(CUSTOMER_ADJUSTMENTS_LIMIT),
  ]);

  if (profileRes.error) {
    console.error("getCustomerAdminDetail: profile failed", profileRes.error.message);
    throw new Error("No pudimos cargar el cliente.");
  }
  if (!profileRes.data) return null;

  if (ordersRes.error) {
    console.error("getCustomerAdminDetail: orders failed", ordersRes.error.message);
  }
  if (adjustmentsRes.error) {
    // Expected until migration 20261022000100 is applied.
    console.warn("getCustomerAdminDetail: adjustments unavailable", adjustmentsRes.error.message);
  }

  const profile = profileRes.data as AdminCustomerProfile;
  const orders = ordersRes.error
    ? []
    : ((ordersRes.data ?? []) as unknown as RawOrder[]).map(mapCustomerOrder);

  return {
    profile,
    xp: getProfileXpData(profile.experience_points),
    orders,
    ordersTotal: ordersRes.error ? 0 : (ordersRes.count ?? orders.length),
    ordersLoaded: !ordersRes.error,
    adjustments: adjustmentsRes.error
      ? null
      : ((adjustmentsRes.data ?? []) as CustomerXpAdjustment[]),
  };
}
