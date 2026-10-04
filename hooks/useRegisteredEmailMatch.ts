"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { findCustomerByEmailAction } from "@/app/admin/orders/customerActions";
import { normalizeOptionalEmail } from "@/schemas/adminOrder";
import type { AdminCustomerMatch } from "@/types/adminOrder";

const EMAIL_DEBOUNCE_MS = 500;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface UseRegisteredEmailMatchResult {
  /** The registered account that owns the typed email, or null. */
  match: AdminCustomerMatch | null;
  isChecking: boolean;
  /** The lookup itself failed — distinct from "no account has this email". */
  isError: boolean;
  /** Wire to the input's onBlur to check immediately instead of waiting. */
  onBlur: () => void;
}

/**
 * "Does the email the admin just typed belong to a registered customer?"
 *
 * Checks on a debounce while typing, and immediately on blur — the admin who
 * tabs out of the field should not wait out the timer to see the hint.
 *
 * Only well-formed addresses are looked up: half-typed input ("ana@") would be
 * a wasted request and could briefly flash a hint for the wrong person.
 */
export function useRegisteredEmailMatch(
  rawEmail: string
): UseRegisteredEmailMatchResult {
  const typed = normalizeOptionalEmail(rawEmail) ?? "";
  const debounced = useDebouncedValue(typed, EMAIL_DEBOUNCE_MS);

  // Blur "commits" the value that was in the field at that moment. It stops
  // applying as soon as the text changes again, falling back to the debounce.
  const [blurred, setBlurred] = useState("");
  const onBlur = useCallback(() => setBlurred(typed), [typed]);

  const target = blurred === typed ? typed : debounced;
  const enabled = EMAIL_SHAPE.test(target);

  const result = useQuery<AdminCustomerMatch | null>({
    queryKey: ["admin", "customer-by-email", target],
    queryFn: async () => {
      const outcome = await findCustomerByEmailAction(target);
      if (!outcome.ok) throw new Error(outcome.message);
      return outcome.data;
    },
    enabled,
    staleTime: 30_000,
  });

  // Never show a match for text that is no longer in the field: while the admin
  // is mid-edit, `target` lags `typed` and the cached answer belongs to the old one.
  const fresh = enabled && target === typed;

  return {
    match: fresh ? (result.data ?? null) : null,
    isChecking: enabled && result.isPending,
    isError: fresh && result.isError,
    onBlur,
  };
}
