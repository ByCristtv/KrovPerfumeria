import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { UserCoupon } from "@/lib/coupons/types";

/**
 * The checkout's coupon behaviour: claim-on-select, and — the part the checkout
 * depends on — removing a coupon the moment the cart stops qualifying for it,
 * with an explanation.
 *
 * The three data hooks and the toast are mocked; this suite owns the decisions
 * made on top of them.
 */

const { auth, wholesale, coupons, claim, swal } = vi.hoisted(() => ({
  auth: { value: { user: { id: "u1" } as { id: string } | null, isLoading: false } },
  wholesale: { value: { isApproved: false } },
  coupons: {
    value: {
      data: [] as UserCoupon[] | undefined,
      isSuccess: true,
      isError: false,
      isPending: false,
    },
  },
  claim: { mutate: vi.fn(), isPending: false },
  swal: { fire: vi.fn() },
}));

vi.mock("@/hooks/useAuthUser", () => ({ useAuthUser: () => auth.value }));
vi.mock("@/hooks/useWholesaleStatus", () => ({
  useWholesaleStatus: () => wholesale.value,
}));
vi.mock("@/hooks/useUserCoupons", () => ({
  useUserCoupons: () => coupons.value,
  useClaimCoupon: () => claim,
}));
vi.mock("sweetalert2", () => ({ default: swal }));

import { useCheckoutCoupon } from "./useCheckoutCoupon";

const make = (
  id: string,
  status: UserCoupon["status"],
  overrides: Partial<UserCoupon> = {},
  terms: Partial<UserCoupon["coupon"]> = {}
): UserCoupon => ({
  id,
  status,
  unlockedAt: "2026-09-01T00:00:00Z",
  claimedAt: null,
  usedAt: null,
  paymentConfirmedAt: null,
  expiresAt: null,
  usedOrderId: null,
  coupon: {
    code: "MAESTRO-18",
    name: "Cupón Maestro",
    description: null,
    discountType: "percentage",
    discountValue: 18,
    maxDiscountAmount: null,
    minOrderSubtotal: 25_000,
    levelRequired: 5,
    ...terms,
  },
  ...overrides,
});

const setCoupons = (data: UserCoupon[] | undefined) => {
  coupons.value = {
    data,
    isSuccess: data !== undefined,
    isError: false,
    isPending: data === undefined,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  auth.value = { user: { id: "u1" }, isLoading: false };
  wholesale.value = { isApproved: false };
  claim.isPending = false;
  setCoupons([]);
});

describe("availability", () => {
  it("is 'guest' when nobody is signed in", () => {
    auth.value = { user: null, isLoading: false };
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 50_000 }));
    expect(result.current.availability).toBe("guest");
  });

  it("is 'wholesale' for an approved wholesale account", () => {
    wholesale.value = { isApproved: true };
    setCoupons([make("c1", "claimed")]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 50_000 }));
    expect(result.current.availability).toBe("wholesale");
  });

  it("is 'loading' until the coupons arrive, then 'ready'", () => {
    setCoupons(undefined);
    const { result, rerender } = renderHook(() =>
      useCheckoutCoupon({ subtotal: 50_000 })
    );
    expect(result.current.availability).toBe("loading");

    setCoupons([]);
    rerender();
    expect(result.current.availability).toBe("ready");
  });
});

describe("options", () => {
  it("lists only coupons that can still be spent", () => {
    setCoupons([
      make("claimed", "claimed"),
      make("unlocked", "unlocked"),
      make("used", "used"),
      make("expired", "expired"),
      make("lapsed", "claimed", { expiresAt: "2020-01-01T00:00:00Z" }),
    ]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 50_000 }));

    expect(result.current.options.map((o) => o.coupon.id).sort()).toEqual([
      "claimed",
      "unlocked",
    ]);
  });

  it("keeps a below-minimum coupon listed but ineligible, so the customer sees why", () => {
    setCoupons([make("c1", "claimed")]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 10_000 }));

    expect(result.current.options).toHaveLength(1);
    expect(result.current.options[0].evaluation).toMatchObject({
      ok: false,
      reason: "min_subtotal",
      shortfall: 15_000,
    });
  });

  it("keeps the coupon held by THIS checkout's own order selectable", () => {
    setCoupons([make("held", "used", { usedOrderId: "order-1" })]);
    const { result } = renderHook(() =>
      useCheckoutCoupon({ subtotal: 100_000, currentOrderId: "order-1" })
    );

    expect(result.current.options.map((o) => o.coupon.id)).toEqual(["held"]);
    expect(result.current.options[0].heldByThisCheckout).toBe(true);
    expect(result.current.options[0].evaluation.ok).toBe(true);
  });

  it("does NOT offer a coupon held by someone else's order", () => {
    setCoupons([make("held", "used", { usedOrderId: "order-9" })]);
    const { result } = renderHook(() =>
      useCheckoutCoupon({ subtotal: 100_000, currentOrderId: "order-1" })
    );
    expect(result.current.options).toEqual([]);
  });
});

describe("selecting", () => {
  it("previews the discount for the picked coupon", () => {
    setCoupons([make("c1", "claimed")]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    act(() => result.current.select("c1"));

    expect(result.current.selectedId).toBe("c1");
    expect(result.current.discount).toBe(18_000);
  });

  it("claims an UNLOCKED coupon in the background when it is picked", () => {
    setCoupons([make("c1", "unlocked")]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    act(() => result.current.select("c1"));

    expect(claim.mutate).toHaveBeenCalledWith("c1", expect.any(Object));
    // Selected immediately — the customer is not made to wait on the claim.
    expect(result.current.selectedId).toBe("c1");
  });

  it("does not claim a coupon that is already claimed", () => {
    setCoupons([make("c1", "claimed")]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    act(() => result.current.select("c1"));

    expect(claim.mutate).not.toHaveBeenCalled();
  });

  it("drops the coupon and says why if the background claim fails", () => {
    setCoupons([make("c1", "unlocked")]);
    claim.mutate.mockImplementation((_id, opts) =>
      opts.onError(new Error("Este cupón venció."))
    );
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    act(() => result.current.select("c1"));

    expect(result.current.selectedId).toBeNull();
    expect(swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({ toast: true, text: "Este cupón venció." })
    );
  });

  it("refuses to select a coupon the cart does not qualify for", () => {
    setCoupons([make("c1", "claimed")]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 10_000 }));

    act(() => result.current.select("c1"));

    expect(result.current.selectedId).toBeNull();
  });

  it("holds one coupon at a time: picking another replaces the first", () => {
    setCoupons([make("a", "claimed"), make("b", "claimed")]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    act(() => result.current.select("a"));
    act(() => result.current.select("b"));

    expect(result.current.selectedId).toBe("b");
  });

  it("clears the selection", () => {
    setCoupons([make("c1", "claimed")]);
    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    act(() => result.current.select("c1"));
    act(() => result.current.clear());

    expect(result.current.selectedId).toBeNull();
    expect(result.current.discount).toBe(0);
  });
});

describe("keeping the selection valid when the cart changes", () => {
  it("removes the coupon and toasts the reason when the subtotal falls below its minimum", () => {
    setCoupons([make("c1", "claimed")]);
    let subtotal = 100_000;
    const { result, rerender } = renderHook(() => useCheckoutCoupon({ subtotal }));

    act(() => result.current.select("c1"));
    expect(result.current.selectedId).toBe("c1");

    // The customer drops quantities in /cart and comes back.
    subtotal = 20_000;
    rerender();

    expect(result.current.selectedId).toBeNull();
    expect(result.current.discount).toBe(0);
    expect(swal.fire).toHaveBeenCalledTimes(1);
    const toast = swal.fire.mock.calls[0][0];
    expect(toast).toMatchObject({ toast: true, icon: "warning" });
    expect(toast.text).toContain("Cupón Maestro");
    expect(toast.text).toMatch(/compra mínima/i);
  });

  it("keeps the coupon, with a smaller discount, while the subtotal stays above the minimum", () => {
    setCoupons([make("c1", "claimed")]);
    let subtotal = 100_000;
    const { result, rerender } = renderHook(() => useCheckoutCoupon({ subtotal }));

    act(() => result.current.select("c1"));
    subtotal = 50_000;
    rerender();

    expect(result.current.selectedId).toBe("c1");
    expect(result.current.discount).toBe(9_000);
    expect(swal.fire).not.toHaveBeenCalled();
  });

  it("removes a coupon that was spent elsewhere while the page was open", () => {
    setCoupons([make("c1", "claimed")]);
    const { result, rerender } = renderHook(() =>
      useCheckoutCoupon({ subtotal: 100_000 })
    );
    act(() => result.current.select("c1"));

    // Another tab used it; the refetched list now shows it as used.
    setCoupons([make("c1", "used", { usedOrderId: "order-other" })]);
    rerender();

    expect(result.current.selectedId).toBeNull();
    expect(swal.fire).toHaveBeenCalledTimes(1);
  });

  it("restores a stored selection on remount and re-validates it against the new cart", () => {
    setCoupons([make("c1", "claimed")]);
    window.sessionStorage.setItem("aroma.checkout.coupon", "c1");

    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 10_000 }));

    // Came back from /cart with too little in it: removed, and told why.
    expect(result.current.selectedId).toBeNull();
    expect(swal.fire).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem("aroma.checkout.coupon")).toBeNull();
  });

  it("restores a stored selection that is still valid, silently", () => {
    setCoupons([make("c1", "claimed")]);
    window.sessionStorage.setItem("aroma.checkout.coupon", "c1");

    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    expect(result.current.selectedId).toBe("c1");
    expect(swal.fire).not.toHaveBeenCalled();
  });

  it("does not judge a stored selection before the coupon list has loaded", () => {
    setCoupons(undefined);
    window.sessionStorage.setItem("aroma.checkout.coupon", "c1");

    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    expect(swal.fire).not.toHaveBeenCalled();
    // …but it is not reported as applied until it has been matched to a coupon.
    expect(result.current.selectedId).toBeNull();
    expect(window.sessionStorage.getItem("aroma.checkout.coupon")).toBe("c1");
  });

  it("removes the coupon for an approved wholesale buyer", () => {
    wholesale.value = { isApproved: true };
    setCoupons([make("c1", "claimed")]);
    window.sessionStorage.setItem("aroma.checkout.coupon", "c1");

    const { result } = renderHook(() => useCheckoutCoupon({ subtotal: 100_000 }));

    expect(result.current.selectedId).toBeNull();
    expect(swal.fire).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringMatching(/mayorista/i) })
    );
  });

  it("keeps the coupon our own pending order is holding after a refresh", () => {
    setCoupons([make("c1", "used", { usedOrderId: "order-1" })]);
    window.sessionStorage.setItem("aroma.checkout.coupon", "c1");

    const { result } = renderHook(() =>
      useCheckoutCoupon({ subtotal: 100_000, currentOrderId: "order-1" })
    );

    // 'used' in the database, but held by THIS checkout: not "spent elsewhere".
    expect(result.current.selectedId).toBe("c1");
    expect(result.current.discount).toBe(18_000);
    expect(swal.fire).not.toHaveBeenCalled();
  });
});
