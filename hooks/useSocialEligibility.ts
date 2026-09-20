"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthUser } from "@/hooks/useAuthUser";
import { socialKeys } from "@/lib/social/queryKeys";
import { getSocialEligibility } from "@/features/social/socialEligibility";

/**
 * Whether the signed-in user may use social discovery — the single place that
 * condition is expressed.
 *
 * `hasUsername && isProfilePublic`, and nothing more. It gates ONLY the Buscar
 * section and the act of sending a new request; Amigos, Solicitudes, accepting,
 * rejecting, removing and viewing an authorized friend profile are all
 * untouched by it. Privacy controls discovery, not relationships that already
 * exist.
 *
 * WHY THE KEY LIVES UNDER `["account", ...]`: this is the viewer's own profile
 * row, and /profile already calls
 * `invalidateQueries({ queryKey: ["account"] })` after saving the username +
 * privacy switch (see ProfileView.refreshAccount). Nesting under that prefix
 * means setting a username makes the Buscar tab open itself on the next render
 * with no extra wiring, and nothing in ProfileView had to change.
 */
export interface SocialEligibility {
  /** The viewer's own username, for copy that needs it. */
  username: string | null;
  hasUsername: boolean;
  isProfilePublic: boolean;
  /** `hasUsername && isProfilePublic`. */
  canDiscover: boolean;
  /** True until the profile row has been read — gate UI must not flash. */
  isLoading: boolean;
  /**
   * The profile row could not be read. Distinguished from "ineligible" so the
   * gate does not tell somebody who HAS a username to go choose one.
   */
  isError: boolean;
  refetch: () => void;
}

export function useSocialEligibility(): SocialEligibility {
  const { user } = useAuthUser();

  const query = useQuery({
    queryKey: socialKeys.eligibility(user?.id ?? ""),
    queryFn: () => getSocialEligibility(user!.id),
    enabled: !!user,
    // Matches ProfileView's own account query. A change made on /profile
    // arrives through the invalidation above rather than by expiry.
    staleTime: 60_000,
  });

  const hasUsername = !!query.data?.username;
  const isProfilePublic = query.data?.isProfilePublic === true;

  return {
    username: query.data?.username ?? null,
    hasUsername,
    isProfilePublic,
    // Deliberately false while loading and on a failed read: the gate states
    // are recoverable (they point at /profile), whereas wrongly showing the
    // search box would fire an RPC the backend refuses.
    canDiscover: hasUsername && isProfilePublic,
    isLoading: !!user && query.isPending,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
