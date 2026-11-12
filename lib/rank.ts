import type { Tables } from "@/types/database";

/**
 * Customer rank progression, derived ENTIRELY from a profile's XP.
 *
 * Ranks are never persisted — the database stores only `experience_points`.
 * WHERE each rank starts is configuration that lives in ONE place: the
 * `public.levels` table (`required_xp`), which administrators edit from
 * /admin/rewards and which the database's reward-issuance functions read too.
 * This module holds no threshold numbers at all: every function takes the
 * {@link RankLadder} loaded from that table (see features/loyalty/rankLadder.ts
 * on the server and `useRankLadder()` in the browser), so the UI, the server
 * and SQL can never disagree about where "Alquimista" starts.
 *
 * What DOES live here is each rank's identity — its name and progression order
 * — and its presentation (badge file). Those are code, not configuration: a new
 * rank needs a badge and styles before it can be shown.
 *
 * XP rule (mirrors `grant_order_xp` in SQL): 50 XP per full ₡1,000 of an
 * order's DISCOUNTED SUBTOTAL (goods minus any coupon; shipping and tax never
 * count), granted once, only when the order reaches `received`.
 */

export type UserRank =
  | "Aficionado"
  | "Coleccionista"
  | "Conocedor"
  | "Alquimista"
  | "Maestro";

/**
 * The ranks in progression order (level 1 first). Identity only — the XP each
 * one requires comes from the database. `public.levels` must hold exactly these
 * names in this order; {@link parseRankLadder} refuses anything else.
 */
export const RANK_ORDER: readonly UserRank[] = [
  "Aficionado",
  "Coleccionista",
  "Conocedor",
  "Alquimista",
  "Maestro",
] as const;

/** Badge file per rank, inside {@link RANK_ICON_PATH}. */
const RANK_ICONS: Readonly<Record<UserRank, string>> = {
  Aficionado: "Aficionado.avif",
  Coleccionista: "Coleccionista.avif",
  Conocedor: "Conocedor.avif",
  Alquimista: "Alquimista.avif",
  Maestro: "Krov.avif",
};

/** Folder under `public/` holding the rank badges, 192px for a 96px maximum box. */
export const RANK_ICON_PATH = "/ranks";

/** One tier of the configured ladder. `minXP` is inclusive. */
export interface RankTier {
  /** `levels.level_number` — 1 for the entry rank. */
  level: number;
  rank: UserRank;
  minXP: number;
}

/**
 * The ladder as configured in `public.levels`: sorted by level, lowest tier at
 * 0 XP, strictly increasing. Only {@link parseRankLadder} produces one.
 */
export type RankLadder = readonly RankTier[];

/** The `public.levels` columns the ladder is built from. */
export type LevelRow = Pick<Tables<"levels">, "level_number" | "name" | "required_xp">;

/** The stored ladder does not have the shape every invariant here relies on. */
export class RankLadderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RankLadderError";
  }
}

export function isUserRank(value: unknown): value is UserRank {
  return typeof value === "string" && (RANK_ORDER as readonly string[]).includes(value);
}

/**
 * Validate `public.levels` rows and turn them into a {@link RankLadder}.
 *
 * Strict on purpose — the same invariants the database enforces
 * (trg_levels_enforce_ladder): lowest level at 0 XP and strictly increasing
 * thresholds. On top of that the names must be exactly {@link RANK_ORDER}, in
 * order, because badges and styles are keyed by name. A ladder that fails any
 * of this throws instead of being "repaired", so a drifted database surfaces as
 * an error rather than as customers silently shown the wrong rank.
 */
export function parseRankLadder(rows: readonly LevelRow[]): RankLadder {
  const sorted = [...rows].sort((a, b) => a.level_number - b.level_number);

  if (sorted.length !== RANK_ORDER.length) {
    throw new RankLadderError(
      `Expected ${RANK_ORDER.length} levels, got ${sorted.length}.`
    );
  }

  return sorted.map((row, index) => {
    const expected = RANK_ORDER[index];
    if (row.name !== expected) {
      throw new RankLadderError(
        `Level ${row.level_number} is "${row.name}", expected "${expected}".`
      );
    }
    if (!Number.isInteger(row.required_xp) || row.required_xp < 0) {
      throw new RankLadderError(`Level ${row.level_number} has an invalid threshold.`);
    }
    if (index === 0 && row.required_xp !== 0) {
      throw new RankLadderError("The entry level must require 0 XP.");
    }
    if (index > 0 && row.required_xp <= sorted[index - 1].required_xp) {
      throw new RankLadderError(
        `Level ${row.level_number} must require more XP than level ${sorted[index - 1].level_number}.`
      );
    }
    return { level: row.level_number, rank: expected, minXP: row.required_xp };
  });
}

/**
 * Site path of a rank's badge. Returns null for an unknown rank, and the badge
 * falls back to a monogram.
 */
export function getRankIconUrl(rank: UserRank): string | null {
  const icon = RANK_ICONS[rank];
  return icon ? `${RANK_ICON_PATH}/${icon}` : null;
}

/** 1-based position of a rank on the ladder (Aficionado 1 … Maestro 5). */
export function getRankLevel(rank: UserRank): number {
  return RANK_ORDER.indexOf(rank) + 1;
}

/** The tier with this `level_number`, or undefined. */
export function getTierByLevel(
  ladder: RankLadder,
  level: number
): RankTier | undefined {
  return ladder.find((tier) => tier.level === level);
}

/** Full breakdown of where a given XP total sits in the ladder. */
export interface RankInfo {
  currentRank: UserRank;
  /** `null` once the top rank (Maestro) is reached. */
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

/** Index of the tier a given XP total sits in (the highest one it clears). */
function tierIndex(xp: number, ladder: RankLadder): number {
  const value = safeXP(xp);
  let index = 0;
  for (let i = 0; i < ladder.length; i++) {
    if (value >= ladder[i].minXP) index = i;
  }
  return index;
}

/** Resolve the rank a given XP total currently sits in. */
export function getRankFromXP(xp: number, ladder: RankLadder): UserRank {
  return ladder[tierIndex(xp, ladder)].rank;
}

/** The rank above the current one, or `null` if already at the top. */
export function getNextRank(xp: number, ladder: RankLadder): UserRank | null {
  return ladder[tierIndex(xp, ladder) + 1]?.rank ?? null;
}

/**
 * Everything the profile UI needs to render rank + progress in one call.
 *
 * At the top rank: `nextRank`/`nextRankXP` are null, `xpRemaining` is 0, and
 * `progressPercent` is 100 (full bar / "Maximum Rank Reached").
 */
export function getRankInfo(xp: number, ladder: RankLadder): RankInfo {
  const currentXP = safeXP(xp);
  const index = tierIndex(currentXP, ladder);
  const current = ladder[index];
  const next = ladder[index + 1] ?? null;

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
 * XP earned by an order — the client-side mirror of the SQL `grant_order_xp`
 * formula. The database remains the source of truth for actually awarding XP;
 * this is for previews/estimates and tests.
 *
 * Pass the DISCOUNTED SUBTOTAL: what the goods cost after any coupon, before
 * shipping and tax. (Passing the order total would credit shipping as XP.)
 */
export function calculateOrderXp(discountedSubtotal: number): number {
  if (!Number.isFinite(discountedSubtotal) || discountedSubtotal <= 0) return 0;
  return Math.floor(discountedSubtotal / 1000) * 50;
}

/** A single audit-log row from `profile_experience_events`. */
export type XpEvent = Tables<"profile_experience_events">;

/** Profile XP data shaped for the UI: the raw balance plus its derived rank. */
export interface ProfileXpData extends RankInfo {
  experiencePoints: number;
}

/** Build {@link ProfileXpData} from a profile's stored XP balance. */
export function getProfileXpData(
  experiencePoints: number,
  ladder: RankLadder
): ProfileXpData {
  return {
    experiencePoints: safeXP(experiencePoints),
    ...getRankInfo(experiencePoints, ladder),
  };
}
