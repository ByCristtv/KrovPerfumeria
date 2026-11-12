import { describe, expect, it } from "vitest";
import {
  RANK_ORDER,
  RankLadderError,
  getNextRank,
  getProfileXpData,
  getRankFromXP,
  getRankInfo,
  getTierByLevel,
  parseRankLadder,
  type LevelRow,
} from "@/lib/rank";
import { SEED_LEVEL_ROWS, TEST_LADDER, ladderWith } from "@/test/helpers/rankLadder";

const rows = (): LevelRow[] => SEED_LEVEL_ROWS.map((r) => ({ ...r }));

describe("parseRankLadder", () => {
  it("builds the ladder from public.levels rows, in level order", () => {
    const shuffled = [rows()[3], rows()[0], rows()[4], rows()[2], rows()[1]];
    expect(parseRankLadder(shuffled).map((t) => [t.level, t.rank, t.minXP])).toEqual([
      [1, "Aficionado", 0],
      [2, "Coleccionista", 1_000],
      [3, "Conocedor", 5_000],
      [4, "Alquimista", 10_000],
      [5, "Maestro", 18_000],
    ]);
  });

  it("rejects a ladder whose entry level is not 0", () => {
    const r = rows();
    r[0].required_xp = 10;
    expect(() => parseRankLadder(r)).toThrow(RankLadderError);
  });

  it.each([
    ["equal", 1_000],
    ["lower", 999],
  ])("rejects a %s threshold than the previous rank", (_label, xp) => {
    const r = rows();
    r[2].required_xp = xp; // Conocedor vs Coleccionista's 1,000
    expect(() => parseRankLadder(r)).toThrow(/Level 3/);
  });

  it("rejects unknown, renamed or missing ranks instead of guessing", () => {
    const renamed = rows();
    renamed[1].name = "Coleccionador";
    expect(() => parseRankLadder(renamed)).toThrow(RankLadderError);
    expect(() => parseRankLadder(rows().slice(0, 4))).toThrow(RankLadderError);
    expect(() => parseRankLadder([])).toThrow(RankLadderError);
  });

  it("rejects non-integer or negative thresholds", () => {
    const r = rows();
    r[1].required_xp = 1_000.5;
    expect(() => parseRankLadder(r)).toThrow(RankLadderError);
  });

  it("expects exactly the known ranks in progression order", () => {
    expect(TEST_LADDER.map((t) => t.rank)).toEqual(RANK_ORDER);
  });
});

describe("getRankFromXP — exact boundaries of the seeded ladder", () => {
  it.each(TEST_LADDER.slice(1).map((t, i) => [t.rank, TEST_LADDER[i].rank, t.minXP] as const))(
    "%s: one below stays %s, at and above promote",
    (rank, previous, threshold) => {
      expect(getRankFromXP(threshold - 1, TEST_LADDER)).toBe(previous);
      expect(getRankFromXP(threshold, TEST_LADDER)).toBe(rank);
      expect(getRankFromXP(threshold + 1, TEST_LADDER)).toBe(rank);
    }
  );
});

describe("after an admin changes the thresholds", () => {
  const edited = ladderWith([0, 800, 1_400, 9_000, 20_000]);

  it.each(edited.slice(1).map((t, i) => [t.rank, edited[i].rank, t.minXP] as const))(
    "%s now starts at its new threshold (one below = %s)",
    (rank, previous, threshold) => {
      expect(getRankFromXP(threshold - 1, edited)).toBe(previous);
      expect(getRankFromXP(threshold, edited)).toBe(rank);
      expect(getRankFromXP(threshold + 1, edited)).toBe(rank);
    }
  );

  it("re-derives the rank of the same XP — nothing is stored", () => {
    expect(getRankFromXP(1_500, TEST_LADDER)).toBe("Coleccionista");
    expect(getRankFromXP(1_500, edited)).toBe("Conocedor");
    expect(getRankFromXP(19_000, TEST_LADDER)).toBe("Maestro");
    expect(getRankFromXP(19_000, edited)).toBe("Alquimista");
  });

  it("measures progress and the next rank against the new ladder", () => {
    const info = getRankInfo(1_100, edited);
    expect(info).toMatchObject({
      currentRank: "Coleccionista",
      nextRank: "Conocedor",
      currentRankMinXP: 800,
      nextRankXP: 1_400,
      xpRemaining: 300,
      progressPercent: 50,
    });
    expect(getNextRank(1_100, edited)).toBe("Conocedor");
  });
});

describe("getRankInfo", () => {
  it("is full and has no next rank at the top", () => {
    expect(getRankInfo(40_000, TEST_LADDER)).toMatchObject({
      currentRank: "Maestro",
      nextRank: null,
      nextRankXP: null,
      xpRemaining: 0,
      progressPercent: 100,
    });
  });

  it("clamps invalid XP to 0", () => {
    expect(getRankInfo(-10, TEST_LADDER).currentXP).toBe(0);
    expect(getRankInfo(Number.NaN, TEST_LADDER).currentRank).toBe("Aficionado");
    expect(getProfileXpData(Number.POSITIVE_INFINITY, TEST_LADDER).experiencePoints).toBe(0);
  });
});

describe("getTierByLevel", () => {
  it("finds a tier by level_number", () => {
    expect(getTierByLevel(TEST_LADDER, 4)?.rank).toBe("Alquimista");
    expect(getTierByLevel(TEST_LADDER, 9)).toBeUndefined();
  });
});
