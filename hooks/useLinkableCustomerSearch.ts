"use client";

import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchLinkableCustomersAction } from "@/app/admin/orders/link/actions";
import { CUSTOMER_SEARCH_MIN_LENGTH } from "@/lib/orders/adminCustomerLookup";
import type { LinkableCustomer } from "@/types/orderLinking";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Registered-customer search for the Ligar Pedidos dialog.
 *
 * Same contract as useCustomerSearch (debounced term keys the query, below the
 * minimum nothing is sent, failures surface as `isError` rather than as "no
 * customers") but returns customer accounts only, with the member-since date
 * and XP that tell two people with the same name apart.
 */
export function useLinkableCustomerSearch(rawQuery: string) {
  const typed = rawQuery.trim();
  const query = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  const enabled = query.length >= CUSTOMER_SEARCH_MIN_LENGTH;

  const result = useQuery<LinkableCustomer[]>({
    queryKey: ["admin", "linkable-customer-search", query.toLowerCase()],
    queryFn: async () => {
      const outcome = await searchLinkableCustomersAction(query);
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
    /** Mid-keystroke: what is typed and what was last searched disagree. */
    isPending: typed !== query,
    refetch: () => void result.refetch(),
  };
}
