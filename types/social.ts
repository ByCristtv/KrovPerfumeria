/**
 * The social (friends) domain, as the frontend models it.
 *
 * Scope note: MVP 1 covered discoverability; MVP 2 adds the full friendship
 * lifecycle — requests sent, received, accepted, rejected and cancelled, plus
 * the friends list. The friend PROFILE and the fragrances a friend has bought
 * are MVP 3, and are modelled at the foot of this file.
 *
 * Everything in this file mirrors migration 20260919000100_social_friends.sql.
 * When a rule below has a counterpart in that migration it is named, because
 * the database is the boundary that actually holds — these constants only keep
 * the UI from making calls the function would refuse anyway.
 */

/**
 * How the signed-in user stands with another account.
 *
 * Returned by `search_public_users` as plain `text` (the generated type widens
 * it to `string`), so every boundary that reads it narrows through
 * {@link toRelationshipStatus} rather than casting.
 *
 * Read directionally, from the CALLER's point of view:
 *   - `outgoing_pending` — I sent them a request that is still pending.
 *   - `incoming_pending` — they sent me one.
 */
export type RelationshipStatus =
  | "none"
  | "outgoing_pending"
  | "incoming_pending"
  | "friends";

export const RELATIONSHIP_STATUSES: readonly RelationshipStatus[] = [
  "none",
  "outgoing_pending",
  "incoming_pending",
  "friends",
] as const;

/**
 * Narrow a raw `relationship_status` string to the union.
 *
 * Falls back to `"none"` rather than throwing or returning null: an unknown
 * status is a database/frontend version skew, and the safe reading of skew is
 * "no established relationship" — it shows the most conservative affordance and
 * never claims a friendship that may not exist.
 */
export function toRelationshipStatus(
  value: string | null | undefined
): RelationshipStatus {
  return RELATIONSHIP_STATUSES.includes(value as RelationshipStatus)
    ? (value as RelationshipStatus)
    : "none";
}

/**
 * One row of the public user search.
 *
 * This is the COMPLETE set of facts discovery exposes about a stranger. There
 * is deliberately no full name, phone, email, address, order history or XP:
 * `search_public_users` does not select them, and nothing here can widen that
 * projection. A `userId` is present (unlike RankingEntry) because MVP 2 needs a
 * target for `send_friend_request` — it is an opaque id, not a profile read.
 */
export interface SocialSearchUser {
  userId: string;
  /**
   * Never null, and the ONLY social projection for which that holds:
   * `search_public_users` filters `AND p.username IS NOT NULL`. Every other
   * social RPC can return one, so their types say `string | null`.
   */
  username: string;
  /** `null` when the account has no avatar — including the empty string the
   *  signup trigger writes for email/password accounts. */
  avatarUrl: string | null;
  relationshipStatus: RelationshipStatus;
}

/**
 * Shortest query the backend will act on.
 *
 * Mirrors `IF char_length(v_query) < 2 THEN RETURN` in `search_public_users`.
 * Below this the function returns an empty set, so asking is pure waste — the
 * search hook keeps its query disabled instead of firing one.
 */
export const SOCIAL_SEARCH_MIN_LENGTH = 2;

/** Default page size. The RPC clamps `p_limit` to 1..50; this stays inside it. */
export const SOCIAL_SEARCH_LIMIT = 20;

/**
 * The exact string the backend will match on.
 *
 * `search_public_users` runs `trim(COALESCE(p_query, ''))` and compares
 * lowercased, so trimming here makes the client's "is this long enough?" test
 * agree with the server's, and makes "  aurora  " and "aurora" the same cache
 * key instead of two identical round-trips.
 */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim();
}

/** Whether a raw input is worth sending to {@link normalizeSearchQuery}'s RPC. */
export function isSearchableQuery(raw: string): boolean {
  return normalizeSearchQuery(raw).length >= SOCIAL_SEARCH_MIN_LENGTH;
}

// ─────────────────────────────────────────────────────────────────────────────
// MVP 2 — the friendship lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A pending friend request somebody sent to the signed-in user.
 *
 * Mirrors `get_received_friend_requests`. The `requestId` is what every
 * lifecycle RPC acts on — `userId` is carried for display and for matching a
 * request back to a search result, never as a mutation target.
 *
 * `experiencePoints` is present because the RPC returns it and the rank it
 * implies is public information (the leaderboard already shows it). Rank is
 * DERIVED at render time via lib/rank.ts, never stored here — there is exactly
 * one XP-to-rank ladder in this codebase.
 */
export interface ReceivedFriendRequest {
  requestId: string;
  userId: string;
  /**
   * NULLABLE. This RPC joins `profiles` without a `username IS NOT NULL`
   * filter (unlike `search_public_users`), so a relationship formed before the
   * account cleared its username arrives with none. Render it through
   * `socialDisplayName`.
   */
  username: string | null;
  avatarUrl: string | null;
  experiencePoints: number;
  requestedAt: string;
}

/**
 * A pending request the signed-in user sent to somebody else.
 *
 * Mirrors `get_sent_friend_requests`, which notably does NOT return XP — the
 * recipient of your request has not agreed to show you anything yet.
 *
 * This list is what makes "Cancelar" possible from a search result without an
 * N+1 query: see {@link indexSentRequestsByUser}.
 */
export interface SentFriendRequest {
  requestId: string;
  userId: string;
  /**
   * NULLABLE. This RPC joins `profiles` without a `username IS NOT NULL`
   * filter (unlike `search_public_users`), so a relationship formed before the
   * account cleared its username arrives with none. Render it through
   * `socialDisplayName`.
   */
  username: string | null;
  avatarUrl: string | null;
  requestedAt: string;
}

/**
 * One established friendship, seen from the signed-in user's side.
 *
 * Symmetric by construction: the database stores ONE canonical row per pair
 * (`user_id_1 < user_id_2`) and `get_friends` resolves whichever side is not
 * the caller into `friend_user_id`. There is no "follower"/"following" here and
 * no second row to keep in sync.
 *
 * `fullName` is included because a friend has agreed to be a friend, and the
 * RPC returns it. It is the ONLY place in the social module that shows more
 * than username + avatar, and it still exposes no phone, email, address or
 * order data.
 */
export interface Friend {
  friendshipId: string;
  userId: string;
  /**
   * NULLABLE. This RPC joins `profiles` without a `username IS NOT NULL`
   * filter (unlike `search_public_users`), so a relationship formed before the
   * account cleared its username arrives with none. Render it through
   * `socialDisplayName`.
   */
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  experiencePoints: number;
  friendsSince: string;
}

/**
 * Pending sent requests, keyed by the user they were sent TO.
 *
 * `search_public_users` reports that a request is `outgoing_pending` but does
 * not return its id, and `cancel_friend_request` needs that id. Rather than
 * widening the search RPC (a migration) or asking per result (an N+1), the
 * search panel loads `get_sent_friend_requests` ONCE and looks each result up
 * in this map — one extra request for the whole list, at any result count.
 */
export function indexSentRequestsByUser(
  requests: readonly SentFriendRequest[]
): ReadonlyMap<string, string> {
  return new Map(requests.map((request) => [request.userId, request.requestId]));
}

// ---------------------------------------------------------------------------
// MVP 3 - the friend profile
// ---------------------------------------------------------------------------

/**
 * A friend's social profile.
 *
 * Mirrors `get_friend_profile`, which returns rows ONLY when the caller and the
 * target are currently friends. That check lives in the function, not here - so
 * this type describes data the database already decided the viewer may see.
 *
 * Wider than {@link SocialSearchUser} by exactly two fields (`fullName`,
 * `experiencePoints`) and not one more. Public discovery and friend access are
 * two different permission levels, and this is the whole difference between
 * them: still no phone, email, address, orders or payment data.
 *
 * `rank` is absent on purpose. It is DERIVED from `experiencePoints` at render
 * time through lib/rank.ts, the same ladder the leaderboard and /profile use.
 * Storing it here would be a second source of truth for a value the database
 * has never persisted.
 */
export interface FriendProfile {
  userId: string;
  /**
   * NULLABLE. This RPC joins `profiles` without a `username IS NOT NULL`
   * filter (unlike `search_public_users`), so a relationship formed before the
   * account cleared its username arrives with none. Render it through
   * `socialDisplayName`.
   */
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  experiencePoints: number;
}

/**
 * One fragrance a friend has bought, as the social projection exposes it.
 *
 * Mirrors `get_friend_purchased_products`. This is a PRODUCT, never a purchase:
 * there is no order id, order number, quantity, size, price, total, discount,
 * shipping detail, payment detail or date - the RPC does not select them, so
 * nothing downstream can render them.
 *
 * Uniqueness is the database's job too. The RPC collapses every variant of a
 * fragrance into one row via SELECT DISTINCT on the product, so "Hawas Ice
 * 100ml / 10ml / 5ml" arrives here as a single Hawas Ice. Nothing de-duplicates
 * client-side, which means a regression in that guarantee would be visible
 * rather than quietly papered over.
 */
export interface PurchasedFragrance {
  productId: string;
  name: string;
  slug: string;
  brandName: string;
  /** `null` when the product has no image; the card falls back to the shared placeholder. */
  imageUrl: string | null;
}
