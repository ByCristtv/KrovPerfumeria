import { supabase } from "@/lib/supabase/client";
import type { Friend } from "@/types/social";

/**
 * The signed-in user's friendships.
 *
 * Same contract as features/social/friendRequests.ts: read and write only
 * through the `SECURITY DEFINER` RPCs, because `friendships` is REVOKEd from
 * `authenticated` for every write and its RLS SELECT policy only admits rows
 * the caller participates in.
 */

/**
 * Everyone the signed-in user is friends with.
 *
 * One query, already joined to `profiles` inside `get_friends` — there is no
 * per-friend profile lookup. The RPC resolves the canonical pair
 * (`user_id_1 < user_id_2`) into "the other person", so a friendship appears
 * exactly once, from the caller's side.
 */
export async function getFriends(): Promise<Friend[]> {
  const { data, error } = await supabase.rpc("get_friends");

  if (error) {
    console.error("getFriends failed:", error.message);
    throw error;
  }

  return (data ?? []).map((row) => ({
    friendshipId: row.friendship_id,
    userId: row.friend_user_id,
    username: row.username,
    fullName: row.full_name?.trim() ? row.full_name : null,
    avatarUrl: row.avatar_url?.trim() ? row.avatar_url : null,
    experiencePoints: row.experience_points ?? 0,
    friendsSince: row.friends_since,
  }));
}

/**
 * End a friendship. Takes the FRIEND's user id, not the friendship id —
 * `remove_friend` rebuilds the canonical pair from `auth.uid()` and this id,
 * so a caller cannot name a friendship they are not part of.
 *
 * Deletes exactly one row from `friendships`. Profiles, orders and the
 * historical `accepted` request row are all untouched, and nothing blocks a
 * future request — the two can become friends again.
 *
 * Returns false when there was no friendship to remove, which is the benign
 * "somebody already removed it" case rather than an error.
 */
export async function removeFriend(friendUserId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("remove_friend", {
    p_friend_user_id: friendUserId,
  });

  if (error) {
    console.error("removeFriend failed:", error.message);
    throw error;
  }

  return data === true;
}
