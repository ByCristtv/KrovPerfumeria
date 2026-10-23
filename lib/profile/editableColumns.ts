import type { Tables } from "@/types/database";

/**
 * The ONLY `profiles` columns a signed-in customer may write directly through
 * the Supabase API (browser client or the user-bound server client).
 *
 * Mirrors migration 20261023000100_profiles_privilege_hardening.sql — the
 * `GRANT UPDATE (...)` allowlist and `v_allowed` in its guard trigger. The
 * database is the enforcement point; this list exists so app code fails to
 * COMPILE (via {@link ProfileSelfUpdate}) instead of failing at runtime with
 * "permission denied for table profiles". `editableColumns.test.ts` keeps the
 * three lists in lock-step.
 *
 * Everything else is privileged and has a dedicated SECURITY DEFINER path:
 *   role               review_wholesale_application()   (admin)
 *   experience_points  grant_order_xp() trigger / admin_adjust_customer_xp() (admin)
 *   is_profile_public  set_social_profile_visibility()  (owner, username rule)
 *   id, created_at, updated_at, full_name — not client-writable at all
 */
export const PROFILE_SELF_EDITABLE_COLUMNS = [
  "phone",
  "avatar_url",
  "username",
  "show_in_ranking",
] as const;

export type ProfileSelfEditableColumn = (typeof PROFILE_SELF_EDITABLE_COLUMNS)[number];

/** Shape of a customer's own-profile `.update({...})` payload. */
export type ProfileSelfUpdate = Partial<Pick<Tables<"profiles">, ProfileSelfEditableColumn>>;
