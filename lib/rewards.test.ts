import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format";
import { RANK_THRESHOLDS, getRankFromXP, type UserRank } from "@/lib/rank";
import {
  FREE_FRAGRANCE_MAX_VALUE,
  RANK_REWARDS,
  REWARD_MIN_PURCHASE,
  buildRewardsRoadmap,
  describeReward,
  getRewardForRank,
  summarizeReward,
} from "@/lib/rewards";

/** The terms as specified, kept here as an independent restatement. */
const SPEC: Array<{
  rank: UserRank;
  min: number;
  max: number | null;
  percent: number | null;
}> = [
  { rank: "Fraiche", min: 0, max: 999, percent: null },
  { rank: "Cologne", min: 1_000, max: 4_999, percent: 5 },
  { rank: "EDT", min: 5_000, max: 9_999, percent: 8 },
  { rank: "EDP", min: 10_000, max: 17_999, percent: 12 },
  { rank: "Parfum", min: 18_000, max: null, percent: null },
];

describe("RANK_REWARDS", () => {
  it("covers every rank on the ladder, with no extras", () => {
    expect(Object.keys(RANK_REWARDS).sort()).toEqual(
      RANK_THRESHOLDS.map((t) => t.rank).sort()
    );
  });

  it("gives Fraiche no reward", () => {
    expect(getRewardForRank("Fraiche").kind).toBe("none");
  });

  it.each(SPEC.filter((s) => s.percent !== null))(
    "gives $rank a $percent% discount gated at the minimum purchase",
    ({ rank, percent }) => {
      const reward = getRewardForRank(rank);
      expect(reward.kind).toBe("discount");
      expect(reward.discountPercent).toBe(percent);
      expect(reward.minPurchase).toBe(REWARD_MIN_PURCHASE);
    }
  );

  it("gives Parfum a free fragrance under the value ceiling", () => {
    const reward = getRewardForRank("Parfum");
    expect(reward.kind).toBe("free_fragrance");
    expect(reward.maxValue).toBe(FREE_FRAGRANCE_MAX_VALUE);
    expect(reward.discountPercent).toBeNull();
  });

  it("uses 25.000 CRC for both the discount floor and the free-fragrance ceiling", () => {
    expect(REWARD_MIN_PURCHASE).toBe(25_000);
    expect(FREE_FRAGRANCE_MAX_VALUE).toBe(25_000);
  });
});

describe("reward copy", () => {
  /**
   * Asserted through formatPrice rather than a literal "₡25.000": the es-CR
   * group separator is whatever the running ICU says it is (a narrow no-break
   * space on current Node/Chrome), and pinning it here would make the suite
   * fail on an ICU upgrade without anything being wrong.
   */
  const MIN_PURCHASE_TEXT = formatPrice(25_000);

  it("summarizes a discount as a percentage", () => {
    expect(summarizeReward(getRewardForRank("EDT"))).toBe("8% de descuento");
  });

  it("summarizes the top reward as a free fragrance", () => {
    expect(summarizeReward(getRewardForRank("Parfum"))).toBe(
      "1 fragancia gratis"
    );
  });

  it("states the discount percentage and the minimum purchase together", () => {
    const text = describeReward(getRewardForRank("EDP"));
    expect(text).toContain("12%");
    expect(text).toContain(MIN_PURCHASE_TEXT);
  });

  it("states the free fragrance's value ceiling", () => {
    const text = describeReward(getRewardForRank("Parfum"));
    expect(text).toMatch(/fragancia/i);
    expect(text).toContain(MIN_PURCHASE_TEXT);
  });

  it("says plainly that the starting tier has no reward", () => {
    expect(describeReward(getRewardForRank("Fraiche"))).toMatch(
      /todavía no hay recompensa/i
    );
  });
});

describe("buildRewardsRoadmap — tier ranges", () => {
  it("renders the ladder in ascending order", () => {
    const { steps } = buildRewardsRoadmap(0);
    expect(steps.map((s) => s.rank)).toEqual(SPEC.map((s) => s.rank));
  });

  it.each(SPEC)(
    "spans $rank from $min to $max",
    ({ rank, min, max }) => {
      const step = buildRewardsRoadmap(0).steps.find((s) => s.rank === rank)!;
      expect(step.minXP).toBe(min);
      expect(step.maxXP).toBe(max);
    }
  );

  it("leaves the top tier open-ended", () => {
    const top = buildRewardsRoadmap(0).steps.at(-1)!;
    expect(top.rank).toBe("Parfum");
    expect(top.maxXP).toBeNull();
  });

  it("produces ranges that agree with getRankFromXP at every boundary", () => {
    // The bug this guards: a displayed range drifting from the rank the same XP
    // actually resolves to.
    for (const step of buildRewardsRoadmap(0).steps) {
      expect(getRankFromXP(step.minXP)).toBe(step.rank);
      if (step.maxXP !== null) {
        expect(getRankFromXP(step.maxXP)).toBe(step.rank);
        expect(getRankFromXP(step.maxXP + 1)).not.toBe(step.rank);
      }
    }
  });
});

describe("buildRewardsRoadmap — viewer status", () => {
  const statusesAt = (xp: number) =>
    Object.fromEntries(
      buildRewardsRoadmap(xp).steps.map((s) => [s.rank, s.status])
    );

  it("marks exactly one tier as current for any XP total", () => {
    for (const xp of [0, 999, 1_000, 4_999, 5_000, 9_999, 10_000, 17_999, 18_000, 90_000]) {
      const current = buildRewardsRoadmap(xp).steps.filter(
        (s) => s.status === "current"
      );
      expect(current).toHaveLength(1);
      expect(current[0].rank).toBe(getRankFromXP(xp));
    }
  });

  it("marks a brand-new customer as current at Fraiche and locks everything above", () => {
    expect(statusesAt(0)).toEqual({
      Fraiche: "current",
      Cologne: "locked",
      EDT: "locked",
      EDP: "locked",
      Parfum: "locked",
    });
  });

  it("marks passed tiers unlocked and future tiers locked mid-ladder", () => {
    expect(statusesAt(12_000)).toEqual({
      Fraiche: "unlocked",
      Cologne: "unlocked",
      EDT: "unlocked",
      EDP: "current",
      Parfum: "locked",
    });
  });

  it("unlocks the whole ladder at the top rank", () => {
    expect(statusesAt(25_000)).toEqual({
      Fraiche: "unlocked",
      Cologne: "unlocked",
      EDT: "unlocked",
      EDP: "unlocked",
      Parfum: "current",
    });
  });

  it("promotes exactly at a threshold, not one XP early", () => {
    expect(statusesAt(999).Cologne).toBe("locked");
    expect(statusesAt(1_000).Cologne).toBe("current");
  });

  it("reports every tier as unknown for a signed-out visitor", () => {
    const roadmap = buildRewardsRoadmap(null);
    expect(roadmap.viewer).toBeNull();
    expect(roadmap.steps.every((s) => s.status === "unknown")).toBe(true);
  });

  it("still lists the full ladder for a signed-out visitor", () => {
    expect(buildRewardsRoadmap(null).steps).toHaveLength(SPEC.length);
  });
});

describe("buildRewardsRoadmap — viewer progress", () => {
  it("exposes the reward held now and the one being worked toward", () => {
    const { viewer } = buildRewardsRoadmap(6_000);
    expect(viewer?.currentRank).toBe("EDT");
    expect(viewer?.currentReward.discountPercent).toBe(8);
    expect(viewer?.nextRank).toBe("EDP");
    expect(viewer?.nextReward?.discountPercent).toBe(12);
  });

  it("reports the XP still needed for the next reward", () => {
    const { viewer } = buildRewardsRoadmap(4_000);
    expect(viewer?.xpRemaining).toBe(1_000);
    expect(viewer?.nextRank).toBe("EDT");
  });

  it("has no next reward at the top rank", () => {
    const { viewer } = buildRewardsRoadmap(20_000);
    expect(viewer?.nextRank).toBeNull();
    expect(viewer?.nextReward).toBeNull();
    expect(viewer?.progressPercent).toBe(100);
  });

  it("clamps nonsense XP to the starting tier instead of throwing", () => {
    expect(buildRewardsRoadmap(-500).viewer?.currentRank).toBe("Fraiche");
    expect(buildRewardsRoadmap(Number.NaN).viewer?.currentRank).toBe("Fraiche");
  });
});
