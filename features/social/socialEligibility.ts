import { supabase } from "@/lib/supabase/client";

/**
 * Whether the signed-in user may use social DISCOVERY.
 *
 * Two independent facts, read from the viewer's own `profiles` row:
 *
 *   - a username, because discovery is username-based: without one you cannot
 *     be searched for, and a request you sent would arrive anonymous.
 *   - `is_profile_public`, because discovery is reciprocal: searching people
 *     who cannot search you back is the asymmetry the privacy switch exists
 *     to prevent.
 *
 * This is only ever a gate on STARTING something new. It has no bearing on
 * friendships and requests that already exist — see `SocialEligibility`.
 *
 * The read is the viewer's own row, which the "Users can view own profile" RLS
 * policy already permits; this is the same access `getAccountData` uses, just
 * narrowed to the two columns that matter.
 */
export interface SocialEligibilityData {
  username: string | null;
  isProfilePublic: boolean;
}

export async function getSocialEligibility(
  userId: string
): Promise<SocialEligibilityData> {
  const { data, error } = await supabase
    .from("profiles")
    .select("username, is_profile_public")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("getSocialEligibility failed:", error.message);
    throw error;
  }

  return {
    // Blank counts as absent: the profile form stores a cleared username as
    // null, but a whitespace-only value must not read as "has a username".
    username: data?.username?.trim() ? data.username : null,
    isProfilePublic: data?.is_profile_public === true,
  };
}
