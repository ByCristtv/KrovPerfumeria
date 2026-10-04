import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type AvatarUploadSlot =
  | { ok: true }
  | { ok: false; reason: "limited"; retryAfterSeconds: number }
  | { ok: false; reason: "error" };

/**
 * Claim one avatar-upload slot for the signed-in user via the
 * `claim_avatar_upload_slot` RPC (migration 20261003000200).
 *
 * The limit itself (5 uploads / 10 minutes) is fixed INSIDE the function, not
 * passed in: the caller is the user's own session, so any parameter would be a
 * parameter the user could raise. The function is also atomic — it serialises
 * per user, so ten parallel requests cannot all read "4 so far" and slip
 * through.
 *
 * Takes the client rather than importing one (same shape as
 * lib/social/visibilityRpc.ts) so it can be exercised with a fake.
 */
export async function claimAvatarUploadSlot(
  supabase: SupabaseClient<Database>
): Promise<AvatarUploadSlot> {
  const { data, error } = await supabase.rpc("claim_avatar_upload_slot");
  const row = data?.[0];

  if (error || !row) {
    console.error("[avatar] rate-limit check failed", error);
    return { ok: false, reason: "error" };
  }

  return row.allowed
    ? { ok: true }
    : { ok: false, reason: "limited", retryAfterSeconds: Math.max(1, row.retry_after_seconds) };
}
