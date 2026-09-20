/**
 * Every React Query key the social module uses, in one place.
 *
 * Before MVP 2 there was one key (`["userSearch", query]`, declared inline in
 * useUserSearch). MVP 2 adds three more lists and five mutations, and each
 * mutation has to invalidate a specific subset — which is only auditable if the
 * keys and the subsets are written down together rather than spelled out as
 * string literals at nine call sites.
 *
 * The shapes match the conventions documented in SOCIAL_FEATURE_CONTEXT.txt
 * (`["friends"]`, `["friendRequests","received"]`, `["friendRequests","sent"]`,
 * `["userSearch", query]`) and MVP 1's existing search key is unchanged, so no
 * cache entry moved.
 *
 * Pure data — no React, no Supabase — so the invalidation policy below can be
 * unit-tested without mounting anything.
 */

export const socialKeys = {
  /** One cached result set per normalized search term. */
  search: (query: string) => ["userSearch", query] as const,
  /** Prefix matching EVERY search term currently in the cache. */
  searches: () => ["userSearch"] as const,

  receivedRequests: () => ["friendRequests", "received"] as const,
  sentRequests: () => ["friendRequests", "sent"] as const,

  friends: () => ["friends"] as const,

  /**
   * One friend's protected profile / purchases.
   *
   * These two carry AUTHORIZED data, so their cache entries are treated as
   * perishable: the hooks that own them use staleTime 0 and gcTime 0, and
   * `removeFriend` invalidates them by prefix. A React Query cache must never
   * be what decides somebody may still see a profile.
   */
  friendProfile: (userId: string) => ["friendProfile", userId] as const,
  friendProfiles: () => ["friendProfile"] as const,
  friendProducts: (userId: string) => ["friendProducts", userId] as const,
  friendProductsAll: () => ["friendProducts"] as const,

  /**
   * The VIEWER's own discovery eligibility (username + public profile).
   *
   * Nested under `["account", ...]` on purpose: it is the viewer's own profile
   * row, and /profile already invalidates that whole prefix after saving the
   * username and privacy switch. So setting a username re-opens the Buscar
   * tab with no extra wiring, and ProfileView needed no change.
   */
  eligibility: (userId: string) =>
    ["account", "socialEligibility", userId] as const,
  /** Prefix matching the eligibility entry whoever is signed in. */
  eligibilityAll: () => ["account", "socialEligibility"] as const,
} as const;

/** The lifecycle mutations, named for what the user did. */
export type SocialMutation =
  | "sendRequest"
  | "cancelRequest"
  | "acceptRequest"
  | "rejectRequest"
  | "removeFriend";

/**
 * Which caches each mutation makes stale.
 *
 * Deliberately NOT `invalidateQueries()` with no key — blowing the whole cache
 * would re-fetch the catalog, the cart and the order history because somebody
 * accepted a friend request.
 *
 * Every entry includes `searches()` because a relationship change rewrites the
 * `relationship_status` of any search result showing that person, and the user
 * may be looking at one right now. It is a PREFIX, so it covers every term
 * cached, not just the one on screen.
 *
 * Reasoning per row:
 *   - sendRequest    → a new pending row exists; search flips to outgoing_pending.
 *   - cancelRequest  → that row is gone; search flips back to none.
 *   - acceptRequest  → the request leaves the inbox AND a friendship appears.
 *   - rejectRequest  → the request leaves the inbox; no friendship is created,
 *                      so the friends list is untouched and is not invalidated.
 *   - removeFriend   → the friendship is gone; no request is involved, so
 *                      neither request list is invalidated.
 */
export const SOCIAL_INVALIDATIONS: Record<
  SocialMutation,
  readonly (readonly string[])[]
> = {
  // `eligibility` is here so a refusal caused by the VIEWER's own profile
  // changing elsewhere (they went private in another tab) re-reads it and
  // flips Buscar to the gate state, instead of leaving a search box that can
  // only ever fail. It is the viewer's own one-row read, so the cost of
  // refreshing it on a successful send too is negligible.
  sendRequest: [
    socialKeys.searches(),
    socialKeys.sentRequests(),
    socialKeys.eligibilityAll(),
  ],
  cancelRequest: [socialKeys.searches(), socialKeys.sentRequests()],
  acceptRequest: [
    socialKeys.searches(),
    socialKeys.receivedRequests(),
    socialKeys.friends(),
  ],
  rejectRequest: [socialKeys.searches(), socialKeys.receivedRequests()],
  removeFriend: [
    socialKeys.searches(),
    socialKeys.friends(),
    socialKeys.friendProfiles(),
    socialKeys.friendProductsAll(),
  ],
} as const;
