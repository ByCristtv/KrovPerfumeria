import type { Tables } from "@/types/database";

/**
 * Customer rank progression, derived ENTIRELY from a profile's XP.
 *
 * Ranks are never persisted — the database stores only `experience_points`
 * (see migration 20260611000100). Everything here is a pure function of that
 * number, so the UI and any server code share one source of truth.
 *
 * XP rule (mirrors `grant_order_xp` in SQL): 50 XP per full ₡1,000 of an
 * order's total, granted once, only when the order reaches `received`.
 */

export type UserRank = "Fraiche" | "Cologne" | "EDT" | "EDP" | "Parfum";

/** One tier in the ladder. `minXP` is inclusive; the next tier's `minXP` is the cap. */
export interface RankDefinition {
  rank: UserRank;
  minXP: number;
}

/**
 * THE single source of truth for thresholds — no magic numbers anywhere else.
 * Must stay sorted ascending by `minXP`.
 *
 *   Fraiche  0      – 999
 *   Cologne  1,000  – 4,999
 *   EDT      5,000  – 9,999 
 *   EDP      10,000 – 17,999 
 *   Parfum   18,000 + 
 */
export const RANK_THRESHOLDS: readonly RankDefinition[] = [
  { rank: "Fraiche", minXP: 0 },
  { rank: "Cologne", minXP: 1_000 },
  { rank: "EDT", minXP: 5_000 },
  { rank: "EDP", minXP: 10_000 },
  { rank: "Parfum", minXP: 18_000 },
] as const;

/** Full breakdown of where a given XP total sits in the ladder. */
export interface RankInfo {
  currentRank: UserRank;
  /** `null` once the top rank (Parfum) is reached. */
  nextRank: UserRank | null;
  currentXP: number;
  currentRankMinXP: number;
  /** XP at which the next rank unlocks, or `null` at the top rank. */
  nextRankXP: number | null;
  /** XP still needed to reach the next rank; `0` at the top rank. */
  xpRemaining: number;
  /** 0–100 progress toward the next rank; `100` at the top rank. */
  progressPercent: number;
}

/** XP is never negative; clamp defensively so bad data can't break the math. */
function safeXP(xp: number): number {
  return Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
}

/** Resolve the rank a given XP total currently sits in. */
export function getRankFromXP(xp: number): UserRank {
  const value = safeXP(xp);
  // Walk from the top down: first threshold the XP clears wins.
  for (let i = RANK_THRESHOLDS.length - 1; i >= 0; i--) {
    if (value >= RANK_THRESHOLDS[i].minXP) return RANK_THRESHOLDS[i].rank;
  }
  return RANK_THRESHOLDS[0].rank;
}

/** The rank above the current one, or `null` if already at the top. */
export function getNextRank(xp: number): UserRank | null {
  const value = safeXP(xp);
  const next = RANK_THRESHOLDS.find((t) => t.minXP > value);
  return next?.rank ?? null;
}

/** Index of the current rank in {@link RANK_THRESHOLDS}. */
function currentRankIndex(xp: number): number {
  const value = safeXP(xp);
  let index = 0;
  for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
    if (value >= RANK_THRESHOLDS[i].minXP) index = i;
  }
  return index;
}

/**
 * Everything the profile UI needs to render rank + progress in one call.
 *
 * At the top rank: `nextRank`/`nextRankXP` are null, `xpRemaining` is 0, and
 * `progressPercent` is 100 (full bar / "Maximum Rank Reached").
 */
export function getRankInfo(xp: number): RankInfo {
  const currentXP = safeXP(xp);
  const index = currentRankIndex(currentXP);
  const current = RANK_THRESHOLDS[index];
  const next = RANK_THRESHOLDS[index + 1] ?? null;

  if (!next) {
    return {
      currentRank: current.rank,
      nextRank: null,
      currentXP,
      currentRankMinXP: current.minXP,
      nextRankXP: null,
      xpRemaining: 0,
      progressPercent: 100,
    };
  }

  const span = next.minXP - current.minXP;
  const earnedInRank = currentXP - current.minXP;
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((earnedInRank / span) * 100))
  );

  return {
    currentRank: current.rank,
    nextRank: next.rank,
    currentXP,
    currentRankMinXP: current.minXP,
    nextRankXP: next.minXP,
    xpRemaining: Math.max(0, next.minXP - currentXP),
    progressPercent,
  };
}

/**
 * XP earned by an order of the given total — the client-side mirror of the
 * SQL `grant_order_xp` formula. The database remains the source of truth for
 * actually awarding XP; this is for previews/estimates and tests.
 */
export function calculateOrderXp(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.floor(total / 1000) * 50;
}

/** A single audit-log row from `profile_experience_events`. */
export type XpEvent = Tables<"profile_experience_events">;

/** Profile XP data shaped for the UI: the raw balance plus its derived rank. */
export interface ProfileXpData extends RankInfo {
  experiencePoints: number;
}

/** Build {@link ProfileXpData} from a profile's stored XP balance. */
export function getProfileXpData(experiencePoints: number): ProfileXpData {
  return {
    experiencePoints: safeXP(experiencePoints),
    ...getRankInfo(experiencePoints),
  };
}
