"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthUser } from "@/hooks/useAuthUser";
import { socialKeys } from "@/lib/social/queryKeys";
import { toSocialError } from "@/lib/social/errors";
import {
  getFriendProfile,
  getFriendPurchasedProducts,
} from "@/features/social/friendProfile";
import type { FriendProfile, PurchasedFragrance } from "@/types/social";

/**
 * Server state for a friend's profile and their purchases.
 *
 * These two queries differ from every other social query in one important way:
 * what they hold is data the viewer is only allowed to see WHILE a friendship
 * exists. So their caching is deliberately hostile to staleness.
 *
 *   staleTime: 0  - every mount and every window focus re-asks the database.
 *   gcTime: 0     - leaving the page drops the entry entirely, so coming back
 *                   re-fetches from scratch instead of painting protected data
 *                   from a cache that may now be unauthorized.
 *
 * Together with `removeFriend` invalidating both key prefixes, this is what
 * keeps React Query out of the authorization path: the cache can make the
 * screen briefly OUT OF DATE, but it can never be the reason somebody still
 * sees a profile. The database refuses either way — this just means the UI
 * stops showing it promptly rather than eventually.
 *
 * The cost is a skeleton on each visit, which is the right trade for the one
 * screen in the app whose contents are permissioned.
 */
const AUTHORIZED_QUERY_OPTIONS = {
  staleTime: 0,
  gcTime: 0,
  // A revoked friendship should not need a retry storm to be discovered, and
  // `users_are_not_friends` will never succeed on a second attempt.
  retry: false,
} as const;

export interface UseFriendProfileResult {
  profile: FriendProfile | null;
  isLoading: boolean;
  /**
   * The friendship is gone, the account never existed, or access was refused.
   * One flag for all three on purpose — see FriendProfileView, which renders a
   * single unavailable state so the UI cannot be used to tell them apart.
   */
  isUnavailable: boolean;
  /** A genuine failure (network, internal) as opposed to a refusal. */
  isError: boolean;
  refetch: () => void;
}

/** A friend's profile. `userId` of `null` keeps the query idle. */
export function useFriendProfile(
  friendUserId: string | null
): UseFriendProfileResult {
  const { user } = useAuthUser();
  const enabled = !!user && !!friendUserId;

  const query = useQuery<FriendProfile | null>({
    queryKey: socialKeys.friendProfile(friendUserId ?? ""),
    queryFn: () => getFriendProfile(friendUserId!),
    enabled,
    ...AUTHORIZED_QUERY_OPTIONS,
  });

  // `users_are_not_friends` is a refusal, not a fault: the page shows the
  // unavailable state rather than "something went wrong". A null row means the
  // same thing and is treated identically.
  const refusal =
    query.isError && toSocialError(query.error).code === "users_are_not_friends";
  const emptyRow = query.isSuccess && query.data === null;

  return {
    profile: query.data ?? null,
    isLoading: enabled && query.isPending,
    isUnavailable: refusal || emptyRow,
    isError: query.isError && !refusal,
    refetch: () => void query.refetch(),
  };
}

export interface UseFriendPurchasesResult {
  fragrances: PurchasedFragrance[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * A friend's purchased fragrances.
 *
 * A SEPARATE query from the profile, not one combined call, so the identity
 * card paints as soon as it arrives instead of waiting on a product join that
 * touches orders, variants, products, brands and images. The two are
 * independent: the profile is never blocked by the fragrance list, and a
 * fragrance failure degrades one section rather than the page.
 */
export function useFriendPurchases(
  friendUserId: string | null
): UseFriendPurchasesResult {
  const { user } = useAuthUser();
  const enabled = !!user && !!friendUserId;

  const query = useQuery<PurchasedFragrance[]>({
    queryKey: socialKeys.friendProducts(friendUserId ?? ""),
    queryFn: () => getFriendPurchasedProducts(friendUserId!),
    enabled,
    ...AUTHORIZED_QUERY_OPTIONS,
  });

  return {
    fragrances: query.data ?? [],
    isLoading: enabled && query.isPending,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
