import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format";
import {
  couponErrorMessage,
  couponErrorStatus,
  parseCouponError,
} from "./errors";

describe("parseCouponError", () => {
  it("recognises each code the SQL functions raise", () => {
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
      expect(parseCouponError(code)).toEqual({ code });
    }
  });

  it("reads the minimum out of coupon_min_subtotal", () => {
    expect(parseCouponError("coupon_min_subtotal:25000")).toEqual({
      code: "coupon_min_subtotal",
      minSubtotal: 25_000,
    });
  });

  it("tolerates a min-subtotal code with no usable amount", () => {
    expect(parseCouponError("coupon_min_subtotal")).toEqual({
      code: "coupon_min_subtotal",
    });
    expect(parseCouponError("coupon_min_subtotal:abc")).toEqual({
      code: "coupon_min_subtotal",
    });
  });

  it("returns null for anything that is not a coupon code, so raw SQL text never reaches a customer", () => {
    expect(parseCouponError("duplicate key value violates unique constraint")).toBeNull();
    expect(parseCouponError("coupon_something_new")).toBeNull();
    expect(parseCouponError("")).toBeNull();
    expect(parseCouponError(null)).toBeNull();
    expect(parseCouponError(undefined)).toBeNull();
  });
});

describe("couponErrorMessage", () => {
  it("names the minimum when it is known", () => {
    expect(
      couponErrorMessage({ code: "coupon_min_subtotal", minSubtotal: 25_000 })
    ).toContain(formatPrice(25_000));
  });

  it("still reads sensibly when the minimum is unknown", () => {
    expect(couponErrorMessage({ code: "coupon_min_subtotal" })).toMatch(
      /mínimo/i
    );
  });

  it("gives every code a non-empty Spanish message", () => {
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
    ] as const) {
      expect(couponErrorMessage({ code }).length).toBeGreaterThan(10);
    }
  });
});

describe("couponErrorStatus", () => {
  it("maps auth, lookup and bad-request failures to their natural statuses", () => {
    expect(couponErrorStatus({ code: "coupon_login_required" })).toBe(401);
    expect(couponErrorStatus({ code: "coupon_not_found" })).toBe(404);
    expect(couponErrorStatus({ code: "coupon_order_invalid" })).toBe(400);
  });

  it("treats the customer's own coupon problems as a recoverable 409", () => {
    expect(couponErrorStatus({ code: "coupon_expired" })).toBe(409);
    expect(couponErrorStatus({ code: "coupon_not_available" })).toBe(409);
    expect(couponErrorStatus({ code: "coupon_min_subtotal" })).toBe(409);
  });
});
