"use client";

import {
  SocialActionButton,
  SocialStatusChip,
} from "@/components/social/socialUi";
import type { RelationshipStatus } from "@/types/social";

/**
 * What a search result offers, per relationship state.
 *
 * MVP 1 rendered all four states as read-only. MVP 2 makes two of them act:
 *
 *   none              → «Agregar»               sends a request
 *   outgoing_pending  → «Pendiente» + «Cancelar» withdraws it
 *   incoming_pending  → «Solicitud recibida» + «Responder» → Solicitudes tab
 *   friends           → «Amigos»                (removal lives in the list)
 *
 * Two deliberate omissions:
 *
 * Accept/Reject are NOT offered here. They belong to a request, not to a search
 * result, and the Solicitudes tab already owns that interaction with the avatar,
 * the rank and the date attached. Duplicating the buttons would mean a second
 * accept path to keep in sync for no new capability — so this state routes to
 * the one that exists instead. The underlying hooks are shared either way.
 *
 * Removing a friend is NOT offered here either. It is destructive and needs a
 * confirmation dialog; putting it behind an «Amigos» chip in a search list is
 * how people unfriend somebody by accident. FriendsList owns it.
 *
 * This component holds no relationship state of its own. `status` always comes
 * from the server via `search_public_users`; a click runs a mutation, the
 * mutation invalidates the search cache, and the refetched row is what changes
 * the button. Nothing is faked locally, so the UI cannot claim a relationship
 * the database refused.
 */
export default function RelationshipAction({
  status,
  username,
  /** Present only for `outgoing_pending`, and only once sent requests load. */
  pendingRequestId,
  onAdd,
  onCancel,
  onRespond,
  isSending = false,
  isCancelling = false,
}: {
  status: RelationshipStatus;
  username: string;
  pendingRequestId?: string;
  onAdd: () => void;
  onCancel: (requestId: string) => void;
  /** Sends the user to the Solicitudes section. */
  onRespond: () => void;
  isSending?: boolean;
  isCancelling?: boolean;
}) {
  if (status === "none") {
    return (
      <SocialActionButton
        label="Agregar"
        pendingLabel="Enviando…"
        pending={isSending}
        onClick={onAdd}
        accessibleName={`Enviar solicitud de amistad a ${username}`}
      />
    );
  }

  if (status === "outgoing_pending") {
    return (
      <>
        <SocialStatusChip
          label="Pendiente"
          accessiblePrefix={username}
          title="Ya le enviaste una solicitud"
        />
        <SocialActionButton
          label="Cancelar"
          pendingLabel="…"
          tone="ghost"
          pending={isCancelling}
          // The id comes from the sent-requests list, which loads alongside the
          // search. Until it arrives there is nothing to cancel BY, so the
          // button waits rather than firing a call it cannot address.
          disabled={!pendingRequestId}
          onClick={() => pendingRequestId && onCancel(pendingRequestId)}
          accessibleName={`Cancelar la solicitud enviada a ${username}`}
        />
      </>
    );
  }

  if (status === "incoming_pending") {
    return (
      <>
        <SocialStatusChip
          label="Solicitud recibida"
          accessiblePrefix={username}
          title="Esta persona te envió una solicitud"
        />
        <SocialActionButton
          label="Responder"
          tone="ghost"
          onClick={onRespond}
          accessibleName={`Responder la solicitud de ${username} en Solicitudes`}
        />
      </>
    );
  }

  return (
    <SocialStatusChip
      label="Amigos"
      accessiblePrefix={username}
      accent
      title="Ya son amigos"
    />
  );
}
