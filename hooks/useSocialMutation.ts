"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SOCIAL_INVALIDATIONS, type SocialMutation } from "@/lib/social/queryKeys";
import { toSocialError, type SocialError } from "@/lib/social/errors";

/**
 * The one place a social lifecycle mutation is wired up.
 *
 * All five mutations (send, cancel, accept, reject, remove) need the identical
 * four things, and writing them out five times is how the five slowly stop
 * agreeing with each other:
 *
 *   1. Run the RPC.
 *   2. Invalidate exactly the caches that mutation makes stale — the list comes
 *      from SOCIAL_INVALIDATIONS, so the policy is data, not control flow.
 *   3. Normalize the failure into Spanish via toSocialError.
 *   4. On a STALE failure ("already friends", "no longer pending" — someone
 *      else moved first), invalidate anyway. The call failed, but the local
 *      cache is what is wrong, and refetching is what makes the screen agree
 *      with the server instead of offering the same impossible action again.
 *
 * Point 4 is the reason this is a hook and not a helper function: recovering
 * from a concurrent change needs the query client, and getting it wrong is
 * invisible until two people click at once.
 */
export interface UseSocialMutationOptions<TVariables, TData> {
  /** Which cache-invalidation row in SOCIAL_INVALIDATIONS this mutation uses. */
  mutation: SocialMutation;
  mutationFn: (variables: TVariables) => Promise<TData>;
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** Receives the NORMALIZED error; the raw one is already logged. */
  onError?: (error: SocialError, variables: TVariables) => void;
}

export function useSocialMutation<TVariables, TData>({
  mutation,
  mutationFn,
  onSuccess,
  onError,
}: UseSocialMutationOptions<TVariables, TData>) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    for (const key of SOCIAL_INVALIDATIONS[mutation]) {
      // Prefix match: ["userSearch"] covers every cached search term, not just
      // the one currently rendered.
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  return useMutation<TData, unknown, TVariables>({
    mutationFn,
    onSuccess: (data, variables) => {
      invalidate();
      onSuccess?.(data, variables);
    },
    onError: (error, variables) => {
      const social = toSocialError(error);
      // The server refused because the world moved on — re-read it rather than
      // leaving the user staring at an action that can never succeed.
      if (social.isStale) invalidate();
      onError?.(social, variables);
    },
  });
}
