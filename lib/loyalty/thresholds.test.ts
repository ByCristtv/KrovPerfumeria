import { describe, expect, it } from "vitest";
import {
  MAX_REQUIRED_XP,
  diffThresholds,
  draftsFromLadder,
  validateThresholds,
  type ThresholdDraft,
} from "./thresholds";
import { RANK_ORDER } from "@/lib/rank";
import { TEST_LADDER } from "@/test/helpers/rankLadder";

/** Drafts for the five ranks from raw values, in level order. */
const drafts = (...values: Array<string | number>): ThresholdDraft[] =>
  RANK_ORDER.map((rank, i) => ({ level: i + 1, rank, value: values[i] }));

const issues = (...values: Array<string | number>) =>
  validateThresholds(drafts(...values)).rows.map((r) => r.issue);

describe("validateThresholds — the initial configuration", () => {
  it("accepts the stored ladder as-is and builds the full payload", () => {
    const result = validateThresholds(draftsFromLadder(TEST_LADDER));
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual([
      { level_number: 1, required_xp: 0 },
      { level_number: 2, required_xp: 1_000 },
      { level_number: 3, required_xp: 5_000 },
      { level_number: 4, required_xp: 10_000 },
      { level_number: 5, required_xp: 18_000 },
    ]);
  });

  it("validates in progression order whatever order the drafts arrive in", () => {
    const shuffled = [...drafts(0, 1, 2, 3, 4)].reverse();
    expect(validateThresholds(shuffled).ok).toBe(true);
  });
});

describe("validateThresholds — strictly increasing", () => {
  it("accepts any strictly increasing ladder, including tight ones", () => {
    expect(validateThresholds(drafts(0, 1, 2, 3, 4)).ok).toBe(true);
    expect(validateThresholds(drafts(0, 800, 1_400, 9_000, MAX_REQUIRED_XP)).ok).toBe(true);
  });

  it("rejects two ranks with the same XP, on the higher rank, naming both", () => {
    const result = validateThresholds(drafts(0, 1_000, 1_000, 10_000, 18_000));
    expect(result.ok).toBe(false);
    expect(result.payload).toBeNull();
    expect(result.rows.map((r) => r.issue)).toEqual([null, null, "not_above_previous", null, null]);
    expect(result.rows[2].message).toMatch(/Coleccionista \(1,000 XP\)/);
    expect(result.rows[2].message).toMatch(/misma XP/);
    expect(result.rows[2].message).toMatch(/Sube Conocedor o baja Coleccionista/);
  });

  it("rejects a rank requiring fewer XP than the one before it", () => {
    expect(issues(0, 1_000, 5_000, 4_999, 18_000)).toEqual([null, null, null, "not_above_previous", null]);
  });

  it("explains the knock-on conflict when raising one rank past the next", () => {
    // Conocedor raised above Alquimista: Alquimista is now the one out of order.
    const result = validateThresholds(drafts(0, 1_000, 12_000, 10_000, 18_000));
    expect(result.rows[3].issue).toBe("not_above_previous");
    expect(result.rows[3].message).toMatch(/mayor que Conocedor \(12,000 XP\)/);
  });

  it("compares each rank with its immediate predecessor (the whole-sequence invariant)", () => {
    // 20,000 then 18,000: Alquimista is fine against Conocedor, Maestro is not.
    expect(issues(0, 1_000, 5_000, 20_000, 18_000)).toEqual([null, null, null, null, "not_above_previous"]);
  });
});

describe("validateThresholds — value rules", () => {
  it.each([
    ["", "required"],
    ["   ", "required"],
    ["-5", "negative"],
    ["1500.5", "not_integer"],
    ["1,000", "not_integer"],
    ["1e3", "not_integer"],
    ["abc", "not_integer"],
    [String(MAX_REQUIRED_XP + 1), "too_large"],
  ])("rejects %j as %s", (value, issue) => {
    const result = validateThresholds(drafts(0, value, 5_000, 10_000, 18_000));
    expect(result.ok).toBe(false);
    expect(result.rows[1].issue).toBe(issue);
    expect(result.rows[1].message).toBeTruthy();
  });

  it("keeps the entry rank at 0", () => {
    const result = validateThresholds(drafts(1, 1_000, 5_000, 10_000, 18_000));
    expect(result.rows[0].issue).toBe("base_not_zero");
    expect(result.rows[0].message).toMatch(/Aficionado es el rango inicial/);
  });

  it("does not let one unreadable field hide another conflict further up", () => {
    expect(issues(0, "x", 5_000, 5_000, 18_000)).toEqual([null, "not_integer", null, "not_above_previous", null]);
  });

  it("refuses an empty proposal", () => {
    expect(validateThresholds([]).ok).toBe(false);
  });
});

describe("diffThresholds", () => {
  it("lists only the ranks whose threshold changes", () => {
    expect(
      diffThresholds(TEST_LADDER, [
        { level_number: 1, required_xp: 0 },
        { level_number: 2, required_xp: 800 },
        { level_number: 3, required_xp: 5_000 },
        { level_number: 4, required_xp: 12_000 },
        { level_number: 5, required_xp: 18_000 },
      ])
    ).toEqual([
      { level: 2, rank: "Coleccionista", from: 1_000, to: 800 },
      { level: 4, rank: "Alquimista", from: 10_000, to: 12_000 },
    ]);
  });
});
