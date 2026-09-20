"use client";

import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchPublicUsers } from "@/features/social/searchPublicUsers";
import { socialKeys } from "@/lib/social/queryKeys";
import {
  isSearchableQuery,
  normalizeSearchQuery,
  SOCIAL_SEARCH_MIN_LENGTH,
  type SocialSearchUser,
} from "@/types/social";

/** Matches the app's other search boxes (CatalogToolbar/OrdersFilters: 300–400ms). */
const SEARCH_DEBOUNCE_MS = 350;

export interface UseUserSearchResult {
  /** The term the results on screen belong to — debounced and trimmed. */
  query: string;
  users: SocialSearchUser[];
  /** True while a request for the current term is in flight. */
  isLoading: boolean;
  isError: boolean;
  /** Nothing has been typed yet (or not enough of it) to search on. */
  isIdle: boolean;
  /**
   * The user is mid-keystroke: what they typed and what was last searched
   * disagree. Lets the UI hold the previous results instead of flashing an
   * empty state between debounce and fetch.
   */
  isPending: boolean;
  refetch: () => void;
}

/**
 * Server state for public user search.
 *
 * React Query owns the results (per the project's existing pattern — see
 * useWholesaleStatus / ProfileView); Zustand holds none of this, because the
 * results are a cache of somebody else's data, not app state.
 *
 * Two gates stop pointless requests, and they are the same gate stated twice:
 *   1. `enabled` — the query does not run until the DEBOUNCED term is long
 *      enough, so a term below `SOCIAL_SEARCH_MIN_LENGTH` never reaches the RPC
 *      (which would return an empty set anyway — see `char_length(v_query) < 2`).
 *   2. The debounce — the key only changes once typing stops, so a burst of
 *      keystrokes produces one request, not one per character.
 *
 * `staleTime` is deliberately short. The global default is 5 minutes, which is
 * right for a catalog and wrong here: a relationship_status can change from
 * another device, and re-reading a search a minute later should not show a
 * stale "Agregar" for somebody who is already a friend.
 */
export function useUserSearch(rawQuery: string): UseUserSearchResult {
  const debouncedRaw = useDebouncedValue(rawQuery, SEARCH_DEBOUNCE_MS);

  const typed = normalizeSearchQuery(rawQuery);
  const query = normalizeSearchQuery(debouncedRaw);
  const enabled = isSearchableQuery(query);

  const result = useQuery<SocialSearchUser[]>({
    // Keyed on the NORMALIZED term, so "  aurora " and "aurora" share a cache
    // entry instead of firing the same search twice.
    // The key now comes from the shared factory (lib/social/queryKeys). Its
    // SHAPE is unchanged, so no cache entry moved - but the lifecycle
    // mutations have to invalidate it by prefix, and that only stays correct
    // if both sides read one definition.
    queryKey: socialKeys.search(query),
    queryFn: () => searchPublicUsers(query),
    enabled,
    staleTime: 30_000,
  });

  return {
    query,
    users: result.data ?? [],
    // `isPending` from React Query is also true for a DISABLED query, which
    // would render a permanent spinner on an empty box. Gate it on `enabled`.
    isLoading: enabled && result.isPending,
    isError: enabled && result.isError,
    isIdle: typed.length < SOCIAL_SEARCH_MIN_LENGTH,
    isPending: typed !== query,
    refetch: () => void result.refetch(),
  };
}
