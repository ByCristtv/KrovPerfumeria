import type { RankLadder } from "@/lib/rank";
import {
  groupRewardsByLevel,
  type AdminRewardDefinition,
  type RewardDefinition,
} from "@/lib/loyalty/types";
import type { RewardsProgram } from "@/features/loyalty/getRewardsProgram";
import { TEST_LADDER } from "./rankLadder";

let seq = 0;

/** A reward definition; defaults mirror the seeded rewards (percentage, ₡20,000 minimum). */
export function reward(level: number, discountValue: number, overrides: Partial<RewardDefinition> = {}): RewardDefinition {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    code: `L${level}-${discountValue}-${seq}`,
    name: `Cupón nivel ${level}`,
    description: null,
    discountType: "percentage",
    discountValue,
    maxDiscountAmount: null,
    minOrderSubtotal: 20_000,
    level,
    validDays: null,
    isActive: true,
    updatedAt: "2026-11-01T10:00:00.123456+00:00",
    ...overrides,
  };
}

export function adminReward(
  level: number,
  discountValue: number,
  overrides: Partial<AdminRewardDefinition> = {}
): AdminRewardDefinition {
  return {
    ...reward(level, discountValue, overrides),
    createdAt: "2026-10-05T10:04:41.096296+00:00",
    issuedCount: 0,
    ...overrides,
  };
}

/** The seeded programme: Aficionado none, then 5 / 8 / 12 / 18 %. */
export function seedRewards(): RewardDefinition[] {
  return [reward(2, 5), reward(3, 8), reward(4, 12), reward(5, 18)];
}

export function program(
  rewards: RewardDefinition[] = seedRewards(),
  ladder: RankLadder = TEST_LADDER
): RewardsProgram {
  return { ladder, rewardsByLevel: groupRewardsByLevel(rewards) };
}
