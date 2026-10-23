"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { validateXpAdjustment, type XpAdjustmentInput } from "@/lib/customers/xpAdjustment";
import { getRankFromXP, type UserRank } from "@/lib/rank";
import type { ActionResult } from "@/types/action";

export interface XpAdjustmentResult {
  delta: number;
  balance_before: number;
  balance_after: number;
  rank: UserRank;
}

/**
 * Add or deduct XP on a customer's balance.
 *
 * Defense in depth (same layering as the order / wholesale actions):
 *   1. proxy.ts keeps non-admins off /admin/* before the page renders.
 *   2. This action re-checks the caller's role — a server action can be POSTed
 *      directly, bypassing the proxy — and validates the untrusted input.
 *   3. admin_adjust_customer_xp() runs is_admin() itself and does the balance
 *      update + ledger insert atomically under a row lock. That is the real
 *      gate; nothing here writes to profiles directly.
 */
export async function adjustCustomerXpAction(
  userId: string,
  input: XpAdjustmentInput
): Promise<ActionResult<XpAdjustmentResult>> {
  if (typeof userId !== "string" || !isUuid(userId)) {
    return { ok: false, message: "ID de cliente inválido." };
  }
  if (!input || typeof input !== "object") {
    return { ok: false, message: "Datos del ajuste inválidos." };
  }

  const validation = validateXpAdjustment({
    direction: input.direction,
    amount: typeof input.amount === "number" || typeof input.amount === "string" ? input.amount : "",
    reason: typeof input.reason === "string" ? input.reason : null,
  });
  if (!validation.ok) {
    return { ok: false, message: validation.message };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Tu sesión expiró. Vuelve a iniciar sesión." };
  }

  const { data: caller } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (caller?.role !== "admin") {
    return { ok: false, message: "No tienes permiso para realizar esta acción." };
  }

  const { data, error } = await supabase.rpc("admin_adjust_customer_xp", {
    p_user_id: userId,
    p_delta: validation.delta,
    p_reason: validation.reason ?? undefined,
  });

  if (error) {
    return rpcError(error);
  }

  const result = data as unknown as Omit<XpAdjustmentResult, "rank"> | null;
  const balanceAfter = result?.balance_after ?? 0;

  revalidatePath("/admin/clientes");
  revalidatePath(`/admin/clientes/${userId}`);

  return {
    ok: true,
    message:
      validation.delta > 0
        ? `Se sumaron ${formatXpAmount(validation.delta)} XP.`
        : `Se restaron ${formatXpAmount(-validation.delta)} XP.`,
    data: {
      delta: result?.delta ?? validation.delta,
      balance_before: result?.balance_before ?? balanceAfter - validation.delta,
      balance_after: balanceAfter,
      rank: getRankFromXP(balanceAfter),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function formatXpAmount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Messages raised by admin_adjust_customer_xp (migration 20261022000100). */
function rpcError(error: PostgrestError): ActionResult<XpAdjustmentResult> {
  const msg = error.message ?? "";

  if (/Insufficient privilege/i.test(msg)) {
    return { ok: false, message: "No tienes permiso para realizar esta acción." };
  }
  // Before the generic "not found" checks: the RPC itself may be missing.
  if (/function .*admin_adjust_customer_xp.* does not exist|Could not find the function/i.test(msg)) {
    return {
      ok: false,
      message:
        "Falta aplicar la migración de ajustes de XP (admin_adjust_customer_xp). Ejecútala en Supabase.",
    };
  }
  if (/cannot go negative/i.test(msg)) {
    return { ok: false, message: "El ajuste dejaría al cliente con XP negativo." };
  }
  if (/own XP/i.test(msg)) {
    return { ok: false, message: "No puedes ajustar tu propio XP." };
  }
  if (/Customer not found/i.test(msg)) {
    return { ok: false, message: "El cliente ya no existe." };
  }
  if (/Invalid XP amount/i.test(msg)) {
    return { ok: false, message: "Cantidad de XP inválida." };
  }
  if (/Reason too long/i.test(msg)) {
    return { ok: false, message: "El motivo es demasiado largo." };
  }

  console.error("[admin/clientes/actions] unexpected RPC error", error);
  return { ok: false, message: "No pudimos aplicar el ajuste de XP." };
}
