import { describe, it, expect } from "vitest";
import {
  MAX_XP_ADJUSTMENT,
  MAX_XP_REASON_LENGTH,
  validateXpAdjustment,
} from "./xpAdjustment";

describe("validateXpAdjustment", () => {
  it("turns an addition into a positive delta", () => {
    expect(validateXpAdjustment({ direction: "add", amount: "250" })).toEqual({
      ok: true,
      delta: 250,
      reason: null,
    });
  });

  it("turns a deduction into a negative delta", () => {
    const res = validateXpAdjustment({ direction: "deduct", amount: 40 }, 100);
    expect(res).toEqual({ ok: true, delta: -40, reason: null });
  });

  it("trims the reason and drops a blank one", () => {
    expect(
      validateXpAdjustment({ direction: "add", amount: "1", reason: "  bono  " })
    ).toMatchObject({ ok: true, reason: "bono" });
    expect(
      validateXpAdjustment({ direction: "add", amount: "1", reason: "   " })
    ).toMatchObject({ ok: true, reason: null });
  });

  it.each(["", "abc", "-5", "1.5", "1e3", "0x10", "10 XP"])(
    "rejects the non-integer amount %j",
    (amount) => {
      const res = validateXpAdjustment({ direction: "add", amount });
      expect(res).toMatchObject({ ok: false, field: "amount" });
    }
  );

  it("rejects zero", () => {
    expect(validateXpAdjustment({ direction: "add", amount: "0" })).toMatchObject({
      ok: false,
      field: "amount",
    });
  });

  it("rejects negative and fractional numbers passed as numbers", () => {
    expect(validateXpAdjustment({ direction: "add", amount: -10 }).ok).toBe(false);
    expect(validateXpAdjustment({ direction: "add", amount: 2.5 }).ok).toBe(false);
    expect(validateXpAdjustment({ direction: "add", amount: Number.NaN }).ok).toBe(false);
  });

  it("enforces the per-adjustment maximum (inclusive)", () => {
    expect(
      validateXpAdjustment({ direction: "add", amount: String(MAX_XP_ADJUSTMENT) }).ok
    ).toBe(true);
    expect(
      validateXpAdjustment({ direction: "add", amount: String(MAX_XP_ADJUSTMENT + 1) })
    ).toMatchObject({ ok: false, field: "amount" });
  });

  it("refuses a deduction that would make the balance negative", () => {
    const res = validateXpAdjustment({ direction: "deduct", amount: "101" }, 100);
    expect(res).toMatchObject({ ok: false, field: "amount" });
    if (!res.ok) expect(res.message).toMatch(/100/);
  });

  it("allows deducting exactly down to zero", () => {
    expect(validateXpAdjustment({ direction: "deduct", amount: "100" }, 100)).toMatchObject({
      ok: true,
      delta: -100,
    });
  });

  it("leaves the balance check to the database when the balance is unknown", () => {
    expect(validateXpAdjustment({ direction: "deduct", amount: "500" }).ok).toBe(true);
  });

  it("rejects an over-long reason", () => {
    const res = validateXpAdjustment({
      direction: "add",
      amount: "1",
      reason: "x".repeat(MAX_XP_REASON_LENGTH + 1),
    });
    expect(res).toMatchObject({ ok: false, field: "reason" });
  });

  it("rejects an unknown direction", () => {
    const res = validateXpAdjustment({
      direction: "multiply" as never,
      amount: "1",
    });
    expect(res).toMatchObject({ ok: false, field: "direction" });
  });
});
