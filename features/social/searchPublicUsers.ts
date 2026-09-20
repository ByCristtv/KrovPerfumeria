import { supabase } from "@/lib/supabase/client";
import {
  isSearchableQuery,
  normalizeSearchQuery,
  toRelationshipStatus,
  SOCIAL_SEARCH_LIMIT,
  type SocialSearchUser,
} from "@/types/social";

/**
 * Browser-side read for user discovery.
 *
 * Every privacy decision lives in `search_public_users` (migration
 * 20260919000100), not here. The function is SECURITY DEFINER and, in one
 * statement, drops private profiles, drops the caller's own row, drops profiles
 * with no username, and computes the relationship — so this module never reads
 * `profiles` directly and never filters a returned row. A row that arrives is a
 * row the database decided the caller may see.
 *
 * That also settles the N+1 question: the relationship comes back ON each row,
 * so rendering a page of results costs exactly one request no matter how many
 * results it holds.
 */

export interface SearchPublicUsersOptions {
  /** Page size. The RPC clamps to 1..50 regardless of what is passed. */
  limit?: number;
  offset?: number;
}

/**
 * Find public accounts whose username matches `query`.
 *
 * Throws on a failed RPC so React Query can surface `isError` — the caller
 * renders a generic state and the Postgres message stays in the log rather than
 * reaching a user. Returns `[]` without a round-trip for a query the backend
 * would refuse anyway; the hook's `enabled` gate normally gets there first, but
 * this makes the guarantee a property of the function instead of the caller.
 */
export async function searchPublicUsers(
  query: string,
  options: SearchPublicUsersOptions = {}
): Promise<SocialSearchUser[]> {
  if (!isSearchableQuery(query)) return [];

  const { data, error } = await supabase.rpc("search_public_users", {
    p_query: normalizeSearchQuery(query),
    p_limit: options.limit ?? SOCIAL_SEARCH_LIMIT,
    p_offset: options.offset ?? 0,
  });

  if (error) {
    console.error("searchPublicUsers failed:", error.message);
    throw error;
  }

  return (data ?? []).map(toSocialSearchUser);
}

/**
 * RPC row → domain object.
 *
 * `avatar_url` is normalized to null when blank: the signup trigger writes an
 * empty string for accounts created without an OAuth picture
 * (`COALESCE(raw_user_meta_data ->> 'avatar_url', '')` in schema.sql), and an
 * empty `src` is an invalid image request rather than "no image".
 */
function toSocialSearchUser(row: {
  user_id: string;
  username: string;
  avatar_url: string | null;
  relationship_status: string;
}): SocialSearchUser {
  return {
    userId: row.user_id,
    username: row.username,
    avatarUrl: row.avatar_url?.trim() ? row.avatar_url : null,
    relationshipStatus: toRelationshipStatus(row.relationship_status),
  };
}
