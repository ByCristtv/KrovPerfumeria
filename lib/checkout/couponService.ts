import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  couponErrorMessage,
  couponErrorStatus,
  parseCouponError,
} from "@/lib/coupons/errors";
import { CheckoutError, internalError } from "./errors";

/** What `apply_order_coupon` returns. Amounts are CRC. */
export interface AppliedCoupon {
  order_id: string;
  user_coupon_id: string;
  coupon_code: string;
  coupon_name: string;
  /** Taken off the order's subtotal by the database, not by the client. */
  discount_amount: number;
  subtotal: number;
  shipping_cost: number;
  /** The order's new total (subtotal − discount + shipping). */
  total: number;
}

/**
 * Spend a customer's coupon on a freshly placed order.
 *
 * The whole business rule lives in the `apply_order_coupon` RPC — ownership,
 * status, expiry, the minimum against the order's STORED subtotal, the discount
 * amount, and the atomic `unlocked|claimed → used` flip that stops two checkouts
 * spending one coupon. This function only invokes it and translates its errors;
 * it deliberately accepts no amount, so there is no number here a caller could
 * get wrong or a client could forge.
 *
 * `supabase` MUST be the request-scoped RLS client, not the admin one: the RPC
 * identifies the customer with auth.uid(), and a service-role call would carry
 * no user and be rejected as `coupon_login_required`.
 *
 * Throws a {@link CheckoutError} whose `code` is the database's own coupon code
 * (`coupon_min_subtotal`, `coupon_not_available`, …) so the client can recognise
 * any `coupon_*` failure, drop the coupon, and let the customer retry.
 */
export async function applyCouponToOrder(
  supabase: SupabaseClient<Database>,
  orderId: string,
  userCouponId: string
): Promise<AppliedCoupon> {
  const { data, error } = await supabase.rpc("apply_order_coupon", {
    p_order_id: orderId,
    p_user_coupon_id: userCouponId,
  });

  if (error) throw translateCouponRpcError(error.message, orderId);
  if (!data) {
    console.error("[checkout] apply_order_coupon returned no data", { orderId });
    throw internalError("apply_order_coupon returned no data");
  }

  return data as unknown as AppliedCoupon;
}

function translateCouponRpcError(message: string, orderId: string): CheckoutError {
  const parsed = parseCouponError(message);
  if (parsed) {
    return new CheckoutError(
      parsed.code,
      couponErrorMessage(parsed),
      couponErrorStatus(parsed),
      message
    );
  }

  console.error("[checkout] unexpected apply_order_coupon error", {
    orderId,
    message,
  });
  return internalError(
    process.env.NODE_ENV === "development" ? message : undefined
  );
}
