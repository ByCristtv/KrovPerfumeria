import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DiscountType } from "@/lib/coupons/types";

/**
 * A coupon reward DEFINITION (`public.coupons` row): what a rank hands out.
 * Several may belong to one rank. Customers receive immutable copies
 * (`user_coupons`, terms snapshotted at issue — migration 20261109000100), so
 * nothing here describes a coupon a customer already holds.
 */
export interface RewardDefinition {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discountType: DiscountType;
  /** Percent (0–100) or CRC, per `discountType`. */
  discountValue: number;
  /** Cap on a percentage discount, CRC. */
  maxDiscountAmount: number | null;
  /** Inclusive floor on the goods subtotal, CRC. */
  minOrderSubtotal: number;
  /** `levels.level_number` that issues it. */
  level: number;
  /** Days a customer has to use it once issued; null = never expires. */
  validDays: number | null;
  isActive: boolean;
  updatedAt: string;
}

/** The admin panel's view: the definition plus how many customers hold it. */
export interface AdminRewardDefinition extends RewardDefinition {
  createdAt: string;
  /** Copies issued so far. > 0 means it can only be deactivated, never deleted. */
  issuedCount: number;
}

/** `coupons` columns the mappers read. */
export type CouponDefinitionRow = Pick<
  Tables<"coupons">,
  | "id"
  | "code"
  | "name"
  | "description"
  | "discount_type"
  | "discount_value"
  | "max_discount_amount"
  | "min_order_subtotal"
  | "level_required"
  | "valid_days"
  | "is_active"
  | "updated_at"
>;

export const COUPON_DEFINITION_COLUMNS =
  "id, code, name, description, discount_type, discount_value, max_discount_amount, min_order_subtotal, level_required, valid_days, is_active, updated_at";

export function mapRewardDefinition(row: CouponDefinitionRow): RewardDefinition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    discountType: row.discount_type === "fixed" ? "fixed" : "percentage",
    discountValue: Number(row.discount_value),
    maxDiscountAmount: row.max_discount_amount === null ? null : Number(row.max_discount_amount),
    minOrderSubtotal: Number(row.min_order_subtotal),
    level: row.level_required,
    validDays: row.valid_days,
    isActive: row.is_active,
    updatedAt: row.updated_at,
  };
}

/** Active definitions grouped by level, each group in creation order. */
export type RewardsByLevel = Readonly<Record<number, readonly RewardDefinition[]>>;

export function groupRewardsByLevel(rewards: readonly RewardDefinition[]): RewardsByLevel {
  const groups: Record<number, RewardDefinition[]> = {};
  for (const reward of rewards) {
    (groups[reward.level] ??= []).push(reward);
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC signatures of migration 20261109000200.
//
// Not in types/database.ts yet: that file is GENERATED, and these functions only
// exist once the migration is applied. After applying it, `pnpm update-types`
// adds them; this block (and the cast in `loyaltyRpc`) can then be deleted.
// ─────────────────────────────────────────────────────────────────────────────

export interface LoyaltyRpcSignatures {
  admin_update_level_thresholds: {
    args: { p_thresholds: { level_number: number; required_xp: number }[]; p_expected_updated_at: string | null };
    returns: { changed_levels: number; customers_reached: number; coupons_issued: number; updated_at: string };
  };
  admin_create_coupon_reward: {
    args: {
      p_level_number: number;
      p_name: string;
      p_description: string | null;
      p_discount_type: DiscountType;
      p_discount_value: number;
      p_min_order_subtotal: number;
      p_max_discount_amount: number | null;
      p_valid_days: number | null;
      p_is_active: boolean;
    };
    returns: Record<string, unknown>;
  };
  admin_update_coupon_reward: {
    args: {
      p_coupon_id: string;
      p_name: string;
      p_description: string | null;
      p_discount_value: number;
      p_min_order_subtotal: number;
      p_max_discount_amount: number | null;
      p_valid_days: number | null;
      p_expected_updated_at: string | null;
    };
    returns: Record<string, unknown>;
  };
  admin_set_coupon_reward_active: {
    args: { p_coupon_id: string; p_is_active: boolean };
    returns: Record<string, unknown>;
  };
  admin_delete_coupon_reward: {
    args: { p_coupon_id: string };
    returns: { deleted: boolean; id: string };
  };
  admin_issue_coupon_reward_retroactively: {
    args: { p_coupon_id: string; p_dry_run: boolean };
    returns: { dry_run: boolean; eligible: number; issued: number };
  };
}

export type LoyaltyRpcName = keyof LoyaltyRpcSignatures;

export interface LoyaltyRpcError {
  code?: string;
  message: string;
}

/**
 * Call one of the loyalty admin RPCs with its real argument/return types. Must
 * be the request-scoped (cookie) client: the functions identify the admin with
 * auth.uid().
 */
export async function loyaltyRpc<N extends LoyaltyRpcName>(
  client: SupabaseClient<Database>,
  name: N,
  args: LoyaltyRpcSignatures[N]["args"]
): Promise<{ data: LoyaltyRpcSignatures[N]["returns"] | null; error: LoyaltyRpcError | null }> {
  const rpc = client.rpc.bind(client) as unknown as (
    fn: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: LoyaltyRpcError | null }>;
  const { data, error } = await rpc(name, args as unknown as Record<string, unknown>);
  return { data: (data as LoyaltyRpcSignatures[N]["returns"] | null) ?? null, error };
}
