"use client";

import { useId, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useUserSearch } from "@/hooks/useUserSearch";
import {
  useCancelFriendRequest,
  useSendFriendRequest,
  useSentRequests,
} from "@/hooks/useFriendRequests";
import {
  socialErrorAlert,
  socialSuccessToast,
} from "@/components/social/socialAlerts";
import { SOCIAL_SEARCH_MIN_LENGTH } from "@/types/social";
// The upper bound is the username rule itself, reused rather than restated: no
// username can exceed it, so a longer term could never match anything.
import { USERNAME_MAX_LENGTH } from "@/schemas/ranking";
import UserSearchResults, {
  UserSearchEmptyState,
  UserSearchErrorState,
  UserSearchIdleState,
  UserSearchSkeleton,
} from "@/components/social/UserSearchResults";

/**
 * The search box plus whichever state the results are in.
 *
 * The raw input is local component state; everything that came from the server
 * lives in React Query (see useUserSearch). Nothing about a result set is
 * copied into local state, so what is rendered is always what the cache holds.
 *
 * State precedence is deliberate and is read top to bottom below:
 *   idle → error → loading → empty → results.
 * `isPending` (typed ≠ searched) is handled by NOT falling back to the idle or
 * empty panel while the debounce is settling — the previous results stay put
 * and only dim, so the list does not flash between every word.
 *
 * MVP 2 adds the send/cancel mutations HERE rather than inside each row, so the
 * whole list shares one instance of each. The row that is busy is identified by
 * comparing the in-flight id — `useMutation.variables` — against the row's own,
 * which is what keeps «Enviando…» on the button that was actually clicked.
 *
 * `useSentRequests` is the other half of cancellation: `search_public_users`
 * says a request is pending but not which request it is, so the panel loads the
 * sent list ONCE and every row looks itself up in that map. One extra query for
 * the page, not one per result.
 */
export default function UserSearchPanel({
  onGoToRequests,
}: {
  /** Switches the portal to Solicitudes, for an `incoming_pending` result. */
  onGoToRequests: () => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [term, setTerm] = useState("");

  const { query, users, isLoading, isError, isIdle, isPending, refetch } =
    useUserSearch(term);

  const sentRequests = useSentRequests();

  // True from the first keystroke until results for it land: the debounce
  // window (`isPending`) plus the request itself (`isLoading`).
  const searching = !isIdle && (isPending || isLoading);

  // Feedback is identical for every social mutation: a brief toast on success,
  // a readable Spanish alert on failure. The cache invalidation that actually
  // flips «Agregar» to «Pendiente» happens inside useSocialMutation.
  const send = useSendFriendRequest({
    onSuccess: () => socialSuccessToast("Solicitud enviada"),
    onError: socialErrorAlert,
  });

  const cancel = useCancelFriendRequest({
    onSuccess: () => socialSuccessToast("Solicitud cancelada"),
    onError: socialErrorAlert,
  });

  return (
    <div>
      {/* No <form>: there is no submit step. Results follow the debounced value,
          so an Enter key has nothing left to do — and a form would reload the
          page on Enter unless its default were suppressed. */}
      <div className="relative mx-auto max-w-xl">
        <label htmlFor={inputId} className="sr-only">
          Buscar personas por nombre de usuario
        </label>
        {/* The icon doubles as the "working" indicator: it becomes a spinner
            while the debounce settles or the query runs, so typing always has
            visible feedback even before any result changes. */}
        {searching ? (
          <Loader2
            size={18}
            aria-hidden
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 animate-spin text-krov-rose motion-reduce:animate-none"
          />
        ) : (
          <Search
            size={18}
            aria-hidden
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-krov-rose/80"
          />
        )}
        <input
          id={inputId}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="aurora.cr"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={USERNAME_MAX_LENGTH}
          aria-describedby={hintId}
          className="w-full rounded-full border border-krov-smoke bg-white/[0.04] py-4 pl-13 pr-12 text-base text-krov-bone shadow-[0_8px_30px_rgba(0,0,0,0.35)] outline-none backdrop-blur-sm transition-[border-color,box-shadow] duration-300 placeholder:text-krov-dust/70 focus:border-krov-blood/70 focus:shadow-[0_0_0_1px_rgba(255,11,85,0.35),0_0_36px_-6px_rgba(255,11,85,0.5)] [&::-webkit-search-cancel-button]:appearance-none sm:text-sm"
        />
        {term && (
          <button
            type="button"
            onClick={() => setTerm("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-2.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-krov-dust transition-colors hover:bg-white/[0.06] hover:text-krov-bone"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      <p id={hintId} className="mt-3 text-center text-xs text-krov-dust">
        Mínimo {SOCIAL_SEARCH_MIN_LENGTH} caracteres. Solo se muestran las
        cuentas con perfil público.
      </p>

      {/*
        aria-live so a screen reader is told the list changed — the results
        appear without any navigation or submit, which is otherwise silent.
        "polite" rather than "assertive": it must not interrupt typing.
      */}
      <div
        aria-live="polite"
        aria-busy={isLoading}
        className={`mt-8 transition-opacity duration-200 ${
          isPending && !isIdle ? "opacity-60" : "opacity-100"
        }`}
      >
        {isIdle ? (
          <UserSearchIdleState />
        ) : isError ? (
          <UserSearchErrorState onRetry={refetch} />
        ) : isLoading ? (
          <UserSearchSkeleton />
        ) : users.length === 0 ? (
          // Held back while the debounce settles: showing "nobody matches
          // «au»" for 350ms on the way to "aurora" is noise, not feedback.
          isPending ? (
            <UserSearchSkeleton />
          ) : (
            <UserSearchEmptyState query={query} />
          )
        ) : (
          <UserSearchResults
            users={users}
            sentRequestsByUserId={sentRequests.byUserId}
            onAdd={(userId) => send.mutate(userId)}
            onCancel={(requestId) => cancel.mutate(requestId)}
            onRespond={onGoToRequests}
            // `variables` is the id passed to the in-flight mutate() call, so
            // the pending state lands on the clicked row and nowhere else.
            sendingUserId={send.isPending ? (send.variables ?? null) : null}
            cancellingRequestId={
              cancel.isPending ? (cancel.variables ?? null) : null
            }
          />
        )}
      </div>
    </div>
  );
}
