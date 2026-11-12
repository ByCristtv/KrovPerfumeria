import { describe, expect, it } from "vitest";
import { mapUserCoupon, type UserCouponRow } from "./mapUserCoupon";
import type { Tables } from "@/types/database";

const definition = (overrides: Partial<Tables<"coupons">> = {}): Tables<"coupons"> => ({
  id: "c1",
  code: "ALQUIMISTA-12",
  name: "Cupón Alquimista",
  description: "12% por alcanzar Alquimista.",
  discount_type: "percentage",
  discount_value: 12,
  max_discount_amount: null,
  min_order_subtotal: 20_000,
  level_required: 4,
  valid_days: null,
  is_active: true,
  created_at: "2026-10-05T10:00:00+00:00",
  updated_at: "2026-10-05T10:00:00+00:00",
  ...overrides,
});

const row = (overrides: Partial<UserCouponRow> = {}): UserCouponRow => ({
  id: "uc1",
  user_id: "u1",
  coupon_id: "c1",
  status: "unlocked",
  unlocked_at: "2026-10-06T00:00:00+00:00",
  claimed_at: null,
  used_at: null,
  payment_confirmed_at: null,
  expires_at: null,
  used_order_id: null,
  created_at: "2026-10-06T00:00:00+00:00",
  updated_at: "2026-10-06T00:00:00+00:00",
  coupons: definition(),
  ...overrides,
});

describe("mapUserCoupon — issued terms win over the live definition", () => {
  it("prices from the snapshot even after the definition was edited", () => {
    const mapped = mapUserCoupon(
      row({
        coupon_code: "ALQUIMISTA-12",
        coupon_name: "Cupón Alquimista",
        coupon_description: null,
        discount_type: "percentage",
        discount_value: "12.00",
        max_discount_amount: null,
        min_order_subtotal: "20000.00",
        level_required: 4,
        // An admin has since raised the definition to 15 % / ₡30,000.
        coupons: definition({ discount_value: 15, min_order_subtotal: 30_000 }),
      })
    );
    expect(mapped?.coupon).toMatchObject({ discountValue: 12, minOrderSubtotal: 20_000, levelRequired: 4 });
  });

  it("still renders a coupon whose definition was retired (RLS hides it)", () => {
    const mapped = mapUserCoupon(
      row({
        coupon_code: "MAESTRO-18",
        coupon_name: "Cupón Maestro",
        discount_type: "percentage",
        discount_value: 18,
        min_order_subtotal: 20_000,
        level_required: 5,
        coupons: null,
      })
    );
    expect(mapped?.coupon).toMatchObject({ code: "MAESTRO-18", discountValue: 18 });
  });

  it("falls back to the definition for rows from before the snapshot migration", () => {
    expect(mapUserCoupon(row())?.coupon).toMatchObject({ code: "ALQUIMISTA-12", discountValue: 12 });
  });

  it("drops a pre-snapshot row whose definition is unreadable", () => {
    expect(mapUserCoupon(row({ coupons: null }))).toBeNull();
  });
});
