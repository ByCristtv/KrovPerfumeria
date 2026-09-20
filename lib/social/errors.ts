/**
 * Turning a social RPC failure into something a customer can read.
 *
 * The social functions signal domain failures with `RAISE EXCEPTION
 * 'snake_case_code'` (migration 20260919000100), which reaches the client as a
 * PostgrestError whose `message` IS that code. So the code is matched on the
 * message — there is no separate field carrying it.
 *
 * Two things come out of this module, and the second is the interesting one:
 *
 *   1. `message` — Spanish, safe to render. No Postgres text ever reaches a
 *      user, matching how lib/checkout/errors.ts and getTopRanking already
 *      treat database errors.
 *
 *   2. `isStale` — whether the failure means "your screen is out of date"
 *      rather than "that didn't work". These are the outcomes of somebody
 *      ELSE acting between the render and the click: the request was already
 *      accepted, already cancelled, the two are already friends. The caller
 *      refetches on these instead of just complaining, which is what makes the
 *      UI self-correct after a concurrent change in another tab or by the
 *      other person.
 */

export type SocialErrorCode =
  | "authentication_required"
  | "cannot_add_yourself"
  | "user_not_found"
  | "user_profile_is_private"
  | "social_username_required"
  | "social_public_profile_required"
  | "target_username_required"
  | "users_are_already_friends"
  | "users_are_not_friends"
  | "incoming_friend_request_exists"
  | "pending_sent_request_not_found"
  | "pending_received_request_not_found"
  | "friend_request_not_found"
  | "not_request_receiver"
  | "friend_request_is_not_pending"
  | "invalid_friend_user"
  | "target_user_required"
  | "unknown";

export interface SocialError {
  code: SocialErrorCode;
  /** Spanish, safe to display verbatim. */
  message: string;
  /**
   * True when the real fix is to re-read the server, because the relationship
   * already moved on. The caller refetches and tells the user what changed.
   */
  isStale: boolean;
}

interface ErrorSpec {
  message: string;
  isStale: boolean;
}

const SPECS: Record<Exclude<SocialErrorCode, "unknown">, ErrorSpec> = {
  authentication_required: {
    message: "Tu sesión expiró. Vuelve a iniciar sesión.",
    isStale: false,
  },
  cannot_add_yourself: {
    message: "No puedes enviarte una solicitud a ti mismo.",
    isStale: false,
  },
  user_not_found: {
    message: "Esa cuenta ya no existe.",
    isStale: true,
  },
  user_profile_is_private: {
    message: "Esa persona hizo privado su perfil y ya no acepta solicitudes.",
    isStale: true,
  },
  // The next two are about the CALLER's own profile, not the target's. They
  // are reachable only from a stale screen — Buscar is gated on exactly these
  // two conditions — so `isStale` is what re-reads the viewer's eligibility
  // and closes the section behind them.
  social_username_required: {
    message:
      "Necesitas un nombre de usuario para enviar solicitudes. Configúralo en tu perfil.",
    isStale: true,
  },
  social_public_profile_required: {
    message:
      "Tu perfil está privado. Actívalo como público en tu perfil para enviar solicitudes.",
    isStale: true,
  },
  // The TARGET has no username, so there is nobody to address. Refetching the
  // search drops them from the results.
  target_username_required: {
    message: "Esa cuenta todavía no tiene nombre de usuario.",
    isStale: true,
  },
  users_are_already_friends: {
    message: "Ya son amigos.",
    isStale: true,
  },
  // Raised by get_friend_profile / get_friend_purchased_products. Almost always
  // means the other person removed the friendship while this screen was open,
  // so the friends list on it is wrong and must be re-read.
  users_are_not_friends: {
    message: "Ya no son amigos, así que este perfil no está disponible.",
    isStale: true,
  },
  incoming_friend_request_exists: {
    message:
      "Esa persona ya te envió una solicitud. Revísala en «Solicitudes».",
    isStale: true,
  },
  pending_sent_request_not_found: {
    message: "Esa solicitud ya no está pendiente.",
    isStale: true,
  },
  pending_received_request_not_found: {
    message: "Esa solicitud ya no está pendiente.",
    isStale: true,
  },
  friend_request_not_found: {
    message: "Esa solicitud ya no existe.",
    isStale: true,
  },
  not_request_receiver: {
    message: "No puedes responder una solicitud que no recibiste.",
    isStale: false,
  },
  friend_request_is_not_pending: {
    message: "Esa solicitud ya fue respondida.",
    isStale: true,
  },
  invalid_friend_user: {
    message: "No pudimos identificar a esa persona.",
    isStale: false,
  },
  target_user_required: {
    message: "No pudimos identificar a esa persona.",
    isStale: false,
  },
};

const UNKNOWN: SocialError = {
  code: "unknown",
  message: "No pudimos completar la acción. Intenta de nuevo.",
  isStale: false,
};

/**
 * Narrow whatever a failed `supabase.rpc` threw into a {@link SocialError}.
 *
 * Anything unrecognized — a network failure, a Postgres internal, a bug —
 * collapses to the generic message. The original is logged by the service layer
 * at the throw site, so nothing is lost for debugging and nothing leaks to the
 * screen.
 */
export function toSocialError(error: unknown): SocialError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "";

  // The RAISE EXCEPTION text is the whole message, but PostgREST has been known
  // to prefix it; match on containment so a prefix does not defeat the lookup.
  const code = (Object.keys(SPECS) as Array<keyof typeof SPECS>).find(
    (candidate) => raw === candidate || raw.includes(candidate)
  );

  if (!code) return UNKNOWN;
  return { code, ...SPECS[code] };
}
