import { describe, expect, it } from "vitest";
import { isMissingMigrationError, loyaltyErrorMessage, parseLoyaltyError } from "./errors";

describe("parseLoyaltyError", () => {
  it("reads a bare code", () => {
    expect(parseLoyaltyError("levels_stale")).toEqual({ code: "levels_stale" });
    expect(parseLoyaltyError("reward_has_issued_coupons")).toEqual({ code: "reward_has_issued_coupons" });
  });

  it("reads the level a threshold error carries", () => {
    expect(parseLoyaltyError("levels_not_increasing:3")).toEqual({ code: "levels_not_increasing", level: 3 });
  });

  it("ignores anything that is not part of the contract", () => {
    expect(parseLoyaltyError('relation "levels" does not exist')).toBeNull();
    expect(parseLoyaltyError("")).toBeNull();
    expect(parseLoyaltyError(undefined)).toBeNull();
  });
});

describe("loyaltyErrorMessage", () => {
  it("names the rank of a threshold conflict and says nothing was saved", () => {
    const message = loyaltyErrorMessage({ code: "levels_not_increasing", level: 3 }, (l) =>
      l === 3 ? "Conocedor" : undefined
    );
    expect(message).toMatch(/^Conocedor debe requerir más XP/);
    expect(message).toMatch(/No se guardó ningún cambio/);
  });

  it("tells the admin to deactivate instead of delete once a reward was issued", () => {
    expect(loyaltyErrorMessage({ code: "reward_has_issued_coupons" })).toMatch(/Desactívala/);
  });

  it("explains a stale form", () => {
    expect(loyaltyErrorMessage({ code: "levels_stale" })).toMatch(/Otro administrador/);
  });
});

describe("isMissingMigrationError", () => {
  it("recognises PostgREST's missing-function and Postgres' undefined-object errors", () => {
    expect(isMissingMigrationError({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isMissingMigrationError({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingMigrationError({ code: "P0001", message: "levels_stale" })).toBe(false);
    expect(isMissingMigrationError(null)).toBe(false);
  });
});
