"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useSocialMutation } from "@/hooks/useSocialMutation";
import { socialKeys } from "@/lib/social/queryKeys";
import type { SocialError } from "@/lib/social/errors";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  getReceivedFriendRequests,
  getSentFriendRequests,
  rejectFriendRequest,
  sendFriendRequest,
} from "@/features/social/friendRequests";
import {
  indexSentRequestsByUser,
  type ReceivedFriendRequest,
  type SentFriendRequest,
} from "@/types/social";

/**
 * Server state for friend requests.
 *
 * `staleTime` matches useUserSearch's 30s for the same reason: these lists are
 * changed by OTHER people, so the global 5-minute default would leave a request
 * sitting unseen for minutes. MVP 2 has no Realtime — a refetch on mount or on
 * window focus is how a remote change arrives, and a short staleTime is what
 * makes that refetch actually happen.
 */
const SOCIAL_STALE_MS = 30_000;

// ── Reads ────────────────────────────────────────────────────────────────────

export interface UseReceivedRequestsResult {
  requests: ReceivedFriendRequest[];
  /** Drives the "Solicitudes (2)" badge. 0 while loading, never undefined. */
  count: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/** Pending requests waiting for the signed-in user's decision. */
export function useReceivedRequests(): UseReceivedRequestsResult {
  const { user } = useAuthUser();

  const query = useQuery<ReceivedFriendRequest[]>({
    queryKey: socialKeys.receivedRequests(),
    queryFn: getReceivedFriendRequests,
    enabled: !!user,
    staleTime: SOCIAL_STALE_MS,
  });

  const requests = query.data ?? [];

  return {
    requests,
    // Straight off the server list — there is no separate counter to drift.
    count: requests.length,
    isLoading: !!user && query.isPending,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}

export interface UseSentRequestsResult {
  requests: SentFriendRequest[];
  /** targetUserId → requestId, so a search row can find its own request. */
  byUserId: ReadonlyMap<string, string>;
  isLoading: boolean;
}

/**
 * Pending requests the signed-in user sent.
 *
 * Loaded by the search panel purely to make "Cancelar" possible: the search RPC
 * reports `outgoing_pending` but not the request id. ONE query serves every
 * result on the page — see `indexSentRequestsByUser`.
 */
export function useSentRequests(): UseSentRequestsResult {
  const { user } = useAuthUser();

  const query = useQuery<SentFriendRequest[]>({
    queryKey: socialKeys.sentRequests(),
    queryFn: getSentFriendRequests,
    enabled: !!user,
    staleTime: SOCIAL_STALE_MS,
  });

  const requests = query.data ?? [];

  return {
    requests,
    byUserId: indexSentRequestsByUser(requests),
    isLoading: !!user && query.isPending,
  };
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * What every lifecycle mutation reports back to the UI. Success and failure
 * are both callbacks rather than thrown values, so a list row can show a toast
 * without wrapping each click in a try/catch.
 */
export interface SocialMutationCallbacks {
  onSuccess?: () => void;
  onError?: (error: SocialError) => void;
}

/** Send a friend request to the given user id. */
export function useSendFriendRequest(callbacks: SocialMutationCallbacks = {}) {
  return useSocialMutation<string, string>({
    mutation: "sendRequest",
    mutationFn: sendFriendRequest,
    onSuccess: () => callbacks.onSuccess?.(),
    onError: (error) => callbacks.onError?.(error),
  });
}

/** Withdraw a request this user sent. Takes the REQUEST id. */
export function useCancelFriendRequest(callbacks: SocialMutationCallbacks = {}) {
  return useSocialMutation<string, void>({
    mutation: "cancelRequest",
    mutationFn: cancelFriendRequest,
    onSuccess: () => callbacks.onSuccess?.(),
    onError: (error) => callbacks.onError?.(error),
  });
}

/** Accept a received request. Takes the REQUEST id. */
export function useAcceptFriendRequest(callbacks: SocialMutationCallbacks = {}) {
  return useSocialMutation<string, string>({
    mutation: "acceptRequest",
    mutationFn: acceptFriendRequest,
    onSuccess: () => callbacks.onSuccess?.(),
    onError: (error) => callbacks.onError?.(error),
  });
}

/** Decline a received request. Takes the REQUEST id. */
export function useRejectFriendRequest(callbacks: SocialMutationCallbacks = {}) {
  return useSocialMutation<string, void>({
    mutation: "rejectRequest",
    mutationFn: rejectFriendRequest,
    onSuccess: () => callbacks.onSuccess?.(),
    onError: (error) => callbacks.onError?.(error),
  });
}
