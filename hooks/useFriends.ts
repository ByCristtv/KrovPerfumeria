"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useSocialMutation } from "@/hooks/useSocialMutation";
import { socialKeys } from "@/lib/social/queryKeys";
import { getFriends, removeFriend } from "@/features/social/friends";
import type { SocialMutationCallbacks } from "@/hooks/useFriendRequests";
import type { Friend } from "@/types/social";

export interface UseFriendsResult {
  friends: Friend[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * The signed-in user's friends list.
 *
 * Same 30s staleTime as the request lists: the other person can end the
 * friendship, and without Realtime a short staleTime is what turns a remount or
 * a window focus into a re-read.
 */
export function useFriends(): UseFriendsResult {
  const { user } = useAuthUser();

  const query = useQuery<Friend[]>({
    queryKey: socialKeys.friends(),
    queryFn: getFriends,
    enabled: !!user,
    staleTime: 30_000,
  });

  return {
    friends: query.data ?? [],
    isLoading: !!user && query.isPending,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

/** End a friendship. Takes the FRIEND's user id. */
export function useRemoveFriend(callbacks: SocialMutationCallbacks = {}) {
  return useSocialMutation<string, boolean>({
    mutation: "removeFriend",
    mutationFn: removeFriend,
    onSuccess: () => callbacks.onSuccess?.(),
    onError: (error) => callbacks.onError?.(error),
  });
}
