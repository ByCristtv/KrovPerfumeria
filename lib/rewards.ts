import { formatPrice } from "@/lib/format";
import {
  RANK_THRESHOLDS,
  getRankInfo,
  type RankInfo,
  type UserRank,
} from "@/lib/rank";

/**
 * What each rank actually BUYS the customer — the redeemable side of the XP
 * ladder that lib/rank.ts models.
 *
 * Deliberately a separate module from `lib/rank.ts`:
 *
 *   - rank.ts answers "which tier is this XP in?" — pure progression maths, used
 *     by the leaderboard, the profile card and (mirrored) by the SQL trigger.
 *   - rewards.ts answers "what does that tier entitle you to?" — commercial
 *     terms that marketing will change on a different clock than the thresholds.
 *
 * Splitting them means a change to a discount percentage cannot accidentally
 * move an XP threshold, and the roadmap below still reads its ranges from
 * RANK_THRESHOLDS, so the two can never disagree about where a tier starts.
 */

/** Minimum order value (CRC) a discount reward can be applied to. */
export const REWARD_MIN_PURCHASE = 25_000;

/** Ceiling (CRC) on the fragrance a Parfum member may claim for free. */
export const FREE_FRAGRANCE_MAX_VALUE = 25_000;

/**
 * The shape of a reward, as structure rather than prose.
 *
 * The Spanish sentence a customer reads is DERIVED from these fields by
 * {@link describeReward}, so the numbers in the copy cannot drift from the
 * numbers any future redemption logic would enforce.
 */
export type RewardKind = "none" | "discount" | "free_fragrance";

export interface RankReward {
  kind: RewardKind;
  /** Percentage off. Only meaningful when `kind` is "discount". */
  discountPercent: number | null;
  /** Minimum purchase the reward requires, or null when it has no floor. */
  minPurchase: number | null;
  /** Value ceiling on a claimed item. Only set for "free_fragrance". */
  maxValue: number | null;
}

const NO_REWARD: RankReward = {
  kind: "none",
  discountPercent: null,
  minPurchase: null,
  maxValue: null,
};

/** A percentage discount gated behind {@link REWARD_MIN_PURCHASE}. */
function discount(percent: number): RankReward {
  return {
    kind: "discount",
    discountPercent: percent,
    minPurchase: REWARD_MIN_PURCHASE,
    maxValue: null,
  };
}

/**
 * Rank → reward. Keyed by UserRank (not an array) so adding a rank to
 * RANK_THRESHOLDS without giving it a reward is a TYPE ERROR here rather than
 * an `undefined` that reaches the UI.
 */
export const RANK_REWARDS: Readonly<Record<UserRank, RankReward>> = {
  Fraiche: NO_REWARD,
  Cologne: discount(5),
  EDT: discount(8),
  EDP: discount(12),
  Parfum: {
    kind: "free_fragrance",
    discountPercent: null,
    minPurchase: null,
    maxValue: FREE_FRAGRANCE_MAX_VALUE,
  },
} as const;

/** The reward a given rank unlocks. */
export function getRewardForRank(rank: UserRank): RankReward {
  return RANK_REWARDS[rank];
}

/** Short headline for a timeline node — a few words, no sentence. */
export function summarizeReward(reward: RankReward): string {
  switch (reward.kind) {
    case "discount":
      return `${reward.discountPercent}% de descuento`;
    case "free_fragrance":
      return "1 fragancia gratis";
    case "none":
      return "Sin recompensa";
  }
}

/** The full terms, as one sentence. Numbers come from the reward, never typed twice. */
export function describeReward(reward: RankReward): string {
  switch (reward.kind) {
    case "discount":
      return `${reward.discountPercent}% de descuento en tu próxima compra superior a ${formatPrice(
        reward.minPurchase ?? REWARD_MIN_PURCHASE
      )}.`;
    case "free_fragrance":
      return `Reclama 1 fragancia gratis con valor menor a ${formatPrice(
        reward.maxValue ?? FREE_FRAGRANCE_MAX_VALUE
      )}.`;
    case "none":
      return "Este es el punto de partida: todavía no hay recompensa para reclamar.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Roadmap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A tier's relationship to the person looking at it.
 *
 * "unknown" is not a fallback for missing data — it is the honest answer for a
 * signed-out visitor, who has no XP and therefore no relationship to any tier.
 * Modelling it explicitly stops the UI from having to guess whether a "locked"
 * tier means "you haven't got there yet" or "we don't know who you are".
 */
export type RoadmapStepStatus = "unlocked" | "current" | "locked" | "unknown";

export interface RewardRoadmapStep {
  rank: UserRank;
  /** Inclusive lower bound, straight from RANK_THRESHOLDS. */
  minXP: number;
  /** Inclusive upper bound, or null at the top rank (open-ended). */
  maxXP: number | null;
  reward: RankReward;
  status: RoadmapStepStatus;
}

/** The viewer's position on the ladder, plus the reward they are working toward. */
export interface RewardsRoadmapViewer extends RankInfo {
  /** Reward already earned at the current rank. */
  currentReward: RankReward;
  /** Reward unlocked by the next rank; null at the top. */
  nextReward: RankReward | null;
}

export interface RewardsRoadmap {
  steps: RewardRoadmapStep[];
  /** null for a signed-out visitor — every step is then "unknown". */
  viewer: RewardsRoadmapViewer | null;
}

/**
 * Build the full ladder, annotated for whoever is looking at it.
 *
 * Ranges are computed from consecutive RANK_THRESHOLDS entries (each tier ends
 * one XP below the next tier's start), so the displayed "1.000 – 4.999" can
 * never contradict the rank a given XP total actually resolves to.
 *
 * Pass `null` for a signed-out visitor: the ladder still renders in full — it is
 * a marketing artefact as much as a progress tracker — with no tier highlighted.
 */
export function buildRewardsRoadmap(xp: number | null): RewardsRoadmap {
  const info = xp === null ? null : getRankInfo(xp);

  const steps: RewardRoadmapStep[] = RANK_THRESHOLDS.map((tier, index) => {
    const next = RANK_THRESHOLDS[index + 1] ?? null;

    return {
      rank: tier.rank,
      minXP: tier.minXP,
      maxXP: next ? next.minXP - 1 : null,
      reward: getRewardForRank(tier.rank),
      status: resolveStatus(info, tier.rank, tier.minXP),
    };
  });

  if (!info) return { steps, viewer: null };

  return {
    steps,
    viewer: {
      ...info,
      currentReward: getRewardForRank(info.currentRank),
      nextReward: info.nextRank ? getRewardForRank(info.nextRank) : null,
    },
  };
}

function resolveStatus(
  info: RankInfo | null,
  rank: UserRank,
  minXP: number
): RoadmapStepStatus {
  if (!info) return "unknown";
  if (info.currentRank === rank) return "current";
  // Comparing XP against the tier's own floor (rather than comparing rank
  // indices) keeps this correct no matter how RANK_THRESHOLDS is ordered or
  // extended later.
  return info.currentXP >= minXP ? "unlocked" : "locked";
}
