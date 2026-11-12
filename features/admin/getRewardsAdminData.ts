import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { parseRankLadder, type LevelRow, type RankLadder } from "@/lib/rank";
import {
  COUPON_DEFINITION_COLUMNS,
  mapRewardDefinition,
  type AdminRewardDefinition,
  type CouponDefinitionRow,
} from "@/lib/loyalty/types";

export type RewardsAdminData =
  | {
      status: "ok";
      ladder: RankLadder;
      /** max(levels.updated_at): the optimistic-lock token for the threshold save. */
      levelsUpdatedAt: string | null;
      /** Every definition, active or not, in rank then creation order. */
      rewards: AdminRewardDefinition[];
      /**
       * False until migrations 20261109000100/200 are applied: the page then
       * shows the current configuration read-only, because the write RPCs and
       * the issued-coupon snapshots it relies on do not exist yet.
       */
      migrationsApplied: boolean;
    }
  | { status: "error"; message: string };

type CouponAdminRow = CouponDefinitionRow & {
  created_at: string;
  user_coupons: { count: number }[] | null;
};

/**
 * Everything /admin/rewards renders, read with the admin's own (cookie) client:
 * RLS lets admins see inactive definitions ("is_active OR is_admin()") and count
 * every customer's coupons. proxy.ts has already kept non-admins out.
 *
 * Reads the ladder FRESH (not the per-render memo the storefront uses) so the
 * editor always starts from what is stored.
 */
export async function getRewardsAdminData(): Promise<RewardsAdminData> {
  const supabase = await createClient();

  const [levelsRes, rewardsRes, probeRes] = await Promise.all([
    supabase
      .from("levels")
      .select("level_number, name, required_xp, updated_at")
      .order("level_number", { ascending: true }),
    supabase
      .from("coupons")
      .select(`${COUPON_DEFINITION_COLUMNS}, created_at, user_coupons(count)`)
      .order("level_required", { ascending: true })
      .order("created_at", { ascending: true }),
    // The audit table only exists once migration 20261109000200 is applied.
    // Not in the generated types yet, hence the untyped client for this probe.
    (supabase as unknown as SupabaseClient)
      .from("loyalty_audit_log")
      .select("id", { head: true, count: "exact" })
      .limit(1),
  ]);

  if (levelsRes.error) {
    console.error("getRewardsAdminData: levels failed", levelsRes.error.message);
    return { status: "error", message: "No pudimos cargar los rangos." };
  }
  if (rewardsRes.error) {
    console.error("getRewardsAdminData: coupons failed", rewardsRes.error.message);
    return { status: "error", message: "No pudimos cargar las recompensas." };
  }

  let ladder: RankLadder;
  try {
    ladder = parseRankLadder((levelsRes.data ?? []) as LevelRow[]);
  } catch (error) {
    console.error("getRewardsAdminData: invalid ladder", (error as Error).message);
    return {
      status: "error",
      message: "La configuración de rangos guardada en la base de datos no es válida.",
    };
  }

  const levelsUpdatedAt =
    (levelsRes.data ?? []).reduce<string | null>(
      (max, row) => (max === null || row.updated_at > max ? row.updated_at : max),
      null
    );

  const rewards = ((rewardsRes.data ?? []) as unknown as CouponAdminRow[]).map(
    (row): AdminRewardDefinition => ({
      ...mapRewardDefinition(row),
      createdAt: row.created_at,
      issuedCount: row.user_coupons?.[0]?.count ?? 0,
    })
  );

  if (probeRes.error) {
    console.warn("getRewardsAdminData: loyalty migrations not applied yet", probeRes.error.message);
  }

  return {
    status: "ok",
    ladder,
    levelsUpdatedAt,
    rewards,
    migrationsApplied: !probeRes.error,
  };
}
