import { supabase } from "@/lib/supabase/client";
import { mapUserCoupon, type UserCouponRow } from "@/lib/coupons/mapUserCoupon";
import type { UserCoupon } from "@/lib/coupons/types";

/** React Query key for the signed-in customer's coupons. */
export const userCouponsKey = (userId: string | undefined) =>
  ["coupons", "mine", userId] as const;

/**
 * The signed-in customer's coupons, with their terms embedded.
 *
 * Read straight through the browser client: RLS on `user_coupons` ("Users can
 * view their own coupons") scopes the rows to the caller, so the explicit
 * `user_id` filter is only there so an admin — whom RLS lets read everyone's —
 * sees just their own here. All WRITES go through SECURITY DEFINER RPCs; this
 * module never mutates.
 */
export async function getUserCoupons(userId: string): Promise<UserCoupon[]> {
  const { data, error } = await supabase
    .from("user_coupons")
    .select("*, coupons(*)")
    .eq("user_id", userId)
    .order("unlocked_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as UserCouponRow[])
    .map(mapUserCoupon)
    .filter((c): c is UserCoupon => c !== null);
}
