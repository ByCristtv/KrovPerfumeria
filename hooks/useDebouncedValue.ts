"use client";

import { useEffect, useState } from "react";

/**
 * The value `input` settled on, `delayMs` after the last change.
 *
 * The app already debounces in several places (CatalogToolbar, StockToolbar,
 * OrdersFilters, AdminProductsView) with an inline `useEffect` + `setTimeout`.
 * Every one of those debounces a SIDE EFFECT — a `router.push` that writes the
 * search term into the URL — so the trailing value is never needed as a value.
 * Social search is the first place that needs the settled value itself, to feed
 * a React Query key, which is why this exists rather than a fifth copy of the
 * effect: a query key has to be derived during render, not pushed from an
 * effect.
 *
 * The timer is cleared on every change and on unmount, so only the final value
 * of a burst of keystrokes is ever published.
 */
export function useDebouncedValue<T>(input: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(input);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(input), delayMs);
    return () => clearTimeout(handle);
  }, [input, delayMs]);

  return debounced;
}
