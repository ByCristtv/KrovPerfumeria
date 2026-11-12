import { describe, expect, it } from "vitest";
import { adminCouponErrorMessage } from "./adminErrors";

describe("adminCouponErrorMessage", () => {
  it("explains the two manual-order-only rules", () => {
    expect(adminCouponErrorMessage("coupon_customer_required")).toMatch(/cuenta registrada/);
    expect(adminCouponErrorMessage("coupon_manual_discount_conflict")).toMatch(
      /descuento manual/
    );
  });

  it("carries the minimum from coupon_min_subtotal:<amount>", () => {
    expect(adminCouponErrorMessage("coupon_min_subtotal:25000")).toMatch(/25[.,\s]?000/);
  });

  it("tells the admin a spent coupon may have been used elsewhere", () => {
    expect(adminCouponErrorMessage("coupon_not_available")).toMatch(/otro pedido/);
  });

  it("maps every shared code to admin copy (no raw SQL leaks)", () => {
    for (const code of [
      "coupon_login_required",
      "coupon_invalid_request",
      "coupon_order_invalid",
      "coupon_not_applicable",
      "coupon_not_found",
      "coupon_inactive",
      "coupon_expired",
      "coupon_not_available",
      "coupon_no_discount",
    ]) {
      const message = adminCouponErrorMessage(code);
      expect(message, code).toBeTruthy();
      expect(message, code).not.toContain("coupon_");
    }
  });

  it("returns null for errors that are not about coupons", () => {
    expect(adminCouponErrorMessage("Insufficient stock for variant X")).toBeNull();
    expect(adminCouponErrorMessage("")).toBeNull();
    expect(adminCouponErrorMessage(undefined)).toBeNull();
  });
});
