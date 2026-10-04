"use client";

import { Clock, Inbox } from "lucide-react";
import SocialAvatar from "@/components/social/SocialAvatar";
import {
  SocialActionButton,
  SocialCard,
  SocialErrorState,
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
import {
  useAcceptFriendRequest,
  useReceivedRequests,
  useRejectFriendRequest,
} from "@/hooks/useFriendRequests";
import { formatRequestAge, socialDisplayName } from "@/lib/social/display";
import type { ReceivedFriendRequest } from "@/types/social";

/**
 * «Solicitudes» — requests waiting for this user's decision.
 *
 * Shows avatar, username and the rank the sender's XP implies (the pill and the
 * ring colour both come from `getRankFromXP`, the SAME function the leaderboard
 * and the profile use; there is no second ladder and no stored rank). Nothing private appears —
 * `get_received_friend_requests` returns no name, phone, email or order data.
 *
 * Accept and reject are one mutation instance each for the whole list, with the
 * busy row identified by the in-flight request id. Both go through the
 * transactional RPCs: the component never touches `friendships` or flips a
 * request's status itself.
 */
export default function ReceivedRequestsPanel({
  onGoToSearch,
}: {
  onGoToSearch: () => void;
}) {
  const { requests, isLoading, isError, refetch } = useReceivedRequests();

  const accept = useAcceptFriendRequest({
    onSuccess: () => socialSuccessToast("Solicitud aceptada"),
    onError: socialErrorAlert,
  });

  const reject = useRejectFriendRequest({
    onSuccess: () => socialSuccessToast("Solicitud rechazada"),
    onError: socialErrorAlert,
  });

  if (isLoading) return <SocialListSkeleton rows={3} />;

  if (isError) {
    return (
      <SocialErrorState
        title="No pudimos cargar tus solicitudes"
        onRetry={refetch}
      />
    );
  }

  if (requests.length === 0) {
    return (
      <SocialStatePanel
        title="No tienes solicitudes pendientes"
        icon={<Inbox size={22} strokeWidth={1.5} />}
      >
        <p>
          Cuando alguien te envíe una solicitud de amistad, aparecerá aquí para
          que la aceptes o la rechaces.
        </p>
        <SocialPanelAction label="Buscar personas" onClick={onGoToSearch} />
      </SocialStatePanel>
    );
  }

  return (
    <SocialList>
      {requests.map((request) => (
        <RequestRow
          key={request.requestId}
          request={request}
          onAccept={() => accept.mutate(request.requestId)}
          onReject={() => reject.mutate(request.requestId)}
          // A decision is in flight for THIS request, so both of its buttons
          // lock — accepting and rejecting the same request at once is the one
          // double-click that could race.
          isAccepting={
            accept.isPending && accept.variables === request.requestId
          }
          isRejecting={
            reject.isPending && reject.variables === request.requestId
          }
        />
      ))}
    </SocialList>
  );
}

function RequestRow({
  request,
  onAccept,
  onReject,
  isAccepting,
  isRejecting,
}: {
  request: ReceivedFriendRequest;
  onAccept: () => void;
  onReject: () => void;
  isAccepting: boolean;
  isRejecting: boolean;
}) {
  const busy = isAccepting || isRejecting;

  // The sender may have no username. A request from them is still a request,
  // and it must stay answerable. `get_received_friend_requests` returns no
  // full name, so there is nothing to fall back to but the anonymous label.
  const name = socialDisplayName(request.username);
  const age = formatRequestAge(request.requestedAt);

  return (
    <SocialCard
      avatar={
        <SocialRingAvatar xp={request.experiencePoints}>
          <SocialAvatar
            username={request.username}
            avatarUrl={request.avatarUrl}
            size={52}
          />
        </SocialRingAvatar>
      }
      actions={
        <>
          <SocialActionButton
            label="Aceptar"
            tone="solid"
            pendingLabel="…"
            pending={isAccepting}
            disabled={busy}
            onClick={onAccept}
            accessibleName={`Aceptar la solicitud de ${name}`}
          />
          <SocialActionButton
            label="Rechazar"
            pendingLabel="…"
            tone="ghost"
            pending={isRejecting}
            disabled={busy}
            onClick={onReject}
            accessibleName={`Rechazar la solicitud de ${name}`}
          />
        </>
      }
    >
      <SocialRowTitle>{name}</SocialRowTitle>
      <div className="mt-2.5">
        <SocialRankPill xp={request.experiencePoints} />
      </div>
      {age && (
        <SocialSnippet icon={<Clock size={13} strokeWidth={1.7} />}>
          Quiere ser tu amigo · {age}
        </SocialSnippet>
      )}
    </SocialCard>
  );
}
