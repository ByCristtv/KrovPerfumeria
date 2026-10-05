"use client";

import { useMutation } from "@tanstack/react-query";
import type { PaymentPreparation } from "@/lib/checkout/payments/types";
import type { CheckoutPayload, PaymentMethod } from "@/schemas/checkout";

/**
 * Successful response from POST /api/checkout/session. Mirrors CheckoutResult in
 * lib/checkout/checkoutService.ts.
 *
 * The same shape comes back whether the server created the order or updated an
 * existing one — the client doesn't need to care, it just stores what it gets.
 */
export interface CheckoutSubmitResponse {
  order_id: string;
  order_number: number;
  subtotal: number;
  shipping_cost: number;
  /** Coupon reduction included in `total`; 0 when none. */
  discount: number;
  /** The coupon the order now holds, or null. */
  user_coupon_id: string | null;
  total: number;
  item_count: number;
  /**
   * HMAC token for the order URL. Lets a guest view their own order at
   * /orders/[id]?token=… and authorizes later edits to this same order.
   */
  order_token: string;
  payment_method: PaymentMethod;
  /**
   * `null` means "nothing payment-relevant changed — keep what you already have".
   * Returned when an edit didn't move the total (an address fix, a typo in the
   * phone) or on a no-op re-submit, so the mounted Onvo SDK survives untouched.
   */
  payment: PaymentPreparation | null;
}

/**
 * Structured error from the route. `code` mirrors CheckoutError.code, and the
 * client branches on it — notably `already_paid` and `not_found`, which mean the
 * stored session outlived its order and must be cleared.
 */
export interface CheckoutSubmitError {
  code: string;
  /** User-facing Spanish message, safe to display verbatim. */
  message: string;
  /** Field-level zod errors if validation failed. */
  details?: Record<string, string[] | undefined>;
  /** Raw diagnostic hint (development only). */
  hint?: string;
  status: number;
}

async function postCheckoutSession(
  payload: CheckoutPayload
): Promise<CheckoutSubmitResponse> {
  const res = await fetch("/api/checkout/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<
      CheckoutSubmitError & { error: string }
    >;
    const err: CheckoutSubmitError = {
      code: body.error ?? "unknown",
      message:
        body.message ??
        "Ocurrió un error inesperado. Por favor intenta de nuevo.",
      details: body.details,
      hint: body.hint,
      status: res.status,
    };
    console.error("Checkout submission error:", err);
    throw err;
  }

  return (await res.json()) as CheckoutSubmitResponse;
}

/**
 * TanStack mutation for the checkout submit — used for BOTH the first submit and
 * every subsequent edit. Whether that creates or updates is the server's call,
 * driven by the `session` field on the payload.
 *
 *   const submit = useCheckoutSubmit();
 *   submit.mutate(payload, { onSuccess, onError });
 */
export function useCheckoutSubmit() {
  return useMutation<CheckoutSubmitResponse, CheckoutSubmitError, CheckoutPayload>({
    mutationFn: postCheckoutSession,
  });
}
