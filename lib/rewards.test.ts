import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format";
import { getRankFromXP, type UserRank } from "@/lib/rank";
import {
  NO_REWARD_DESCRIPTION,
  buildRewardsRoadmap,
  describeReward,
  summarizeRewards,
} from "@/lib/rewards";
import { groupRewardsByLevel } from "@/lib/loyalty/types";
import { TEST_LADDER, ladderWith } from "@/test/helpers/rankLadder";
import { reward, seedRewards } from "@/test/helpers/rewardsFixtures";

/**
 * The roadmap is a pure function of (XP, ladder, rewards) — all three come from
 * the database. These tests feed it the seeded configuration and edited ones,
 * and check it never invents a number of its own.
 */
const SEEDED = groupRewardsByLevel(seedRewards());

const SPEC: Array<{ rank: UserRank; min: number; max: number | null }> = [
  { rank: "Aficionado", min: 0, max: 999 },
  { rank: "Coleccionista", min: 1_000, max: 4_999 },
  { rank: "Conocedor", min: 5_000, max: 9_999 },
  { rank: "Alquimista", min: 10_000, max: 17_999 },
  { rank: "Maestro", min: 18_000, max: null },
];

describe("summarizeRewards", () => {
  it("says so when a rank hands out nothing", () => {
    expect(summarizeRewards([])).toBe("Sin recompensa");
  });

  it("states a single reward's benefit", () => {
    expect(summarizeRewards([reward(3, 8)])).toBe("8% de descuento");
    expect(summarizeRewards([reward(3, 5_000, { discountType: "fixed" })])).toBe(
      `${formatPrice(5_000)} de descuento`
    );
  });

  it("lists every percentage of a rank with several rewards", () => {
    expect(summarizeRewards([reward(4, 10), reward(4, 15), reward(4, 20)])).toBe(
      "Cupones de 10%, 15% y 20% de descuento"
    );
    expect(summarizeRewards([reward(4, 10), reward(4, 15)])).toBe("Cupones de 10% y 15% de descuento");
  });

  it("counts mixed reward types instead of mixing units in one phrase", () => {
    expect(summarizeRewards([reward(4, 10), reward(4, 5_000, { discountType: "fixed" })])).toBe(
      "2 cupones de descuento"
    );
  });
});

describe("describeReward", () => {
  it("derives every number from the definition", () => {
    const text = describeReward(reward(4, 12, { minOrderSubtotal: 25_000 }));
    expect(text).toContain("12% de descuento");
    expect(text).toContain(formatPrice(25_000));
    expect(text).toMatch(/un solo uso/);
  });

  it("mentions a cap and an expiry only when configured", () => {
    const plain = describeReward(reward(4, 12));
    expect(plain).not.toMatch(/máximo|Vence/);

    const full = describeReward(reward(4, 12, { maxDiscountAmount: 30_000, validDays: 1 }));
    expect(full).toContain(`Descuento máximo de ${formatPrice(30_000)}`);
    expect(full).toContain("Vence 1 día después");
  });

  it("says there is no minimum when the minimum is 0", () => {
    expect(describeReward(reward(2, 5, { minOrderSubtotal: 0 }))).toMatch(/sin compra mínima/);
  });

  it("has a starting-point sentence for rewardless ranks", () => {
    expect(NO_REWARD_DESCRIPTION).toMatch(/punto de partida/);
  });
});

describe("buildRewardsRoadmap — tier ranges", () => {
  it("lists every tier of the ladder, in order, with its range", () => {
    const { steps } = buildRewardsRoadmap(0, TEST_LADDER, SEEDED);
    expect(steps.map((s) => ({ rank: s.rank, min: s.minXP, max: s.maxXP }))).toEqual(SPEC);
  });

  it("produces ranges that agree with getRankFromXP at every boundary", () => {
    for (const step of buildRewardsRoadmap(0, TEST_LADDER, SEEDED).steps) {
      expect(getRankFromXP(step.minXP, TEST_LADDER)).toBe(step.rank);
      if (step.maxXP !== null) {
        expect(getRankFromXP(step.maxXP, TEST_LADDER)).toBe(step.rank);
        expect(getRankFromXP(step.maxXP + 1, TEST_LADDER)).not.toBe(step.rank);
      }
    }
  });

  it("follows an edited ladder exactly", () => {
    const ladder = ladderWith([0, 500, 2_000, 9_000, 30_000]);
    const { steps } = buildRewardsRoadmap(null, ladder, SEEDED);
    expect(steps.map((s) => [s.minXP, s.maxXP])).toEqual([
      [0, 499],
      [500, 1_999],
      [2_000, 8_999],
      [9_000, 29_999],
      [30_000, null],
    ]);
  });

  it("attaches each level's rewards to its tier — several, one or none", () => {
    const rewards = groupRewardsByLevel([reward(4, 10), reward(4, 15), reward(2, 5)]);
    const { steps } = buildRewardsRoadmap(null, TEST_LADDER, rewards);
    expect(steps.map((s) => s.rewards.map((r) => r.discountValue))).toEqual([[], [5], [], [10, 15], []]);
  });
});

describe("buildRewardsRoadmap — viewer status", () => {
  const statusesAt = (xp: number) =>
    Object.fromEntries(buildRewardsRoadmap(xp, TEST_LADDER, SEEDED).steps.map((s) => [s.rank, s.status]));

  it("has exactly one current tier, the one the XP resolves to", () => {
    for (const xp of [0, 999, 1_000, 4_999, 5_000, 17_999, 18_000, 60_000]) {
      const current = buildRewardsRoadmap(xp, TEST_LADDER, SEEDED).steps.filter((s) => s.status === "current");
      expect(current).toHaveLength(1);
      expect(current[0].rank).toBe(getRankFromXP(xp, TEST_LADDER));
    }
  });

  it("marks passed tiers unlocked and future tiers locked mid-ladder", () => {
    expect(statusesAt(12_000)).toEqual({
      Aficionado: "unlocked",
      Coleccionista: "unlocked",
      Conocedor: "unlocked",
      Alquimista: "current",
      Maestro: "locked",
    });
  });

  it("promotes exactly at a threshold, not one XP early", () => {
    expect(statusesAt(999).Coleccionista).toBe("locked");
    expect(statusesAt(1_000).Coleccionista).toBe("current");
  });

  it("reports every tier as unknown for a signed-out visitor, but lists them all", () => {
    const roadmap = buildRewardsRoadmap(null, TEST_LADDER, SEEDED);
    expect(roadmap.viewer).toBeNull();
    expect(roadmap.steps).toHaveLength(SPEC.length);
    expect(roadmap.steps.every((s) => s.status === "unknown")).toBe(true);
  });
});

describe("buildRewardsRoadmap — viewer progress", () => {
  it("names the current and the next rank's rewards", () => {
    const { viewer } = buildRewardsRoadmap(6_000, TEST_LADDER, SEEDED);
    expect(viewer?.currentRank).toBe("Conocedor");
    expect(viewer?.currentRewards.map((r) => r.discountValue)).toEqual([8]);
    expect(viewer?.nextRewards?.map((r) => r.discountValue)).toEqual([12]);
    expect(viewer?.xpRemaining).toBe(4_000);
  });

  it("has no next rewards at the top", () => {
    const { viewer } = buildRewardsRoadmap(20_000, TEST_LADDER, SEEDED);
    expect(viewer?.nextRank).toBeNull();
    expect(viewer?.nextRewards).toBeNull();
  });

  it("clamps nonsense XP to the entry rank", () => {
    expect(buildRewardsRoadmap(-500, TEST_LADDER, SEEDED).viewer?.currentRank).toBe("Aficionado");
    expect(buildRewardsRoadmap(Number.NaN, TEST_LADDER, SEEDED).viewer?.currentRank).toBe("Aficionado");
  });
});
