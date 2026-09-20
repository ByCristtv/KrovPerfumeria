"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setSocialProfileVisibility } from "@/lib/social/visibilityRpc";
import { rankingSettingsSchema, type RankingSettingsFormValues } from "@/schemas/ranking";
import type { ActionResult } from "@/types/action";

/** Postgres error codes we can translate into something a customer can act on. */
const PG_UNIQUE_VIOLATION = "23505";
const PG_CHECK_VIOLATION = "23514";

export interface RankingSettingsData {
  username: string | null;
  show_in_ranking: boolean;
  /**
   * Social discoverability — a SEPARATE column from `show_in_ranking`, written
   * through its own RPC. One control currently drives both (see below), so the
   * two land on the same value, but they are never the same field: splitting
   * the control later is a UI change, not a migration.
   */
  is_profile_public: boolean;
}

/**
 * Save the caller's public username and leaderboard opt-in.
 *
 * Trust boundary: the card validates as the user types, but this action
 * re-validates the whole payload and — critically — derives the row it writes
 * from `auth.getUser()`, never from the input. There is no user id in the
 * payload to tamper with, and the UPDATE is additionally scoped by the
 * "Users can update own profile" RLS policy, so a caller cannot reach another
 * profile even by forging a request.
 *
 * The one state this must never produce is "opted in with no username". Three
 * things prevent it, in order: the schema's cross-field refine, the auto-disable
 * below, and `profiles_ranking_requires_username` in the database — which is the
 * only one of the three a hand-rolled REST call still has to satisfy.
 *
 * It also writes `profiles.is_profile_public`, which decides whether the account
 * can be FOUND in /friends. That is a different column with a different rule set
 * and its own RPC; what makes them move together is the product decision that
 * /profile exposes ONE "public profile" switch, not the schema. The write order
 * is forced: `set_social_profile_visibility` refuses to publish a profile with
 * no username, so the username must already be in the row before it is called.
 */
export async function updateRankingSettingsAction(
  input: RankingSettingsFormValues
): Promise<ActionResult<RankingSettingsData>> {
  const parsed = rankingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      message: "Debes iniciar sesión para cambiar tu perfil.",
    };
  }

  const { username } = parsed.data;

  // Clearing the username while opted in would otherwise trip the CHECK and
  // fail the whole save. Resolving it to the safe state — private — keeps the
  // user's intent (remove my public name) working in one step, and means the
  // invalid combination is never even attempted.
  const show_in_ranking = username === null ? false : parsed.data.show_in_ranking;

  const { error } = await supabase
    .from("profiles")
    .update({ username, show_in_ranking })
    .eq("id", user.id);

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        message: "Ese nombre de usuario ya está en uso. Prueba con otro.",
      };
    }
    if (error.code === PG_CHECK_VIOLATION) {
      return {
        ok: false,
        message: "El nombre de usuario no cumple el formato permitido.",
      };
    }

    console.error("[ranking] settings update failed", error);
    return {
      ok: false,
      message: "No pudimos guardar tus preferencias. Intenta de nuevo.",
    };
  }

  // The leaderboard is cached (see app/ranking/page.tsx) — an opt-in or a
  // rename should show up there without waiting out the revalidate window.
  // Done HERE, before the second write: the username/ranking change has already
  // landed, so it must be published even if the visibility call below fails.
  revalidatePath("/ranking");
  revalidatePath("/profile");

  // Discoverability follows the same switch. Deliberately AFTER the update
  // above: the RPC raises `username_required_for_public_profile` when the row
  // has no username, so publishing has to see the username this save just
  // wrote. Passing `show_in_ranking` (not the raw input) carries the
  // auto-disable through, so clearing a username makes the account private
  // here too rather than leaving it findable under a name that no longer exists.
  const { error: visibilityError } = await setSocialProfileVisibility(
    supabase,
    show_in_ranking
  );

  if (visibilityError) {
    // The username/ranking write already landed. Saying so plainly beats
    // reporting success over a half-applied change — and because both writes
    // are idempotent, pressing Save again converges.
    console.error("[social] visibility update failed", visibilityError);
    return {
      ok: false,
      message:
        "Guardamos tu nombre de usuario, pero no pudimos actualizar la visibilidad de tu perfil. Intenta de nuevo.",
    };
  }

  // Echoed back so the client can render the state the DATABASE now holds,
  // including the auto-disable above, instead of assuming the input stuck.
  return {
    ok: true,
    message:
      username === null
        ? "Nombre de usuario eliminado. Ya no apareces en el ranking."
        : show_in_ranking
          ? "Listo. Apareces en el ranking público."
          : "Preferencias guardadas.",
    data: { username, show_in_ranking, is_profile_public: show_in_ranking },
  };
}
