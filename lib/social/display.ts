/**
 * How the social UI names somebody who may not have a username.
 *
 * `profiles.username` is NULLABLE, and only `search_public_users` filters the
 * nulls out (`AND p.username IS NOT NULL`). `get_friends`,
 * `get_received_friend_requests`, `get_sent_friend_requests` and
 * `get_friend_profile` all join `profiles` WITHOUT that filter, so an existing
 * friend or requester who never chose a username arrives here as null — while
 * the generated Supabase types widen the column to `string`, which is what let
 * `username.charAt(0)` reach production and crash.
 *
 * These relationships are historical and legitimate: they were formed before
 * the account cleared its username, or by a flow that never required one. They
 * are not data to delete, so the UI has to render them.
 *
 * Two rules, applied everywhere a person is shown:
 *   - a NAME for text (see {@link socialDisplayName})
 *   - an INITIAL for the avatar monogram (see {@link socialInitial})
 */

/** Shown when someone has neither a username nor a full name. */
export const SOCIAL_ANONYMOUS_NAME = "Usuario sin nombre";

/** Trimmed value, or null for null/blank/whitespace-only input. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The name to print for a person.
 *
 * Username first — it is the identifier the social feature is built around and
 * the one the other party recognises. Full name is the fallback rather than the
 * preference: it is shown only where the RPC already returns it (friends and
 * friend profiles), so this never invents a field the projection withheld.
 */
export function socialDisplayName(
  username: string | null | undefined,
  fullName?: string | null
): string {
  return clean(username) ?? clean(fullName) ?? SOCIAL_ANONYMOUS_NAME;
}

/**
 * The single character an avatar monogram shows.
 *
 * Username initial, then full-name initial, then "?" — never an exception, and
 * never an empty circle. Uses `[...str][0]` rather than `charAt(0)` so an
 * emoji or any other astral-plane character yields one whole glyph instead of
 * half a surrogate pair.
 */
export function socialInitial(
  username: string | null | undefined,
  fullName?: string | null
): string {
  const source = clean(username) ?? clean(fullName);
  if (!source) return "?";
  return ([...source][0] ?? "?").toUpperCase();
}
