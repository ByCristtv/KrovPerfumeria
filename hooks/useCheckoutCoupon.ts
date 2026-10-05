"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Swal from "sweetalert2";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useClaimCoupon, useUserCoupons } from "@/hooks/useUserCoupons";
import { useWholesaleStatus } from "@/hooks/useWholesaleStatus";
import {
  describeRejection,
  evaluateCoupon,
  isSpendable,
} from "@/lib/coupons/discount";
import type { CouponEvaluation, UserCoupon } from "@/lib/coupons/types";

/**
 * One coupon as the checkout offers it, already judged against the current cart.
 */
export interface CheckoutCouponOption {
  coupon: UserCoupon;
  /** `ok: false` options stay listed — greyed, with the reason — so the customer can see what they are missing. */
  evaluation: CouponEvaluation;
  /** True when this checkout's own pending order is the one holding the coupon. */
  heldByThisCheckout: boolean;
}

export type CheckoutCouponAvailability =
  | "guest" // not signed in: coupons belong to accounts
  | "loading"
  | "error"
  | "wholesale" // approved wholesale buyers already get negotiated prices
  | "ready";

export interface CheckoutCouponState {
  availability: CheckoutCouponAvailability;
  options: CheckoutCouponOption[];
  selectedId: string | null;
  selected: CheckoutCouponOption | null;
  /** PREVIEW of what the order will be reduced by; the database recomputes it. 0 when nothing is applied. */
  discount: number;
  /** A background claim is in flight for the picked coupon. */
  isClaiming: boolean;
  select: (userCouponId: string) => void;
  clear: () => void;
}

interface UseCheckoutCouponArgs {
  /** Goods subtotal the customer will be charged for (wholesale-aware, before shipping). */
  subtotal: number;
  /** The checkout's pending order, if it has one — its held coupon must stay selectable. */
  currentOrderId?: string | null;
}

/**
 * The checkout's selected coupon, and everything needed to keep it honest.
 *
 *  - Picking an `unlocked` coupon claims it in the background — the customer
 *    never has to detour to their profile first. (The claim is a courtesy:
 *    the server accepts `unlocked` too, so a slow or failed claim cannot block
 *    the purchase; a failed one just drops the coupon with an explanation.)
 *
 *  - If the cart changes so the coupon no longer fits — the subtotal falls under
 *    its minimum, or it expired while the page sat open — it is REMOVED and a
 *    toast says why, instead of waiting for the server to reject the order at
 *    "pay".
 *
 *  - The choice survives navigating to /cart and back (sessionStorage, per tab,
 *    like the pending-order reference), which is exactly how a customer changes
 *    quantities mid-checkout.
 *
 * Everything here is PREVIEW. The authoritative minimum check and discount live
 * in the `apply_order_coupon` RPC.
 */
export function useCheckoutCoupon({
  subtotal,
  currentOrderId = null,
}: UseCheckoutCouponArgs): CheckoutCouponState {
  const { user, isLoading: authLoading } = useAuthUser();
  const { isApproved: isWholesale } = useWholesaleStatus();
  const couponsQuery = useUserCoupons();
  const claim = useClaimCoupon();

  const [selectedId, setSelectedId] = useState<string | null>(readStoredId);
  useEffect(() => writeStoredId(selectedId), [selectedId]);

  const options = useMemo<CheckoutCouponOption[]>(() => {
    const now = new Date();
    return (couponsQuery.data ?? [])
      .map((coupon) => ({
        coupon,
        // `currentOrderId` must be real: a coupon used with no recorded order
        // (null) must not "match" a checkout that has no order yet (also null).
        held:
          currentOrderId !== null &&
          coupon.status === "used" &&
          coupon.usedOrderId === currentOrderId,
      }))
      .filter(({ coupon, held }) => held || isSpendable(coupon, now))
      .map(({ coupon, held }) => ({
        coupon,
        // A coupon held by OUR order reads as 'used' in the database; judge it as
        // the spendable coupon it is for this checkout.
        evaluation: evaluateCoupon(
          held ? { ...coupon, status: "claimed" } : coupon,
          subtotal,
          now
        ),
        heldByThisCheckout: held,
      }))
      // Usable first, then biggest benefit.
      .sort(
        (a, b) =>
          Number(b.evaluation.ok) - Number(a.evaluation.ok) ||
          b.coupon.coupon.levelRequired - a.coupon.coupon.levelRequired
      );
  }, [couponsQuery.data, currentOrderId, subtotal]);

  const selected = useMemo(
    () => options.find((o) => o.coupon.id === selectedId) ?? null,
    [options, selectedId]
  );

  // ── Keep the selection valid ───────────────────────────────────────────────
  const lastNotified = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedId || !couponsQuery.isSuccess) return;

    const drop = (message: string | null) => {
      setSelectedId(null);
      if (message && lastNotified.current !== `${selectedId}:${message}`) {
        lastNotified.current = `${selectedId}:${message}`;
        notifyRemoved(message);
      }
    };

    if (isWholesale) {
      drop("Los cupones no se combinan con precios mayoristas.");
      return;
    }

    if (!selected) {
      // Spent elsewhere, expired, or retired since it was chosen.
      drop("El cupón que habías elegido ya no está disponible.");
      return;
    }

    if (!selected.evaluation.ok) {
      drop(
        `${selected.coupon.coupon.name}: ${describeRejection(
          selected.evaluation,
          selected.coupon.coupon
        )}`
      );
    }
  }, [selectedId, selected, isWholesale, couponsQuery.isSuccess]);

  const select = useCallback(
    (userCouponId: string) => {
      const option = options.find((o) => o.coupon.id === userCouponId);
      if (!option || !option.evaluation.ok) return;

      setSelectedId(userCouponId);

      // Background claim. Fire-and-forget on purpose: the customer is mid-form.
      if (option.coupon.status === "unlocked") {
        claim.mutate(userCouponId, {
          onError: (error) => {
            setSelectedId((current) =>
              current === userCouponId ? null : current
            );
            notifyRemoved(error.message);
          },
        });
      }
    },
    [options, claim]
  );

  const clear = useCallback(() => setSelectedId(null), []);

  const availability: CheckoutCouponAvailability = authLoading
    ? "loading"
    : !user
      ? "guest"
      : isWholesale
        ? "wholesale"
        : couponsQuery.isError
          ? "error"
          : couponsQuery.isPending
            ? "loading"
            : "ready";

  return {
    availability,
    options,
    selectedId: selected ? selectedId : null,
    selected,
    discount: selected?.evaluation.ok ? selected.evaluation.discount : 0,
    isClaiming: claim.isPending,
    select,
    clear,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tab persistence of the selection
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "aroma.checkout.coupon";

function readStoredId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: the choice just won't survive a navigation.
    return null;
  }
}

function writeStoredId(id: string | null): void {
  try {
    if (id) window.sessionStorage.setItem(STORAGE_KEY, id);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing actionable.
  }
}

/** Drop the persisted choice — call when the checkout ends. */
export function clearStoredCheckoutCoupon(): void {
  writeStoredId(null);
}

function notifyRemoved(message: string): void {
  void Swal.fire({
    toast: true,
    position: "top-end",
    icon: "warning",
    title: "Quitamos tu cupón",
    text: message,
    showConfirmButton: false,
    timer: 7000,
    timerProgressBar: true,
  });
}
