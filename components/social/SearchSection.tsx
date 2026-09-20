"use client";

import {
  SocialErrorState,
  SocialListSkeleton,
  SocialPanelLink,
  SocialStatePanel,
} from "@/components/social/socialUi";
import UserSearchPanel from "@/components/social/UserSearchPanel";
import { useSocialEligibility } from "@/hooks/useSocialEligibility";

/**
 * The Buscar section, and the only thing in the portal that discovery
 * eligibility gates.
 *
 * `UserSearchPanel` is not merely hidden when the viewer is ineligible — it is
 * NOT MOUNTED. That matters: `useUserSearch` and `useSentRequests` live inside
 * it, so an unmounted panel cannot fire `search_public_users` or
 * `get_sent_friend_requests` at all. Gating with a disabled input or an
 * `enabled: false` flag would leave those hooks one refactor away from
 * querying again; not rendering them is a guarantee rather than a setting.
 *
 * Amigos and Solicitudes are deliberately NOT gated. A private account keeps
 * every relationship it already has and every decision it still owes — see
 * FriendsView. Privacy governs discovery, not the friendships already formed.
 */
export default function SearchSection({
  onGoToRequests,
}: {
  onGoToRequests: () => void;
}) {
  const { hasUsername, isProfilePublic, isLoading, isError, refetch } =
    useSocialEligibility();

  // Until the profile row is read, show the list skeleton rather than a gate.
  // Flashing "Elige tu nombre de usuario" at somebody who already has one is
  // worse than a moment of nothing.
  if (isLoading) return <SocialListSkeleton rows={3} />;

  // We could not read the profile, so we do not KNOW which gate applies.
  // Saying "elige tu nombre de usuario" to somebody who already has one would
  // be a confident wrong answer; a retry is the honest one. Search still does
  // not run, so no RPC fires either way.
  if (isError) {
    return (
      <SocialErrorState
        title="No pudimos comprobar tu perfil"
        onRetry={refetch}
      />
    );
  }

  // Order matters: without a username the privacy switch cannot even be turned
  // on (the profile card disables it), so naming the username first is the
  // only instruction that can actually be followed.
  if (!hasUsername) return <UsernameRequiredState />;
  if (!isProfilePublic) return <PrivateProfileState />;

  return <UserSearchPanel onGoToRequests={onGoToRequests} />;
}

/** No username: discovery is username-based, so there is nothing to search by. */
function UsernameRequiredState() {
  return (
    <SocialStatePanel title="Elige tu nombre de usuario">
      <p>
        Necesitas un nombre de usuario para buscar personas y utilizar las
        funciones de descubrimiento de Amigos.
      </p>
      {/* Sends the user to the existing profile card rather than repeating the
          username field here — there is one place that owns this setting. */}
      <SocialPanelLink label="Configurar mi perfil" href="/profile" />
    </SocialStatePanel>
  );
}

/** Has a username but is private: discovery is reciprocal, so it stays closed. */
function PrivateProfileState() {
  return (
    <SocialStatePanel title="Tu perfil está privado">
      <p>
        Activa tu perfil público para buscar usuarios, aparecer en búsquedas y
        enviar nuevas solicitudes de amistad.
      </p>
      <p className="mt-2">
        Tus amigos actuales y tus solicitudes pendientes siguen funcionando
        normalmente.
      </p>
      <SocialPanelLink label="Hacer público mi perfil" href="/profile" />
    </SocialStatePanel>
  );
}
