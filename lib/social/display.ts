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

/**
 * The headline of a friend card: full name when there is one, otherwise the
 * username, otherwise the anonymous label.
 *
 * This is the reverse preference of {@link socialDisplayName}, on purpose. That
 * one serves lists that carry a username and nothing richer; a friend card has
 * both and is built as "Aurora Vega" over "@aurora", the way a person is
 * introduced: name first, handle second.
 */
export function socialHeadline(
  username: string | null | undefined,
  fullName?: string | null
): string {
  return clean(fullName) ?? clean(username) ?? SOCIAL_ANONYMOUS_NAME;
}

/** `@username`, or null when there is none to show. */
export function socialHandle(username: string | null | undefined): string | null {
  const name = clean(username);
  return name ? `@${name}` : null;
}

/**
 * Lower-cased and accent-stripped, for instant client-side filtering: typing
 * "andres" must find "Andrés". Spanish names make this a requirement here, not
 * a nicety.
 */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * How long ago a request arrived, coarse and in Spanish: "hoy", "ayer",
 * "hace 3 días", then "hace 2 semanas" / "hace 3 meses". Social urgency comes
 * from "this has been waiting", not from the minute it landed.
 */
export function formatRequestAge(iso: string, now: Date = new Date()): string | null {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `hace ${weeks} ${weeks === 1 ? "semana" : "semanas"}`;
  }
  const months = Math.floor(days / 30);
  return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
}

/**
 * "sept. 2026" from an ISO timestamp, in the storefront's locale. Month and
 * year only: the exact day a friendship began is not something the card needs
 * to say, and a coarse date ages better than a precise one.
 */
export function formatFriendsSince(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("es-CR", { month: "short", year: "numeric" });
}
