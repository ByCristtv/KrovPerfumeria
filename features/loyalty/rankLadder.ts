import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { parseRankLadder, type LevelRow, type RankLadder } from "@/lib/rank";
import type { Database } from "@/types/database";

/**
 * THE read of the rank ladder: `public.levels`, the one place thresholds live.
 *
 * `levels` is public ("Anyone can view levels"), so the anon client is enough
 * and no request cookies are touched — reading the ladder never turns a static
 * route dynamic. Throws when the rows cannot be read or violate the ladder
 * invariants (see `parseRankLadder`).
 */
export async function fetchRankLadder(
  client: SupabaseClient<Database> = supabase
): Promise<RankLadder> {
  const { data, error } = await client
    .from("levels")
    .select("level_number, name, required_xp")
    .order("level_number", { ascending: true });

  if (error) throw new Error(`levels read failed: ${error.message}`);
  return parseRankLadder((data ?? []) as LevelRow[]);
}

/**
 * Server-side ladder, memoised for the duration of one render (React `cache`):
 * the root layout, a page and its data loaders all share a single query.
 * Freshness after an admin edit comes from the admin action revalidating the
 * routes (`revalidatePath("/", "layout")`), not from a timed cache.
 */
export const getRankLadder = cache(() => fetchRankLadder());

/**
 * The same, but `null` instead of a throw — for surfaces where rank is
 * secondary (the root layout must never 500 because of it). Logged so a broken
 * ladder is still visible in the server logs.
 */
export const getRankLadderSafe = cache(async (): Promise<RankLadder | null> => {
  try {
    return await getRankLadder();
  } catch (error) {
    console.error("[loyalty] rank ladder unavailable:", (error as Error).message);
    return null;
  }
});
