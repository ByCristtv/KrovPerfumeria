import { describe, expect, it } from "vitest";
import { validateRewardTerms, type RewardTermsInput } from "./rewardTerms";

const base: RewardTermsInput = {
  name: "Cupón Alquimista",
  description: "",
  discountType: "percentage",
  discountValue: "12",
  minOrderSubtotal: "20000",
  maxDiscountAmount: "",
  validDays: "",
};

const check = (overrides: Partial<RewardTermsInput>) => validateRewardTerms({ ...base, ...overrides });

describe("validateRewardTerms — accepted", () => {
  it("returns typed terms for the seeded shape (12 %, ₡20,000, no cap, no expiry)", () => {
    expect(check({})).toEqual({
      ok: true,
      terms: {
        name: "Cupón Alquimista",
        description: null,
        discountType: "percentage",
        discountValue: 12,
        minOrderSubtotal: 20_000,
        maxDiscountAmount: null,
        validDays: null,
      },
    });
  });

  it("accepts percentages up to 100 with two decimals, a cap and an expiry", () => {
    const result = check({ discountValue: "7.25", maxDiscountAmount: "30000", validDays: "30" });
    expect(result.ok && result.terms).toMatchObject({ discountValue: 7.25, maxDiscountAmount: 30_000, validDays: 30 });
    expect(check({ discountValue: "100" }).ok).toBe(true);
  });

  it("accepts a whole-colón fixed amount and a zero minimum", () => {
    const result = check({ discountType: "fixed", discountValue: "5000", minOrderSubtotal: "0" });
    expect(result.ok && result.terms).toMatchObject({ discountType: "fixed", discountValue: 5_000, minOrderSubtotal: 0 });
  });

  it("trims the name and turns a blank description into null", () => {
    const result = check({ name: "  Bienvenida  ", description: "   " });
    expect(result.ok && result.terms.name).toBe("Bienvenida");
    expect(result.ok && result.terms.description).toBeNull();
  });
});

describe("validateRewardTerms — rejected (mirrors loyalty_assert_reward_terms)", () => {
  it.each<[string, Partial<RewardTermsInput>, keyof RewardTermsInput]>([
    ["zero percent", { discountValue: "0" }, "discountValue"],
    ["over 100 %", { discountValue: "101" }, "discountValue"],
    ["three decimals", { discountValue: "12.345" }, "discountValue"],
    ["negative", { discountValue: "-5" }, "discountValue"],
    ["not a number", { discountValue: "doce" }, "discountValue"],
    ["fractional colones", { discountType: "fixed", discountValue: "10.5" }, "discountValue"],
    ["fixed over the cap", { discountType: "fixed", discountValue: "10000001" }, "discountValue"],
    ["cap on a fixed amount", { discountType: "fixed", discountValue: "5000", maxDiscountAmount: "1000" }, "maxDiscountAmount"],
    ["zero cap", { maxDiscountAmount: "0" }, "maxDiscountAmount"],
    ["fractional minimum", { minOrderSubtotal: "1.5" }, "minOrderSubtotal"],
    ["negative minimum", { minOrderSubtotal: "-1" }, "minOrderSubtotal"],
    ["empty minimum", { minOrderSubtotal: "" }, "minOrderSubtotal"],
    ["zero days", { validDays: "0" }, "validDays"],
    ["too many days", { validDays: "3651" }, "validDays"],
    ["blank name", { name: "   " }, "name"],
    ["long name", { name: "x".repeat(81) }, "name"],
    ["long description", { description: "x".repeat(301) }, "description"],
  ])("%s", (_label, overrides, field) => {
    const result = check(overrides);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[field]).toBeTruthy();
  });

  it("reports every invalid field at once", () => {
    const result = check({ name: "", discountValue: "0", validDays: "0" });
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["discountValue", "name", "validDays"]);
  });
});
