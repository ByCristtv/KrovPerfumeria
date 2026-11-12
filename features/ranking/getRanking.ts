import { supabase } from "@/lib/supabase/client";
import { getRankInfo } from "@/lib/rank";
import { getRankLadderSafe } from "@/features/loyalty/rankLadder";
import {
  RANKING_TOP_COUNT,
  type RankingEntry,
  type RankingResult,
} from "@/types/ranking";

/**
 * Public leaderboard read.
 *
 * Uses the anon client (the same one the catalog reads through) rather than the
 * cookie-bound server client: the leaderboard is identical for every visitor, so
 * binding it to a request's cookies would make the route dynamic and forfeit the
 * page's `revalidate` cache for no gain.
 *
 * All of the filtering, ordering, positioning and limiting happens inside
 * `get_ranking_top` — see migration 20260823000100. Nothing here re-sorts, and
 * nothing here drops rows: a row that arrives is a row that opted in, because
 * the function cannot return any other kind. The only work done client-side is
 * turning XP into a rank name and progress, against the ladder configured in
 * `public.levels` (the same one the profile and the database use), so the
 * leaderboard and the profile page can never disagree about what "Alquimista"
 * means.
 */
export async function getTopRanking(
  limit: number = RANKING_TOP_COUNT
): Promise<RankingResult> {
  const [{ data, error }, ladder] = await Promise.all([
    supabase.rpc("get_ranking_top", { p_limit: limit }),
    getRankLadderSafe(),
  ]);

  if (error) {
    // Logged for us, never surfaced: the page renders a generic error state so a
    // Postgres message can't reach a visitor.
    console.error("getTopRanking failed:", error.message);
    return { status: "error" };
  }
  // Without the ladder a rank would be a guess; the page shows its error state.
  if (!ladder) return { status: "error" };

  const entries: RankingEntry[] = (data ?? []).map((row) => {
    const progress = getRankInfo(row.experience_points, ladder);
    return {
      position: row.rank_position,
      username: row.username,
      experiencePoints: row.experience_points,
      rank: progress.currentRank,
      progress,
    };
  });

  return { status: "ok", entries };
}
