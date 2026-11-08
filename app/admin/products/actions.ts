"use server";

import { revalidatePath } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isHomepageOfferChange, type HomepageOfferChange } from "@/lib/admin/homepageOffers";
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

/**
 * Mark / unmark a PRODUCT as trending (`products.is_trending`): trending
 * products lead the default catalog order. Writes that one column only.
 * Same layering as the supplier action: role re-check here, RLS underneath.
 */
export async function setProductTrendingAction(
  productId: string,
  trending: boolean
): Promise<ActionResult<{ product_id: string; is_trending: boolean }>> {
  if (typeof productId !== "string" || !isUuid(productId)) {
    return { ok: false, message: "Producto inválido." };
  }
  if (typeof trending !== "boolean") {
    return { ok: false, message: "Valor de tendencia inválido." };
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
    .from("products")
    .update({ is_trending: trending })
    .eq("id", productId)
    .select("id, is_trending")
    .maybeSingle();

  if (error) {
    console.error("[admin/products/actions] trending update error", error);
    return { ok: false, message: "No se pudo actualizar la tendencia." };
  }
  if (!data) {
    return {
      ok: false,
      message: "No se encontró el producto, o no tienes permiso para modificarlo.",
    };
  }

  revalidatePath("/admin/products");
  revalidatePath("/products");
  revalidatePath("/");

  return {
    ok: true,
    message: trending ? "Marcado como tendencia." : "Quitado de tendencias.",
    data: { product_id: data.id, is_trending: data.is_trending === true },
  };
}

/**
 * Revalidate the homepage after an admin write that may change its featured
 * offers (the hero carousel; see features/products/getFeaturedOffers.ts).
 *
 * The admin forms write through the browser Supabase client (RLS-protected,
 * admin-only), so they cannot call `revalidatePath` themselves. Each form
 * classifies its own write with lib/admin/homepageOffers.ts and calls this only
 * when a slide could change; unrelated saves (notes, categories, wholesale
 * prices, a non-offer variant's stock) never reach it.
 *
 *   · scope "offers"  — eligibility changed → revalidate "/" unconditionally
 *                       (the write may have REMOVED a slide).
 *   · scope "product" — only something a slide displays changed → revalidate
 *                       only if that product has an active on-offer variant
 *                       right now. If that check fails we revalidate anyway: one
 *                       spare regeneration is cheaper than a stale hero.
 *
 * Revalidation marks "/" stale; the next visit regenerates it. The 300 s ISR
 * window stays as the backstop for anything that bypasses this (Studio edits,
 * checkout stock decrements). Same layering as the actions above: the role is
 * re-checked here because a server action can be POSTed directly.
 */
export async function revalidateHomepageOffersAction(
  change: HomepageOfferChange
): Promise<ActionResult<{ revalidated: boolean }>> {
  if (!isHomepageOfferChange(change)) {
    return { ok: false, message: "Cambio inválido." };
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

  if (change.scope === "product") {
    const { data, error } = await supabase
      .from("product_variants")
      .select("id")
      .eq("product_id", change.productId)
      .eq("is_on_offer", true)
      .eq("is_active", true)
      .limit(1);

    if (error) {
      console.error("[admin/products/actions] homepage offer check failed", error);
    } else if ((data ?? []).length === 0) {
      return {
        ok: true,
        message: "El producto no está en oferta; la portada no cambia.",
        data: { revalidated: false },
      };
    }
  }

  revalidatePath("/");
  return { ok: true, message: "Portada actualizada.", data: { revalidated: true } };
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
