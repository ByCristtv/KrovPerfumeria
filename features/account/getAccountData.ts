import { supabase } from "@/lib/supabase/client";
import type { Tables } from "@/types/database";

export type ProfileRow = Tables<"profiles">;
export type AddressRow = Tables<"addresses">;
export type AccountOrderItem = Pick<
  Tables<"order_items">,
  "id" | "product_name" | "brand_name" | "size_ml" | "quantity"
>;

export type AccountOrderRow = Pick<
  Tables<"orders">,
  | "id"
  | "order_number"
  | "total"
  | "order_status"
  | "payment_status"
  | "created_at"
> & {
  /** Line snapshots taken at checkout, so a later product edit can't rewrite history. */
  order_items: AccountOrderItem[];
};

export type WholesaleProfileRow = Tables<"wholesale_profiles">;

export interface AccountData {
  profile: ProfileRow | null;
  address: AddressRow | null;
  /** The user's wholesale application, or null if they never applied. */
  wholesale: WholesaleProfileRow | null;
}

export async function getAccountData(userId: string): Promise<AccountData> {
  const [profileRes, addressRes, wholesaleRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase
      .from("addresses")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("wholesale_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return {
    profile: profileRes.data,
    address: addressRes.data,
    wholesale: wholesaleRes.data,
  };
}

/**
 * The signed-in customer's orders, newest first, each with its line items.
 *
 * One round trip: the items are embedded through the `order_items_order_id_fkey`
 * relationship, and RLS ("Users can view own order items") scopes them to
 * orders this user owns. The `user_id` filter is still stated explicitly so an
 * admin, whom RLS lets read every order, sees only their own history here too.
 */
export async function getAccountOrders(
  userId: string
): Promise<AccountOrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, total, order_status, payment_status, created_at, order_items ( id, product_name, brand_name, size_ml, quantity )"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function updatePhone(userId: string, phone: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ phone })
    .eq("id", userId);
  if (error) throw error;
}

export async function upsertAddress(
  userId: string,
  address: {
    province: string;
    canton: string;
    district: string;
    exact_address: string;
    references?: string | null;
  },
  existingId?: string
) {
  if (existingId) {
    const { error } = await supabase
      .from("addresses")
      .update(address)
      .eq("id", existingId)
      .eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("addresses")
      .insert({ ...address, user_id: userId });
    if (error) throw error;
  }
}