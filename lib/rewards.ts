import { formatPrice } from "@/lib/format";
import { describeBenefit } from "@/lib/coupons/discount";
import { getRankInfo, type RankInfo, type RankLadder, type UserRank } from "@/lib/rank";
import type { RewardDefinition, RewardsByLevel } from "@/lib/loyalty/types";

/**
 * What each rank BUYS the customer — the redeemable side of the XP ladder.
 *
 * Nothing here is configuration any more. The thresholds come from
 * `public.levels` and the rewards from the ACTIVE `public.coupons` definitions,
 * both edited from /admin/rewards; this module only turns them into a roadmap
 * and into Spanish copy. The copy is DERIVED from the same fields
 * `apply_order_coupon` enforces, so the text can never promise a percentage or
 * a minimum the database does not apply.
 *
 * A rank may carry several rewards (each an independent coupon) or none.
 */

/** Rewards a level hands out, in creation order (empty = none). */
export function rewardsForLevel(rewardsByLevel: RewardsByLevel, level: number): readonly RewardDefinition[] {
  return rewardsByLevel[level] ?? [];
}

/** Short headline for a timeline node — a few words, no sentence. */
export function summarizeRewards(rewards: readonly RewardDefinition[]): string {
  if (rewards.length === 0) return "Sin recompensa";
  if (rewards.length === 1) return describeBenefit(rewards[0]);

  if (rewards.every((r) => r.discountType === "percentage")) {
    const values = rewards.map((r) => `${r.discountValue}%`);
    return `Cupones de ${joinSpanish(values)} de descuento`;
  }
  return `${rewards.length} cupones de descuento`;
}

/** The full terms of one reward, as one sentence. Numbers come from the reward, never typed twice. */
export function describeReward(reward: RewardDefinition): string {
  const minimum =
    reward.minOrderSubtotal > 0
      ? `, en una compra mínima de ${formatPrice(reward.minOrderSubtotal)}`
      : ", sin compra mínima";
  let sentence = `Cupón de ${describeBenefit(reward)}, de un solo uso${minimum}.`;
  if (reward.maxDiscountAmount !== null) {
    sentence += ` Descuento máximo de ${formatPrice(reward.maxDiscountAmount)}.`;
  }
  if (reward.validDays !== null) {
    sentence += ` Vence ${reward.validDays} ${reward.validDays === 1 ? "día" : "días"} después de desbloquearlo.`;
  }
  return sentence;
}

/** Copy for a rank with no reward. */
export const NO_REWARD_DESCRIPTION =
  "Este es el punto de partida: todavía no hay recompensa para reclamar.";

/** "a", "a y b", "a, b y c". */
function joinSpanish(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Roadmap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A tier's relationship to the person looking at it.
 *
 * "unknown" is not a fallback for missing data — it is the honest answer for a
 * signed-out visitor, who has no XP and therefore no relationship to any tier.
 */
export type RoadmapStepStatus = "unlocked" | "current" | "locked" | "unknown";

export interface RewardRoadmapStep {
  level: number;
  rank: UserRank;
  /** Inclusive lower bound, from the configured ladder. */
  minXP: number;
  /** Inclusive upper bound, or null at the top rank (open-ended). */
  maxXP: number | null;
  rewards: readonly RewardDefinition[];
  status: RoadmapStepStatus;
}

/** The viewer's position on the ladder, plus the rewards they are working toward. */
export interface RewardsRoadmapViewer extends RankInfo {
  /** Rewards of the current rank. */
  currentRewards: readonly RewardDefinition[];
  /** Rewards unlocked by the next rank; null at the top. */
  nextRewards: readonly RewardDefinition[] | null;
}

export interface RewardsRoadmap {
  steps: RewardRoadmapStep[];
  /** null for a signed-out visitor — every step is then "unknown". */
  viewer: RewardsRoadmapViewer | null;
}

/**
 * Build the full ladder, annotated for whoever is looking at it.
 *
 * Ranges are computed from consecutive tiers (each ends one XP below the next
 * tier's start), so the displayed "1.000 – 4.999" can never contradict the rank
 * a given XP total actually resolves to.
 */
export function buildRewardsRoadmap(
  xp: number | null,
  ladder: RankLadder,
  rewardsByLevel: RewardsByLevel
): RewardsRoadmap {
  const info = xp === null ? null : getRankInfo(xp, ladder);

  const steps: RewardRoadmapStep[] = ladder.map((tier, index) => {
    const next = ladder[index + 1] ?? null;
    return {
      level: tier.level,
      rank: tier.rank,
      minXP: tier.minXP,
      maxXP: next ? next.minXP - 1 : null,
      rewards: rewardsForLevel(rewardsByLevel, tier.level),
      status: resolveStatus(info, tier.rank, tier.minXP),
    };
  });

  if (!info) return { steps, viewer: null };

  const levelOf = (rank: UserRank) => ladder.find((t) => t.rank === rank)?.level ?? 0;

  return {
    steps,
    viewer: {
      ...info,
      currentRewards: rewardsForLevel(rewardsByLevel, levelOf(info.currentRank)),
      nextRewards: info.nextRank ? rewardsForLevel(rewardsByLevel, levelOf(info.nextRank)) : null,
    },
  };
}

function resolveStatus(info: RankInfo | null, rank: UserRank, minXP: number): RoadmapStepStatus {
  if (!info) return "unknown";
  if (info.currentRank === rank) return "current";
  return info.currentXP >= minXP ? "unlocked" : "locked";
}
