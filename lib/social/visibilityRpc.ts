import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Typed wrapper for the `set_social_profile_visibility` RPC (migration
 * 20260919000100) — same shape as lib/wholesale/reviewRpc.ts: it takes the
 * client rather than importing one, so the browser client and the cookie-bound
 * server client can both use it. Today only the /profile server action does.
 *
 * It lives in `lib/` rather than `features/` for exactly that reason: everything
 * under `features/social` is hard-wired to the browser client, and this call is
 * made from a Server Action.
 *
 * Why an RPC and not `UPDATE profiles SET is_profile_public = ...`:
 * the function is SECURITY DEFINER, derives the row from `auth.uid()` (so there
 * is no id to tamper with) and enforces the one invariant the column cannot —
 * that a discoverable profile has a username to be discovered BY. Writing the
 * column directly would bypass that check.
 */

/**
 * Publish or unpublish the caller's profile for social discovery.
 *
 * Errors are returned, not thrown, so the caller can map them to copy.
 * The ones the function raises by name:
 *   - `authentication_required`
 *   - `profile_not_found`
 *   - `username_required_for_public_profile` (only when `isPublic` is true)
 */
export async function setSocialProfileVisibility(
  supabase: SupabaseClient<Database>,
  isPublic: boolean
): Promise<{ error: PostgrestError | null }> {
  const { error } = await supabase.rpc("set_social_profile_visibility", {
    p_is_public: isPublic,
  });

  return { error };
}
