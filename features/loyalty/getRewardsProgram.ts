import { supabase } from "@/lib/supabase/client";
import type { RankLadder } from "@/lib/rank";
import {
  COUPON_DEFINITION_COLUMNS,
  groupRewardsByLevel,
  mapRewardDefinition,
  type CouponDefinitionRow,
  type RewardsByLevel,
} from "@/lib/loyalty/types";
import { getRankLadder } from "./rankLadder";

/** The public loyalty programme: where each rank starts and what it hands out. */
export interface RewardsProgram {
  ladder: RankLadder;
  rewardsByLevel: RewardsByLevel;
}

export type RewardsProgramResult =
  | { status: "ok"; program: RewardsProgram }
  | { status: "error" };

/**
 * The ladder plus every ACTIVE reward definition — what /ranking's roadmap
 * advertises. Anon reads ("Anyone can view levels" / "Anyone can view active
 * coupons"), so the page stays cacheable. The explicit `is_active` filter keeps
 * an admin's own visit from showing retired rewards (admins can read them).
 */
export async function getRewardsProgram(): Promise<RewardsProgramResult> {
  try {
    const [ladder, rewardsRes] = await Promise.all([
      getRankLadder(),
      supabase
        .from("coupons")
        .select(COUPON_DEFINITION_COLUMNS)
        .eq("is_active", true)
        .order("level_required", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (rewardsRes.error) throw new Error(rewardsRes.error.message);

    const rewards = ((rewardsRes.data ?? []) as CouponDefinitionRow[]).map(mapRewardDefinition);
    return { status: "ok", program: { ladder, rewardsByLevel: groupRewardsByLevel(rewards) } };
  } catch (error) {
    console.error("getRewardsProgram failed:", (error as Error).message);
    return { status: "error" };
  }
}
