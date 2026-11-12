"use client";

import { useQuery } from "@tanstack/react-query";
import { getUserCoupons } from "@/features/coupons/getUserCoupons";
import type { UserCoupon } from "@/lib/coupons/types";

/** React Query key for ONE customer's coupons, as an admin reads them. */
export const customerCouponsKey = (userId: string | null) =>
  ["admin", "customer-coupons", userId] as const;

/**
 * A registered customer's coupons, read by an ADMIN for the manual-order form.
 *
 * Same reader as the customer's own /profile/coupons (`getUserCoupons`): RLS
 * ("Admins can view all user coupons") is what lets an admin session read
 * someone else's rows, and the explicit user_id filter scopes them to the
 * customer the admin picked. Read-only — the coupon is spent by the database
 * when the order is created, never from here.
 *
 * Disabled until a customer is linked. The stale window is short because the
 * customer may be spending a coupon on the website while the admin takes the
 * order; a stale list is harmless anyway (the RPC re-checks everything).
 */
export function useCustomerCoupons(userId: string | null) {
  return useQuery<UserCoupon[]>({
    queryKey: customerCouponsKey(userId),
    queryFn: () => getUserCoupons(userId as string),
    enabled: Boolean(userId),
    staleTime: 10_000,
  });
}
