import type { UserRank } from "@/lib/rank";

/** How many entries the public leaderboard shows. */
export const RANKING_TOP_COUNT = 10;

/**
 * One leaderboard row, as rendered.
 *
 * This is the complete set of facts the ranking exposes about a person — a
 * position, a nickname they chose, their XP, and the rank that XP implies.
 * There is deliberately no `id` here: nothing downstream can link an entry back
 * to an account, so no component can leak an identifier it never received.
 */
export interface RankingEntry {
  /** 1-based, computed by the database so ties resolve identically every time. */
  position: number;
  username: string;
  experiencePoints: number;
  /** Derived from `experiencePoints` via lib/rank.ts — never stored. */
  rank: UserRank;
  /**
   * Places gained (+) or lost (−) since the previous day, `0` for unchanged.
   * Absent until the database keeps a daily snapshot to compare against — the
   * board draws a movement marker only when this is a number, so it never
   * claims "no change" about something it cannot know.
   */
  movement?: number | null;
}

/**
 * The result of loading the leaderboard.
 *
 * A discriminated union rather than a throw: /ranking is a Server Component, and
 * an uncaught error there would replace the whole page with the framework error
 * boundary. Modelling failure as data lets the page render its own error state
 * while the actual Postgres message stays in the server log.
 */
export type RankingResult =
  | { status: "ok"; entries: RankingEntry[] }
  | { status: "error" };
