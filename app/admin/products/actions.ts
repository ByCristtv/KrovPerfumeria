"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/types/action";

export interface SupplierAvailabilityResult {
  variant_id: string;
  supplier_available: boolean;
  supplier_checked_at: string | null;
}

/**
 * Record what an admin saw on the supplier's website for one variant.
 *
 * Writes EXACTLY two columns - `supplier_available` and `supplier_checked_at` -
 * and nothing else. In particular never `stock`: supplier availability is not
 * KROV's inventory, so this can neither create nor consume a physical unit, and
 * (because only those two columns change) it cannot trip the stock-audit trigger
 * either. It deliberately does NOT live in the product edit form, whose
 * full-row save would also write back whatever stock it loaded minutes ago.
 *
 * Defense in depth (same layering as the other admin actions):
 *   1. proxy.ts keeps non-admins off /admin/* before the page renders.
 *   2. This action re-checks the caller's role - a server action can be POSTed
 *      directly, bypassing the proxy - and validates its untrusted arguments.
 *   3. RLS on product_variants only lets is_admin() write, so even a forged
 *      call that got past (2) would update zero rows; that case is detected and
 *      reported rather than mistaken for success.
 *   4. chk_decant_not_supplier_available (migration 20261029000100) refuses to
 *      flag a decant, whatever the caller.
 *
 * Idempotent on purpose: sending the value a row already has simply re-stamps
 * `supplier_checked_at`, which is how an admin records "I looked again today".
 */
export async function setSupplierAvailabilityAction(
  variantId: string,
  available: boolean
): Promise<ActionResult<SupplierAvailabilityResult>> {
  if (typeof variantId !== "string" || !isUuid(variantId)) {
    return { ok: false, message: "Variante inválida." };
  }
  // Strictly a boolean: "true", 1 or an object must not be coerced into "verified".
  if (typeof available !== "boolean") {
    return { ok: false, message: "Valor de disponibilidad inválido." };
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

  const { data, error } = await supabase
    .from("product_variants")
    .update({
      supplier_available: available,
      supplier_checked_at: new Date().toISOString(),
    })
    .eq("id", variantId)
    .select("id, supplier_available, supplier_checked_at")
    .maybeSingle();

  if (error) {
    return writeError(error);
  }

  // RLS filters rather than errors: a caller who may not write (or a variant that
  // no longer exists) matches zero rows. That is a failure, not a success.
  if (!data) {
    return {
      ok: false,
      message: "No se encontró la variante, o no tienes permiso para modificarla.",
    };
  }

  // The admin table re-renders with the new value; the home page is the one
  // public route that caches (ISR), and it renders product cards.
  revalidatePath("/admin/products");
  revalidatePath("/");

  return {
    ok: true,
    message: available
      ? "Marcado como disponible en el proveedor."
      : "Marcado como agotado en el proveedor.",
    data: {
      variant_id: data.id,
      supplier_available: data.supplier_available === true,
      supplier_checked_at: data.supplier_checked_at ?? null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Postgres / PostgREST failures from the UPDATE, as messages an admin can act on. */
function writeError(error: PostgrestError): ActionResult<SupplierAvailabilityResult> {
  const msg = error.message ?? "";

  // 23514 check_violation: a decant can never be supplier-available.
  if (error.code === "23514" || /chk_decant_not_supplier_available/i.test(msg)) {
    return {
      ok: false,
      message:
        "Los decants no se marcan por encargo: se venden del pool de ml propio.",
    };
  }
  // 42501 insufficient_privilege (RLS / grants).
  if (error.code === "42501" || /permission denied|row-level security/i.test(msg)) {
    return { ok: false, message: "No tienes permiso para realizar esta acción." };
  }
  // 42703 undefined_column / PostgREST schema cache: the migration is pending.
  if (
    error.code === "42703" ||
    /supplier_(available|checked_at).*(does not exist|schema cache)|could not find the .*supplier_/i.test(
      msg
    )
  ) {
    return {
      ok: false,
      message:
        "Falta aplicar la migración de disponibilidad del proveedor (20261029000100). Ejecútala en Supabase.",
    };
  }

  console.error("[admin/products/actions] unexpected supplier update error", error);
  return {
    ok: false,
    message: "No se pudo actualizar la disponibilidad. Intenta de nuevo.",
  };
}
