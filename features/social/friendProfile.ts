import { supabase } from "@/lib/supabase/client";
import type { FriendProfile, PurchasedFragrance } from "@/types/social";

/**
 * A friend's protected social profile, and the fragrances they have bought.
 *
 * Both RPCs are `SECURITY DEFINER` and both open with the same two guards:
 * `auth.uid()` must exist, and `social_are_friends(auth.uid(), target)` must be
 * true — otherwise they raise `users_are_not_friends` and return nothing. The
 * caller's identity is never sent from the browser; only the TARGET id is, and
 * naming a target you are not friends with simply fails.
 *
 * That is the whole authorization story, and it lives in PostgreSQL. This
 * module adds no check of its own, because a check here would be a second,
 * weaker copy of one that already holds — and would invite the belief that
 * hiding the route is what protects the data.
 *
 * `get_friend_purchased_products` is deliberately NOT an order read. It returns
 * a fixed five-column projection of PRODUCTS, already de-duplicated per
 * fragrance, from orders that reached completion. A friendship grants no SELECT
 * on `orders` — that RLS policy is still owner-plus-admin only.
 */

/** Blank strings (the signup trigger writes `''`) normalize to null. */
function blankToNull(value: string | null): string | null {
  return value?.trim() ? value : null;
}

/**
 * Read a friend's profile.
 *
 * The RPC returns a SET, so a friend resolves to exactly one row and anything
 * else resolves to zero. `null` therefore means "no profile you may see" —
 * which is the same answer for a stranger, a non-friend and a deleted account,
 * and that sameness is the point: the caller cannot tell them apart.
 *
 * Throws on a real failure so React Query can surface `isError`; the raw
 * Postgres message is logged here and translated by lib/social/errors.ts at the
 * UI boundary rather than being rendered.
 */
export async function getFriendProfile(
  friendUserId: string
): Promise<FriendProfile | null> {
  const { data, error } = await supabase.rpc("get_friend_profile", {
    p_friend_user_id: friendUserId,
  });

  if (error) {
    console.error("getFriendProfile failed:", error.message);
    throw error;
  }

  const row = data?.[0];
  if (!row) return null;

  return {
    userId: row.user_id,
    username: row.username,
    fullName: blankToNull(row.full_name),
    avatarUrl: blankToNull(row.avatar_url),
    experiencePoints: row.experience_points ?? 0,
  };
}

/**
 * The unique fragrances a friend has bought through KROV.
 *
 * One query for the whole section: the product, its brand and its image all
 * arrive on each row (the image via a LATERAL inside the RPC), so rendering N
 * fragrances costs one request rather than N image or brand lookups.
 *
 * Nothing is de-duplicated or filtered here. Which purchases count is a
 * business rule that lives in SQL — orders that reached `received` or `shipped`
 * (see migration 20260920000100) — and collapsing variants into one fragrance
 * is done by that function's SELECT DISTINCT. Repeating either client-side
 * would let the two drift apart silently.
 */
export async function getFriendPurchasedProducts(
  friendUserId: string
): Promise<PurchasedFragrance[]> {
  const { data, error } = await supabase.rpc(
    "get_friend_purchased_products",
    { p_friend_user_id: friendUserId }
  );

  if (error) {
    console.error("getFriendPurchasedProducts failed:", error.message);
    throw error;
  }

  return (data ?? []).map((row) => ({
    productId: row.product_id,
    name: row.product_name,
    slug: row.product_slug,
    brandName: row.brand_name,
    // A product with no image row comes back null from the LEFT JOIN LATERAL;
    // the card renders the shared placeholder rather than an empty <img src>.
    imageUrl: blankToNull(row.image_url),
  }));
}
