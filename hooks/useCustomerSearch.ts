"use client";

import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchCustomersAction } from "@/app/admin/orders/customerActions";
import { CUSTOMER_SEARCH_MIN_LENGTH } from "@/lib/orders/adminCustomerLookup";
import type { AdminCustomerMatch } from "@/types/adminOrder";

const SEARCH_DEBOUNCE_MS = 300;

export interface UseCustomerSearchResult {
  customers: AdminCustomerMatch[];
  /** A request for the current (debounced) term is in flight. */
  isLoading: boolean;
  isError: boolean;
  /** Not enough typed to search on yet. */
  isIdle: boolean;
  /** Mid-keystroke: what is typed and what was last searched disagree. */
  isPending: boolean;
  refetch: () => void;
}

/**
 * Registered-customer search for the admin order form.
 *
 * Same shape as useUserSearch: the debounced, trimmed term keys the query, so a
 * burst of keystrokes is one request and a term below the minimum never reaches
 * the server. `staleTime` is short because the admin may be correcting a
 * customer's details in another tab while taking the order.
 *
 * Failures throw out of the queryFn so React Query reports them as `isError`
 * instead of the UI mistaking an outage for "no customers".
 */
export function useCustomerSearch(rawQuery: string): UseCustomerSearchResult {
  const typed = rawQuery.trim();
  const query = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  const enabled = query.length >= CUSTOMER_SEARCH_MIN_LENGTH;

  const result = useQuery<AdminCustomerMatch[]>({
    queryKey: ["admin", "customer-search", query.toLowerCase()],
    queryFn: async () => {
      const outcome = await searchCustomersAction(query);
      if (!outcome.ok) throw new Error(outcome.message);
      return outcome.data;
    },
    enabled,
    staleTime: 15_000,
  });

  return {
    customers: enabled ? (result.data ?? []) : [],
    isLoading: enabled && result.isPending,
    isError: enabled && result.isError,
    isIdle: typed.length < CUSTOMER_SEARCH_MIN_LENGTH,
    isPending: typed !== query,
    refetch: () => void result.refetch(),
  };
}
