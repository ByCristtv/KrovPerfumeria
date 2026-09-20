"use client";

import { useState } from "react";
import Modal from "@/components/ui/Modal";
import SocialAvatar from "@/components/social/SocialAvatar";
import {
  SocialActionButton,
  SocialErrorState,
  SocialList,
  SocialListSkeleton,
  SocialPanelAction,
  SocialRow,
  SocialRowMeta,
  SocialRowTitle,
  SocialStatePanel,
} from "@/components/social/socialUi";
import {
  socialErrorAlert,
  socialSuccessToast,
} from "@/components/social/socialAlerts";
import { useFriends, useRemoveFriend } from "@/hooks/useFriends";
import { getRankFromXP } from "@/lib/rank";
import { socialDisplayName } from "@/lib/social/display";
import { formatXp } from "@/lib/format";
import type { Friend } from "@/types/social";

/**
 * «Amigos» — the established friendships.
 *
 * Each row shows what a friend has agreed to share: username, real name, and
 * the rank their XP implies (via `getRankFromXP`, the one ladder this codebase
 * has). Still nothing private — `get_friends` returns no phone, email, address
 * or order data, so there is none to leak.
 *
 * The identity area links to /friends/[userId]; the "Eliminar" button sits
 * OUTSIDE that link (see SocialRow), so tapping a name never removes anybody
 * and tapping Eliminar never navigates.
 *
 * Removal is confirmed in a Modal, not `window.confirm` and not a bare button:
 * it is destructive, it changes what each person can see, and `Modal` is the
 * dialog the customer-facing /profile already uses (portal, focus trap, ESC).
 */
export default function FriendsList({
  onGoToSearch,
}: {
  onGoToSearch: () => void;
}) {
  const { friends, isLoading, isError, refetch } = useFriends();

  // Which friend the confirmation dialog is about. Holding the FRIEND (not a
  // boolean) is what lets the dialog name them, and clearing it is what closes
  // the dialog — one piece of state, no way for the two to disagree.
  const [pendingRemoval, setPendingRemoval] = useState<Friend | null>(null);

  const remove = useRemoveFriend({
    onSuccess: () => {
      setPendingRemoval(null);
      socialSuccessToast("Amigo eliminado");
    },
    onError: (error) => {
      // The dialog closes either way: on a stale error the friendship is
      // already gone, and useSocialMutation has queued the refetch that will
      // drop the row. Leaving the dialog open would invite a retry of
      // something that already happened.
      setPendingRemoval(null);
      socialErrorAlert(error);
    },
  });

  if (isLoading) return <SocialListSkeleton rows={3} />;

  if (isError) {
    return (
      <SocialErrorState
        title="No pudimos cargar tu lista de amigos"
        onRetry={refetch}
      />
    );
  }

  if (friends.length === 0) {
    return (
      <SocialStatePanel title="Aún no tienes amigos">
        <p>
          Busca a otras personas por su nombre de usuario y envíales una
          solicitud para empezar.
        </p>
        <SocialPanelAction label="Buscar personas" onClick={onGoToSearch} />
      </SocialStatePanel>
    );
  }

  return (
    <>
      <SocialList>
        {friends.map((friend) => {
          // A friendship formed before this person cleared their username is
          // still a friendship; it gets a name to render, not an exception.
          const name = socialDisplayName(friend.username, friend.fullName);

          return (
          <SocialRow
            key={friend.friendshipId}
            href={`/friends/${friend.userId}`}
            linkLabel={`Ver el perfil de ${name}`}
            avatar={
              <SocialAvatar
                username={friend.username}
                fullName={friend.fullName}
                avatarUrl={friend.avatarUrl}
              />
            }
            actions={
              <SocialActionButton
                label="Eliminar"
                tone="ghost"
                // Only opens the dialog — the mutation runs from there.
                onClick={() => setPendingRemoval(friend)}
                disabled={remove.isPending}
                accessibleName={`Eliminar a ${name} de tus amigos`}
              />
            }
          >
            <SocialRowTitle>{name}</SocialRowTitle>
            <SocialRowMeta>
              {/* Suppressed when the full name is already the title, which is
                  what happens for a friend with no username. */}
              {friend.fullName && friend.fullName !== name
                ? `${friend.fullName} · `
                : ""}
              {getRankFromXP(friend.experiencePoints)} ·{" "}
              {formatXp(friend.experiencePoints)} XP
            </SocialRowMeta>
          </SocialRow>
          );
        })}
      </SocialList>

      <RemoveFriendDialog
        friend={pendingRemoval}
        removing={remove.isPending}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={(friend) => remove.mutate(friend.userId)}
      />
    </>
  );
}

/**
 * The destructive confirmation.
 *
 * Says what is lost and what is not: ending a friendship is reversible by
 * sending a new request, and people hesitate less when that is stated than when
 * they have to guess.
 */
function RemoveFriendDialog({
  friend,
  removing,
  onCancel,
  onConfirm,
}: {
  friend: Friend | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: (friend: Friend) => void;
}) {
  return (
    <Modal
      open={friend !== null}
      onClose={() => !removing && onCancel()}
      title="Eliminar amigo"
      subtitle={
        friend
          ? `¿Eliminar a ${socialDisplayName(
              friend.username,
              friend.fullName
            )} de tus amigos?`
          : undefined
      }
      closeOnBackdrop={!removing}
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-white/70">
          Dejarán de ser amigos y ninguno de los dos verá el perfil social del
          otro. Puedes volver a enviarle una solicitud más adelante.
        </p>

        {/*
          A purpose-built footer rather than the shared profile modal actions:
          that one is labelled "Guardar", which is the wrong verb for a
          destructive confirmation. The layout otherwise matches the profile
          modals exactly.
        */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={removing}
            className="flex-1 rounded-lg border border-white/20 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/5 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => friend && onConfirm(friend)}
            disabled={removing}
            className="flex-1 rounded-lg bg-krov-blood py-2.5 text-sm font-medium text-black transition hover:bg-krov-crimson disabled:opacity-50"
          >
            {removing ? "Eliminando…" : "Eliminar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
