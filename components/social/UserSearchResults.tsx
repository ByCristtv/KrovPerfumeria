"use client";

import SocialAvatar from "@/components/social/SocialAvatar";
import RelationshipAction from "@/components/social/RelationshipAction";
import {
  SocialList,
  SocialRow,
  SocialRowTitle,
  SocialStatePanel,
  SocialPanelAction,
  SocialListSkeleton,
} from "@/components/social/socialUi";
import { SOCIAL_SEARCH_MIN_LENGTH, type SocialSearchUser } from "@/types/social";

/**
 * The results list and every state it can be in.
 *
 * Each row shows exactly what discovery is allowed to expose — a username, a
 * picture, and how the viewer stands with that account. No full name, phone,
 * email, address, order history or XP: `search_public_users` does not return
 * them, and this component could not render them if it wanted to.
 *
 * The mutations live one level up in UserSearchPanel, which owns the hooks; a
 * row only reports which person was clicked. That keeps one mutation instance
 * for the whole list instead of one per row, which is also what makes "only
 * THIS row shows Enviando…" expressible — the panel compares the in-flight
 * user id against the row's.
 */
export default function UserSearchResults({
  users,
  sentRequestsByUserId,
  onAdd,
  onCancel,
  onRespond,
  sendingUserId,
  cancellingRequestId,
}: {
  users: SocialSearchUser[];
  /** targetUserId → requestId, for cancelling without an N+1 lookup. */
  sentRequestsByUserId: ReadonlyMap<string, string>;
  onAdd: (userId: string) => void;
  onCancel: (requestId: string) => void;
  onRespond: () => void;
  /** Which row has a send in flight, so only that button shows pending. */
  sendingUserId: string | null;
  cancellingRequestId: string | null;
}) {
  return (
    <SocialList>
      {users.map((user) => {
        const requestId = sentRequestsByUserId.get(user.userId);

        return (
          <SocialRow
            key={user.userId}
            avatar={
              <SocialAvatar
                username={user.username}
                avatarUrl={user.avatarUrl}
              />
            }
            actions={
              <RelationshipAction
                status={user.relationshipStatus}
                username={user.username}
                pendingRequestId={requestId}
                onAdd={() => onAdd(user.userId)}
                onCancel={onCancel}
                onRespond={onRespond}
                isSending={sendingUserId === user.userId}
                isCancelling={!!requestId && cancellingRequestId === requestId}
              />
            }
          >
            <SocialRowTitle>{user.username}</SocialRowTitle>
          </SocialRow>
        );
      })}
    </SocialList>
  );
}

/** Nothing typed yet — the state the section opens in. */
export function UserSearchIdleState() {
  return (
    <SocialStatePanel title="Busca a tus amigos por su nombre de usuario">
      Escribe al menos {SOCIAL_SEARCH_MIN_LENGTH} caracteres. Solo aparecen las
      personas que activaron su perfil público desde su cuenta.
    </SocialStatePanel>
  );
}

/** The search ran and matched nobody. */
export function UserSearchEmptyState({ query }: { query: string }) {
  return (
    <SocialStatePanel title={`Nadie coincide con «${query}»`}>
      Revisa cómo se escribe, o pídele a esa persona que active su perfil
      público desde su cuenta para poder encontrarla.
    </SocialStatePanel>
  );
}

/**
 * The search failed. Says nothing about why — the Postgres message is logged in
 * `searchPublicUsers` and stays there.
 */
export function UserSearchErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <SocialStatePanel title="No pudimos completar la búsqueda">
      <p>Vuelve a intentarlo en unos segundos.</p>
      <SocialPanelAction label="Reintentar" onClick={onRetry} />
    </SocialStatePanel>
  );
}

/** Row placeholders, sized to the real rows so the list does not jump on load. */
export function UserSearchSkeleton({ rows = 4 }: { rows?: number }) {
  return <SocialListSkeleton rows={rows} />;
}
