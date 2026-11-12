"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fetchRankLadder } from "@/features/loyalty/rankLadder";
import { getTierByLevel, type RankLadder } from "@/lib/rank";
import { validateThresholds } from "@/lib/loyalty/thresholds";
import { validateRewardTerms, type RewardTermsInput } from "@/lib/loyalty/rewardTerms";
import {
  MISSING_MIGRATION_MESSAGE,
  isMissingMigrationError,
  loyaltyErrorMessage,
  parseLoyaltyError,
} from "@/lib/loyalty/errors";
import { loyaltyRpc, type LoyaltyRpcError } from "@/lib/loyalty/types";
import type { ActionResult } from "@/types/action";

/**
 * Admin → Recompensas server actions.
 *
 * Defense in depth, same layering as the other admin actions:
 *   1. proxy.ts keeps non-admins off /admin/* before the page renders.
 *   2. Each action re-checks the caller's role (a server action can be POSTed
 *      directly) and validates the untrusted input with the same rules the
 *      form uses (lib/loyalty/*).
 *   3. The SECURITY DEFINER RPCs of migration 20261109000200 check is_admin()
 *      themselves, re-validate everything and write atomically. They are the
 *      real gate and the only write path: API roles cannot write `levels` or
 *      `coupons` directly any more.
 */

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireAdmin(): Promise<{ ok: true; supabase: SupabaseServer } | { ok: false; result: ActionResult<never> }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, result: { ok: false, message: "Tu sesión expiró. Vuelve a iniciar sesión." } };
  }

  const { data: caller } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (caller?.role !== "admin") {
    return { ok: false, result: { ok: false, message: "No tienes permiso para realizar esta acción." } };
  }
  return { ok: true, supabase };
}

function rpcFailure<T>(
  error: LoyaltyRpcError,
  context: string,
  ladder?: RankLadder | null
): ActionResult<T> {
  if (isMissingMigrationError(error)) {
    return { ok: false, message: MISSING_MIGRATION_MESSAGE };
  }
  const parsed = parseLoyaltyError(error.message);
  if (parsed) {
    return {
      ok: false,
      message: loyaltyErrorMessage(parsed, (level) => (ladder ? getTierByLevel(ladder, level)?.rank : undefined)),
    };
  }
  console.error(`[admin/rewards] unexpected ${context} error`, error);
  return { ok: false, message: "No pudimos guardar el cambio. Inténtalo de nuevo." };
}

/** Thresholds feed every rank shown anywhere (root layout → RankLadderProvider). */
function revalidateLadder() {
  revalidatePath("/", "layout");
}

/** Reward definitions feed the admin page and the public roadmap. */
function revalidateRewards() {
  revalidatePath("/admin/rewards");
  revalidatePath("/ranking");
}

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds
// ─────────────────────────────────────────────────────────────────────────────

export interface SaveThresholdsInput {
  thresholds: { level: number; value: string | number }[];
  /** max(levels.updated_at) the form was loaded with. */
  expectedUpdatedAt: string | null;
}

export interface SaveThresholdsResult {
  changedLevels: number;
  customersReached: number;
  couponsIssued: number;
}

export async function saveLevelThresholdsAction(
  input: SaveThresholdsInput
): Promise<ActionResult<SaveThresholdsResult>> {
  if (!input || !Array.isArray(input.thresholds)) {
    return { ok: false, message: "Datos inválidos." };
  }

  const auth = await requireAdmin();
  if (!auth.ok) return auth.result;
  const { supabase } = auth;

  // The stored ladder names each level (for the messages) and is the list the
  // proposal must cover exactly once. Read fresh, not from the render memo.
  let ladder: RankLadder;
  try {
    ladder = await fetchRankLadder(supabase);
  } catch (error) {
    console.error("[admin/rewards] ladder read failed", (error as Error).message);
    return { ok: false, message: "No pudimos leer los rangos actuales." };
  }

  const byLevel = new Map<number, string | number>();
  for (const row of input.thresholds) {
    if (!row || typeof row.level !== "number" || byLevel.has(row.level)) {
      return { ok: false, message: "La configuración enviada no es válida. Recarga la página." };
    }
    if (typeof row.value !== "string" && typeof row.value !== "number") {
      return { ok: false, message: "La configuración enviada no es válida. Recarga la página." };
    }
    byLevel.set(row.level, row.value);
  }
  if (byLevel.size !== ladder.length || ladder.some((tier) => !byLevel.has(tier.level))) {
    return { ok: false, message: "Debes enviar la XP de todos los rangos. Recarga la página." };
  }

  const validation = validateThresholds(
    ladder.map((tier) => ({ level: tier.level, rank: tier.rank, value: byLevel.get(tier.level)! }))
  );
  if (!validation.ok || !validation.payload) {
    const first = validation.rows.find((row) => row.message);
    return { ok: false, message: first ? `${first.rank}: ${first.message}` : "Revisa los valores." };
  }

  const expected =
    typeof input.expectedUpdatedAt === "string" && !Number.isNaN(Date.parse(input.expectedUpdatedAt))
      ? input.expectedUpdatedAt
      : null;

  const { data, error } = await loyaltyRpc(supabase, "admin_update_level_thresholds", {
    p_thresholds: validation.payload,
    p_expected_updated_at: expected,
  });
  if (error) return rpcFailure(error, "thresholds", ladder);

  const result: SaveThresholdsResult = {
    changedLevels: data?.changed_levels ?? 0,
    customersReached: data?.customers_reached ?? 0,
    couponsIssued: data?.coupons_issued ?? 0,
  };

  if (result.changedLevels > 0) revalidateLadder();

  let message =
    result.changedLevels === 0
      ? "No había cambios que guardar."
      : `Umbrales guardados (${result.changedLevels} ${result.changedLevels === 1 ? "rango" : "rangos"}).`;
  if (result.customersReached > 0) {
    message += ` ${result.customersReached} ${result.customersReached === 1 ? "cliente alcanzó" : "clientes alcanzaron"} un rango nuevo y se ${result.couponsIssued === 1 ? "entregó" : "entregaron"} ${result.couponsIssued} ${result.couponsIssued === 1 ? "cupón" : "cupones"}.`;
  }

  return { ok: true, message, data: result };
}

// ─────────────────────────────────────────────────────────────────────────────
// Coupon reward definitions
// ─────────────────────────────────────────────────────────────────────────────

function readTerms(input: unknown): RewardTermsInput | null {
  if (!input || typeof input !== "object") return null;
  const t = input as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  if (t.discountType !== "percentage" && t.discountType !== "fixed") return null;
  return {
    name: str(t.name),
    description: str(t.description),
    discountType: t.discountType,
    discountValue: str(t.discountValue),
    minOrderSubtotal: str(t.minOrderSubtotal),
    maxDiscountAmount: str(t.maxDiscountAmount),
    validDays: str(t.validDays),
  };
}

function firstError(errors: Partial<Record<string, string>>): string {
  return Object.values(errors).find(Boolean) ?? "Revisa los datos de la recompensa.";
}

export interface CreateRewardInput {
  level: number;
  terms: RewardTermsInput;
  isActive: boolean;
}

export async function createCouponRewardAction(input: CreateRewardInput): Promise<ActionResult<{ id: string; code: string }>> {
  if (!input || !Number.isInteger(input.level) || input.level < 1) {
    return { ok: false, message: "Elige un rango válido." };
  }
  const terms = readTerms(input.terms);
  if (!terms) return { ok: false, message: "Datos de la recompensa inválidos." };
  const validation = validateRewardTerms(terms);
  if (!validation.ok) return { ok: false, message: firstError(validation.errors) };

  const auth = await requireAdmin();
  if (!auth.ok) return auth.result;

  const v = validation.terms;
  const { data, error } = await loyaltyRpc(auth.supabase, "admin_create_coupon_reward", {
    p_level_number: input.level,
    p_name: v.name,
    p_description: v.description,
    p_discount_type: v.discountType,
    p_discount_value: v.discountValue,
    p_min_order_subtotal: v.minOrderSubtotal,
    p_max_discount_amount: v.maxDiscountAmount,
    p_valid_days: v.validDays,
    p_is_active: input.isActive !== false,
  });
  if (error) return rpcFailure(error, "create reward");

  revalidateRewards();
  const code = typeof data?.code === "string" ? data.code : "";
  return {
    ok: true,
    message: `Recompensa creada${code ? ` (${code})` : ""}.`,
    data: { id: String(data?.id ?? ""), code },
  };
}

export interface UpdateRewardInput {
  terms: RewardTermsInput;
  expectedUpdatedAt: string | null;
}

export async function updateCouponRewardAction(id: string, input: UpdateRewardInput): Promise<ActionResult> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, message: "Recompensa inválida." };
  const terms = readTerms(input?.terms);
  if (!terms) return { ok: false, message: "Datos de la recompensa inválidos." };
  const validation = validateRewardTerms(terms);
  if (!validation.ok) return { ok: false, message: firstError(validation.errors) };

  const auth = await requireAdmin();
  if (!auth.ok) return auth.result;

  const v = validation.terms;
  const expected =
    typeof input.expectedUpdatedAt === "string" && !Number.isNaN(Date.parse(input.expectedUpdatedAt))
      ? input.expectedUpdatedAt
      : null;

  // The discount TYPE is not sent: the RPC validates the value against the
  // stored type, which is fixed once a reward exists.
  const { error } = await loyaltyRpc(auth.supabase, "admin_update_coupon_reward", {
    p_coupon_id: id,
    p_name: v.name,
    p_description: v.description,
    p_discount_value: v.discountValue,
    p_min_order_subtotal: v.minOrderSubtotal,
    p_max_discount_amount: v.maxDiscountAmount,
    p_valid_days: v.validDays,
    p_expected_updated_at: expected,
  });
  if (error) return rpcFailure(error, "update reward");

  revalidateRewards();
  return {
    ok: true,
    message: "Recompensa actualizada. Los cupones ya entregados conservan sus condiciones.",
  };
}

export async function setCouponRewardActiveAction(id: string, active: boolean): Promise<ActionResult> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, message: "Recompensa inválida." };
  if (typeof active !== "boolean") return { ok: false, message: "Estado inválido." };

  const auth = await requireAdmin();
  if (!auth.ok) return auth.result;

  const { error } = await loyaltyRpc(auth.supabase, "admin_set_coupon_reward_active", {
    p_coupon_id: id,
    p_is_active: active,
  });
  if (error) return rpcFailure(error, "toggle reward");

  revalidateRewards();
  return {
    ok: true,
    message: active
      ? "Recompensa activada: se entregará a quienes alcancen el rango desde ahora."
      : "Recompensa desactivada: ya no se entregará. Los cupones entregados siguen siendo válidos.",
  };
}

export async function deleteCouponRewardAction(id: string): Promise<ActionResult> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, message: "Recompensa inválida." };

  const auth = await requireAdmin();
  if (!auth.ok) return auth.result;

  const { error } = await loyaltyRpc(auth.supabase, "admin_delete_coupon_reward", { p_coupon_id: id });
  if (error) return rpcFailure(error, "delete reward");

  revalidateRewards();
  return { ok: true, message: "Recompensa eliminada." };
}

export interface RetroactiveIssueResult {
  eligible: number;
  issued: number;
}

/**
 * Explicit back-issue of one active reward to customers who ALREADY have its
 * rank. `dryRun` only counts (for the confirmation dialog); the real run is
 * duplicate-safe in the database.
 */
export async function issueCouponRewardRetroactivelyAction(
  id: string,
  dryRun: boolean
): Promise<ActionResult<RetroactiveIssueResult>> {
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, message: "Recompensa inválida." };

  const auth = await requireAdmin();
  if (!auth.ok) return auth.result;

  const { data, error } = await loyaltyRpc(auth.supabase, "admin_issue_coupon_reward_retroactively", {
    p_coupon_id: id,
    p_dry_run: dryRun !== false,
  });
  if (error) return rpcFailure(error, "retroactive issue");

  const result = { eligible: data?.eligible ?? 0, issued: data?.issued ?? 0 };
  if (dryRun !== false) {
    return { ok: true, message: "", data: result };
  }

  revalidateRewards();
  return {
    ok: true,
    message:
      result.issued === 0
        ? "No había clientes pendientes de recibir esta recompensa."
        : `Se entregó a ${result.issued} ${result.issued === 1 ? "cliente" : "clientes"}.`,
    data: result,
  };
}
