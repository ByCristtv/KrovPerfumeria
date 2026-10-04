"use client";

import { useMemo, useState } from "react";
import { Calendar, Search, ShoppingBag, UserMinus, Users, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import SocialAvatar from "@/components/social/SocialAvatar";
import SocialMenu from "@/components/social/SocialMenu";
import {
  SocialCard,
  SocialErrorState,
  SocialHandle,
  SocialList,
  SocialListSkeleton,
  SocialPanelAction,
  SocialRankPill,
  SocialRingAvatar,
  SocialRowTitle,
  SocialSnippet,
  SocialStatePanel,
} from "@/components/social/socialUi";
import {
  socialErrorAlert,
  socialSuccessToast,
} from "@/components/social/socialAlerts";
import { useFriends, useRemoveFriend } from "@/hooks/useFriends";
import {
  formatFriendsSince,
  normalizeForSearch,
  socialHandle,
  socialHeadline,
} from "@/lib/social/display";
import type { Friend } from "@/types/social";

/** Below this the list fits on a screen and a filter box is just chrome. */
const FILTER_THRESHOLD = 6;

/**
 * «Amigos» — the established friendships, as a grid of cards.
 *
 * Each card shows what a friend has agreed to share: name, username, the rank
 * their XP implies (via `getRankFromXP`, the one ladder this codebase has) and,
 * when they have one, the fragrance they bought most recently. Still nothing
 * private — `get_friends` returns no phone, email, address, price, quantity or
 * date of any order.
 *
 * The primary action is "Ver perfil" (the whole card is that link — see
 * SocialCard). Removing a friend is no longer a button on the card: it sits in
 * the "•••" menu, one deliberate step away, and still ends in a confirmation
 * dialog. Taking the destructive action off the face of every card is the point
 * of the redesign; the dialog's wording and the removal itself are unchanged.
 *
 * Removal is confirmed in a Modal, not `window.confirm`: it is destructive, it
 * changes what each person can see, and `Modal` is the dialog the customer-facing
 * /profile already uses (portal, focus trap, ESC).
 */
export default function FriendsList({
  onGoToSearch,
}: {
  onGoToSearch: () => void;
}) {
  const { friends, isLoading, isError, refetch } = useFriends();
  const [filter, setFilter] = useState("");

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
      // drop the card. Leaving the dialog open would invite a retry of
      // something that already happened.
      setPendingRemoval(null);
      socialErrorAlert(error);
    },
  });

  const needle = normalizeForSearch(filter);
  const visible = useMemo(() => {
    if (!needle) return friends;
    return friends.filter((friend) =>
      normalizeForSearch(
        `${friend.fullName ?? ""} ${friend.username ?? ""}`
      ).includes(needle)
    );
  }, [friends, needle]);

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
      <SocialStatePanel
        title="Aún no tienes amigos"
        icon={<Users size={22} strokeWidth={1.5} />}
      >
        <p>
          Busca a otras personas por su nombre de usuario y envíales una
          solicitud para empezar.
        </p>
        <SocialPanelAction label="Buscar personas" onClick={onGoToSearch} />
      </SocialStatePanel>
    );
  }

  const showFilter = friends.length >= FILTER_THRESHOLD;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <p className="text-[11px] uppercase tracking-[0.2em] text-krov-dust">
          {friends.length} {friends.length === 1 ? "amigo" : "amigos"}
        </p>

        {showFilter && (
          <div className="relative w-full sm:w-72">
            <label htmlFor="friends-filter" className="sr-only">
              Filtrar amigos por nombre
            </label>
            <Search
              size={16}
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-krov-dust"
            />
            <input
              id="friends-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filtrar amigos"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-full border border-krov-smoke bg-white/[0.03] py-2.5 pl-11 pr-10 text-sm text-krov-bone outline-none transition-[border-color,box-shadow] placeholder:text-krov-dust/70 focus:border-krov-blood/70 focus:shadow-[0_0_24px_-6px_rgba(255,11,85,0.45)] [&::-webkit-search-cancel-button]:appearance-none"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                aria-label="Limpiar filtro"
                className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-krov-dust transition-colors hover:text-krov-bone"
              >
                <X size={15} aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <SocialStatePanel title={`Ningún amigo coincide con «${filter.trim()}»`}>
          Revisa cómo se escribe, o busca a esa persona para enviarle una
          solicitud.
        </SocialStatePanel>
      ) : (
        <SocialList>
          {visible.map((friend) => {
            // A friendship formed before this person cleared their username is
            // still a friendship; it gets a name to render, not an exception.
            const name = socialHeadline(friend.username, friend.fullName);
            const handle = socialHandle(friend.username);
            const since = formatFriendsSince(friend.friendsSince);

            return (
              <SocialCard
                key={friend.friendshipId}
                href={`/friends/${friend.userId}`}
                linkLabel={`Ver el perfil de ${name}`}
                avatar={
                  <SocialRingAvatar xp={friend.experiencePoints}>
                    <SocialAvatar
                      username={friend.username}
                      fullName={friend.fullName}
                      avatarUrl={friend.avatarUrl}
                      size={52}
                    />
                  </SocialRingAvatar>
                }
                menu={
                  <SocialMenu
                    label={`Más opciones de ${name}`}
                    items={[
                      {
                        label: "Eliminar amigo",
                        icon: <UserMinus size={16} strokeWidth={1.7} />,
                        tone: "danger",
                        disabled: remove.isPending,
                        // Only opens the dialog — the mutation runs from there.
                        onSelect: () => setPendingRemoval(friend),
                      },
                    ]}
                  />
                }
              >
                <SocialRowTitle>{name}</SocialRowTitle>
                {/* Suppressed when the username IS the headline, which is what
                    happens for a friend with no full name. */}
                {handle && name !== friend.username && (
                  <SocialHandle>{handle}</SocialHandle>
                )}
                <div className="mt-2.5">
                  <SocialRankPill xp={friend.experiencePoints} />
                </div>

                {friend.lastPurchase ? (
                  <SocialSnippet icon={<ShoppingBag size={13} strokeWidth={1.7} />}>
                    Última compra:{" "}
                    <span className="text-krov-bone">
                      {friend.lastPurchase.productName}
                    </span>
                    {friend.lastPurchase.brandName
                      ? ` · ${friend.lastPurchase.brandName}`
                      : ""}
                  </SocialSnippet>
                ) : (
                  since && (
                    <SocialSnippet icon={<Calendar size={13} strokeWidth={1.7} />}>
                      Amigos desde {since}
                    </SocialSnippet>
                  )
                )}
              </SocialCard>
            );
          })}
        </SocialList>
      )}

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
          ? `¿Eliminar a ${socialHeadline(
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
