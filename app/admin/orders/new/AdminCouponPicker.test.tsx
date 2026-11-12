import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminCouponPicker from "./AdminCouponPicker";
import { userCoupon as adminCoupon } from "@/test/helpers/couponFixtures";

function setup(props: Partial<React.ComponentProps<typeof AdminCouponPicker>> = {}) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  const onRetry = vi.fn();
  render(
    <AdminCouponPicker
      status="ready"
      coupons={[]}
      subtotal={40_000}
      selectedId={null}
      onSelect={onSelect}
      onClear={onClear}
      onRetry={onRetry}
      {...props}
    />
  );
  return { onSelect, onClear, onRetry, user: userEvent.setup() };
}

describe("AdminCouponPicker", () => {
  it("asks for a registered customer first", () => {
    setup({ status: "no-customer" });
    expect(screen.getByText(/Selecciona un cliente registrado/)).toBeInTheDocument();
  });

  it("shows an empty state when the customer has no coupons", () => {
    setup({ coupons: [] });
    expect(screen.getByText(/no tiene cupones disponibles/)).toBeInTheDocument();
  });

  it("offers a retry when the coupons could not be loaded", async () => {
    const { onRetry, user } = setup({ status: "error" });
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the code, benefit, conditions, expiry and the discount for this order", () => {
    setup({
      coupons: [
        adminCoupon("c1", "Cupón Conocedor", { code: "CONOCEDOR-8" }, "unlocked", "2026-12-31T12:00:00Z"),
        adminCoupon("c2", "Cupón Fijo", { discountType: "fixed", discountValue: 5_000, minOrderSubtotal: 0 }),
      ],
    });

    expect(screen.getByText("CONOCEDOR-8")).toBeInTheDocument();
    expect(screen.getByText("8% de descuento")).toBeInTheDocument();
    expect(screen.getByText(/Compra mínima/)).toBeInTheDocument();
    expect(screen.getByText(/Vence el/)).toBeInTheDocument();
    expect(screen.getByText("Sin reclamar")).toBeInTheDocument();
    expect(screen.getByText("Reclamado")).toBeInTheDocument();
    // 8% of 40.000 = 3.200; fixed 5.000.
    expect(screen.getByText(/Descuento en este pedido: ₡\s?3[.,\s]?200/)).toBeInTheDocument();
    expect(screen.getByText(/Descuento en este pedido: ₡\s?5[.,\s]?000/)).toBeInTheDocument();
  });

  it("disables a coupon the subtotal does not reach, with the shortfall", () => {
    setup({ coupons: [adminCoupon("c1", "Cupón Conocedor")], subtotal: 20_000 });
    expect(screen.getByRole("radio", { name: /Cupón Conocedor/ })).toBeDisabled();
    expect(screen.getByText(/faltan ₡\s?5[.,\s]?000/)).toBeInTheDocument();
  });

  it("selects one coupon at a time and can go back to none", async () => {
    const { onSelect, onClear, user } = setup({
      coupons: [adminCoupon("c1", "Uno"), adminCoupon("c2", "Dos")],
      selectedId: "c1",
    });

    expect(screen.getByRole("radio", { name: /Uno/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: /Dos/ }));
    expect(onSelect).toHaveBeenCalledWith("c2");
    await user.click(screen.getByRole("radio", { name: "Sin cupón" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
