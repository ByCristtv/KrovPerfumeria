"use client";

import Link from "next/link";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useSocialEligibility } from "@/hooks/useSocialEligibility";

/**
 * The footer of /friends: tells people whether THEY can be found, and what to
 * do about it. It replaces a plain sentence with an inline link.
 *
 * Three states, all driven by `useSocialEligibility` (the same query the Buscar
 * gate reads, so React Query serves it once):
 *
 *   · private  → an inviting card with a clear call to action
 *   · public   → a quiet confirmation. Telling somebody who already did the
 *                thing to go and do it was the old copy's mistake.
 *   · unknown  → nothing. While the profile loads, or if it fails, saying
 *                either thing would be a guess; the card simply is not there.
 *
 * Why a link to /profile and not an inline switch: publishing a profile is not
 * one boolean. It needs a valid username, and it exposes the account on the
 * public leaderboard AND makes it findable — /profile states both consequences
 * next to the control and writes both columns through one validated action.
 * A toggle here would either skip that disclosure or duplicate the whole form.
 * So the card is a doorway to the one place that owns the setting, the same
 * choice the Buscar gate already makes.
 */
export default function ProfileVisibilityCard() {
  const { hasUsername, isProfilePublic, isLoading, isError } =
    useSocialEligibility();

  if (isLoading || isError) return null;

  if (hasUsername && isProfilePublic) {
    return (
      <div className="mx-auto mt-12 flex max-w-xl items-center gap-3 rounded-2xl border border-krov-smoke bg-krov-coal/50 px-5 py-4 backdrop-blur-sm">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-krov-rose"
        >
          <Eye size={17} strokeWidth={1.6} />
        </span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-krov-ash">
          Tu perfil es público: tus amigos pueden encontrarte por tu username.
        </p>
        <Link
          href="/profile"
          className="krov-underline shrink-0 text-xs text-krov-rose"
        >
          Gestionar
        </Link>
      </div>
    );
  }

  return (
    <aside
      aria-labelledby="profile-visibility-title"
      className="relative mx-auto mt-12 max-w-xl overflow-hidden rounded-2xl border border-krov-blood/30 bg-gradient-to-br from-krov-wine/50 via-krov-coal/80 to-krov-coal/80 p-5 shadow-[0_14px_40px_rgba(0,0,0,0.4)] backdrop-blur-sm sm:p-6"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-krov-blood/20 blur-3xl"
      />

      <div className="relative flex items-start gap-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-krov-blood/40 bg-krov-wine/50 text-krov-rose"
        >
          <EyeOff size={19} strokeWidth={1.5} />
        </span>

        <div className="min-w-0 flex-1">
          <h2
            id="profile-visibility-title"
            className="text-sm font-semibold text-krov-bone"
          >
            {hasUsername ? "Tus amigos no pueden encontrarte" : "Elige un username para que te encuentren"}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-krov-ash">
            {hasUsername
              ? "Tu perfil está privado, así que no apareces en las búsquedas. Haz público tu perfil para que tus amigos te envíen una solicitud."
              : "Sin un username nadie puede buscarte. Elígelo en tu perfil y activa tu visibilidad."}
          </p>

          <Link
            href="/profile"
            className="group mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-krov-blood px-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-black transition-colors duration-300 hover:bg-krov-crimson sm:min-h-10"
          >
            {hasUsername ? "Hacer público mi perfil" : "Configurar mi perfil"}
            <ArrowRight
              size={14}
              strokeWidth={2}
              aria-hidden
              className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </Link>
        </div>
      </div>
    </aside>
  );
}
