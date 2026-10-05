import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckoutCouponSelector from "./CheckoutCouponSelector";
import { formatPrice } from "@/lib/format";
import { evaluateCoupon } from "@/lib/coupons/discount";
import type {
  CheckoutCouponOption,
  CheckoutCouponState,
} from "@/hooks/useCheckoutCoupon";
import type { UserCoupon } from "@/lib/coupons/types";

const coupon = (
  id: string,
  name: string,
  percent: number,
  status: UserCoupon["status"] = "claimed"
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
    code: name.toUpperCase(),
    name,
    description: null,
    discountType: "percentage",
    discountValue: percent,
    maxDiscountAmount: null,
    minOrderSubtotal: 25_000,
    levelRequired: 2,
  },
});

const option = (c: UserCoupon, subtotal: number): CheckoutCouponOption => ({
  coupon: c,
  evaluation: evaluateCoupon(c, subtotal),
  heldByThisCheckout: false,
});

function state(overrides: Partial<CheckoutCouponState> = {}): CheckoutCouponState {
  return {
    availability: "ready",
    options: [],
    selectedId: null,
    selected: null,
    discount: 0,
    isClaiming: false,
    select: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
}

describe("CheckoutCouponSelector", () => {
  it("renders nothing for a guest", () => {
    const { container } = render(
      <CheckoutCouponSelector state={state({ availability: "guest" })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("explains that there are no coupons yet", () => {
    render(<CheckoutCouponSelector state={state()} />);
    expect(screen.getByText(/no tienes cupones disponibles/i)).toBeInTheDocument();
  });

  it("explains why wholesale accounts cannot use one", () => {
    render(<CheckoutCouponSelector state={state({ availability: "wholesale" })} />);
    expect(screen.getByText(/precios especiales/i)).toBeInTheDocument();
  });

  it("offers each coupon with the saving it gives on THIS cart", () => {
    const c = coupon("a", "Cupón Maestro", 18);
    render(
      <CheckoutCouponSelector
        state={state({ options: [option(c, 100_000)] })}
      />
    );

    const radio = screen.getByRole("radio", { name: /cupón maestro/i });
    expect(radio).toBeEnabled();
    // Asserted through formatPrice, not a literal: the es-CR separator is
    // whatever the running ICU says it is (and Testing Library folds the
    // no-break space it uses into a plain one, so compare without whitespace).
    const squash = (text: string) => text.replace(/s/g, "");
    const saving = screen.getByText(/^Ahorras/);
    expect(squash(saving.textContent ?? "")).toBe(
      squash(`Ahorras ${formatPrice(18_000)} en este pedido`)
    );
  });

  it("disables a coupon the cart does not qualify for and says how much is missing", () => {
    const c = coupon("a", "Cupón Maestro", 18);
    render(
      <CheckoutCouponSelector state={state({ options: [option(c, 10_000)] })} />
    );

    expect(screen.getByRole("radio", { name: /cupón maestro/i })).toBeDisabled();
    expect(screen.getByText(/te faltan/i)).toBeInTheDocument();
  });

  it("selects a coupon when it is chosen", async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const c = coupon("a", "Cupón Maestro", 18);
    render(
      <CheckoutCouponSelector
        state={state({ options: [option(c, 100_000)], select })}
      />
    );

    await user.click(screen.getByRole("radio", { name: /cupón maestro/i }));

    expect(select).toHaveBeenCalledWith("a");
  });

  it("is a single radio group, so only one coupon can be applied", () => {
    const a = coupon("a", "Cupón Uno", 5);
    const b = coupon("b", "Cupón Dos", 8);
    render(
      <CheckoutCouponSelector
        state={state({ options: [option(a, 100_000), option(b, 100_000)] })}
      />
    );

    const radios = screen.getAllByRole("radio");
    // two coupons + "No usar cupón", all sharing one name
    expect(radios).toHaveLength(3);
    expect(new Set(radios.map((r) => r.getAttribute("name"))).size).toBe(1);
  });

  it("marks the chosen coupon and offers to remove it", async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    const c = coupon("a", "Cupón Maestro", 18);
    const o = option(c, 100_000);
    render(
      <CheckoutCouponSelector
        state={state({
          options: [o],
          selectedId: "a",
          selected: o,
          discount: 18_000,
          clear,
        })}
      />
    );

    expect(screen.getByRole("radio", { name: /cupón maestro/i })).toBeChecked();
    await user.click(screen.getByRole("button", { name: /quitar/i }));
    expect(clear).toHaveBeenCalled();
  });

  it("tags a not-yet-claimed coupon as new, because choosing it claims it", () => {
    const c = coupon("a", "Cupón Maestro", 18, "unlocked");
    render(
      <CheckoutCouponSelector state={state({ options: [option(c, 100_000)] })} />
    );

    const label = screen.getByRole("radio", { name: /cupón maestro/i }).closest("label")!;
    expect(within(label).getByText("Nuevo")).toBeInTheDocument();
  });

  it("locks the choice while the order is being submitted", () => {
    const c = coupon("a", "Cupón Maestro", 18);
    render(
      <CheckoutCouponSelector
        state={state({ options: [option(c, 100_000)] })}
        disabled
      />
    );

    expect(screen.getByRole("radio", { name: /cupón maestro/i })).toBeDisabled();
  });
});
