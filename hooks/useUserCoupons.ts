"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthUser } from "@/hooks/useAuthUser";
import {
  getUserCoupons,
  userCouponsKey,
} from "@/features/coupons/getUserCoupons";
import {
  couponErrorMessage,
  parseCouponError,
} from "@/lib/coupons/errors";
import { supabase } from "@/lib/supabase/client";
import type { UserCoupon } from "@/lib/coupons/types";

/**
 * The signed-in customer's coupons.
 *
 * Disabled for guests (`data` stays undefined, `isPending` stays true — callers
 * that care about the guest case check `useAuthUser` themselves, as the profile
 * and checkout do). Coupons only change when XP crosses a level, an order is
 * placed, or one is claimed, so a short stale window is plenty; the mutations
 * below invalidate explicitly.
 */
export function useUserCoupons() {
  const { user } = useAuthUser();

  return useQuery<UserCoupon[]>({
    queryKey: userCouponsKey(user?.id),
    queryFn: () => getUserCoupons(user!.id),
    enabled: !!user,
    staleTime: 30_000,
  });
}

/** An error whose message is already safe to show a customer. */
export class ClaimCouponError extends Error {}

/**
 * Claim a coupon (`unlocked → claimed`) through the `claim_user_coupon` RPC.
 *
 * The RPC identifies the customer with auth.uid(), so there is no user id to
 * forge and no server action needed in between. It is idempotent: claiming an
 * already-claimed coupon resolves successfully, which is what lets checkout call
 * it blindly on selection.
 */
export function useClaimCoupon() {
  const queryClient = useQueryClient();

  return useMutation<void, ClaimCouponError, string>({
    mutationFn: async (userCouponId) => {
      const { error } = await supabase.rpc("claim_user_coupon", {
        p_user_coupon_id: userCouponId,
      });
      if (!error) return;

      const parsed = parseCouponError(error.message);
      throw new ClaimCouponError(
        parsed
          ? couponErrorMessage(parsed)
          : "No pudimos reclamar el cupón. Inténtalo de nuevo."
      );
    },
    onSettled: () => {
      // Success or failure, the list is the truth — a failed claim usually means
      // the row changed under us (expired, used in another tab).
      void queryClient.invalidateQueries({ queryKey: ["coupons", "mine"] });
    },
  });
}
