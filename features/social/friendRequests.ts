import { supabase } from "@/lib/supabase/client";
import type {
  ReceivedFriendRequest,
  SentFriendRequest,
} from "@/types/social";

/**
 * The friend-request lifecycle, as typed operations over the social RPCs.
 *
 * Every mutation here is a `SECURITY DEFINER` function that derives the actor
 * from `auth.uid()` — no sender id is ever sent from the browser, and the
 * `friend_requests` table itself is REVOKEd from `authenticated` for
 * INSERT/UPDATE/DELETE (migration 20260919000100 §21). So this module could not
 * write the table directly even if it tried; the RPC is the only door, which is
 * what keeps the transactional rules and the authorization in PostgreSQL.
 *
 * Reads throw on failure so React Query surfaces `isError`; mutations throw so
 * React Query surfaces `onError`. The raw Postgres message is logged here and
 * turned into Spanish by lib/social/errors.ts at the UI boundary — it never
 * reaches a screen.
 */

/** Blank avatars (the signup trigger writes `''`) normalize to null everywhere. */
function toAvatarUrl(value: string | null): string | null {
  return value?.trim() ? value : null;
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Pending requests other people sent to the signed-in user. */
export async function getReceivedFriendRequests(): Promise<
  ReceivedFriendRequest[]
> {
  const { data, error } = await supabase.rpc("get_received_friend_requests");

  if (error) {
    console.error("getReceivedFriendRequests failed:", error.message);
    throw error;
  }

  return (data ?? []).map((row) => ({
    requestId: row.request_id,
    userId: row.user_id,
    username: row.username,
    avatarUrl: toAvatarUrl(row.avatar_url),
    experiencePoints: row.experience_points ?? 0,
    requestedAt: row.requested_at,
  }));
}

/**
 * Pending requests the signed-in user sent.
 *
 * Loaded by the search panel — not to be listed, but so an `outgoing_pending`
 * result can be cancelled. One request covers every result on the page.
 */
export async function getSentFriendRequests(): Promise<SentFriendRequest[]> {
  const { data, error } = await supabase.rpc("get_sent_friend_requests");

  if (error) {
    console.error("getSentFriendRequests failed:", error.message);
    throw error;
  }

  return (data ?? []).map((row) => ({
    requestId: row.request_id,
    userId: row.user_id,
    username: row.username,
    avatarUrl: toAvatarUrl(row.avatar_url),
    requestedAt: row.requested_at,
  }));
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Ask to be someone's friend. Returns the new request's id.
 *
 * Idempotent on the server: sending twice returns the SAME request id rather
 * than creating a second row (the function returns the existing one when the
 * caller is already its sender). That is the real protection against a double
 * click — the disabled button is only the courtesy.
 */
export async function sendFriendRequest(targetUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("send_friend_request", {
    p_target_user_id: targetUserId,
  });

  if (error) {
    console.error("sendFriendRequest failed:", error.message);
    throw error;
  }

  return data;
}

/** Withdraw a request the signed-in user sent. Only the sender may do this. */
export async function cancelFriendRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_friend_request", {
    p_request_id: requestId,
  });

  if (error) {
    console.error("cancelFriendRequest failed:", error.message);
    throw error;
  }
}

/**
 * Accept a received request. Returns the new friendship's id.
 *
 * The whole transition — create the friendship, mark the request accepted —
 * happens inside one transaction with the request row locked `FOR UPDATE`.
 * None of that is repeated here: React must not insert into `friendships` or
 * flip the request status itself.
 */
export async function acceptFriendRequest(requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc("accept_friend_request", {
    p_request_id: requestId,
  });

  if (error) {
    console.error("acceptFriendRequest failed:", error.message);
    throw error;
  }

  return data;
}

/**
 * Decline a received request.
 *
 * Records `rejected` and creates nothing. It is NOT a block: the partial unique
 * index only covers `status = 'pending'`, so the same person may send another
 * request afterwards.
 */
export async function rejectFriendRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc("reject_friend_request", {
    p_request_id: requestId,
  });

  if (error) {
    console.error("rejectFriendRequest failed:", error.message);
    throw error;
  }
}
