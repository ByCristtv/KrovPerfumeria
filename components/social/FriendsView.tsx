"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuthUser } from "@/hooks/useAuthUser";
import FriendsPortalTabs, {
  type FriendsSection,
} from "@/components/social/FriendsPortalTabs";
import FriendsList from "@/components/social/FriendsList";
import ReceivedRequestsPanel from "@/components/social/ReceivedRequestsPanel";
import SearchSection from "@/components/social/SearchSection";
import { SocialListSkeleton } from "@/components/social/socialUi";
import { useReceivedRequests } from "@/hooks/useFriendRequests";

/**
 * /friends — the social portal.
 *
 * MVP 1 gave it one job (finding people); MVP 2 makes it the three-section
 * portal the feature was designed around: Amigos · Solicitudes · Buscar. The
 * route did not move, so links made during MVP 1 still land here.
 *
 * Client-rendered, like /profile and for the same reasons: every list depends
 * on who is asking (`auth.uid()` inside each RPC), so there is nothing a server
 * render could cache or share between visitors — and the auth session this app
 * keeps lives in the browser client.
 *
 * The section lives in component state rather than the URL. A `?tab=` param
 * would be linkable, but reading it needs `useSearchParams`, which forces this
 * statically-prerendered route into a Suspense boundary — and the auth gate
 * below already interrupts any deep link with a redirect. Not worth the
 * complexity for a portal a user reaches from the navbar.
 *
 * `useReceivedRequests` is called HERE, one level above the Solicitudes panel,
 * because the tab badge needs the count even while the friends list is showing.
 * React Query dedupes it against the panel's own call — same key, one request.
 */
export default function FriendsView() {
  const router = useRouter();
  const { user, isLoading } = useAuthUser();
  const [section, setSection] = useState<FriendsSection>("friends");

  const { count: requestCount } = useReceivedRequests();

  // Discovery is authenticated-only — every social RPC raises
  // `authentication_required` for a guest. `replace` (not push) so Back doesn't
  // bounce between the two, matching ProfileView.
  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return <FriendsSkeleton />;
  }

  return (
    <div className="relative min-h-screen bg-krov-void">
      <div
        aria-hidden
        className="krov-aura-wine pointer-events-none absolute -top-32 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 opacity-60"
      />

      <div className="relative mx-auto max-w-2xl px-5 pt-28 pb-24 sm:px-8 md:pt-36">
        {/* Rendered identically by the skeleton, so it does not animate: only
            what was a placeholder a moment ago rises in. */}
        <FriendsHeader />

        {/* Not animated: the pill is a backdrop-blur surface, and fading its
            wrapper would blank the blur mid-fade. It swaps in place at the
            skeleton bar's exact size instead. */}
        <div className="mt-10 sm:mt-12">
          <FriendsPortalTabs
            value={section}
            onChange={setSection}
            requestCount={requestCount}
          />
        </div>

        {/*
          Each section is mounted only while selected, so switching away drops
          the search box's text and the list's scroll. React Query keeps the
          DATA cached across the unmount, so coming back is instant and does not
          re-fetch — only the transient UI state resets, which is what you want
          from a tab.
        */}
        <div className="mt-8 sm:mt-10">
          {section === "friends" && (
            <FriendsList onGoToSearch={() => setSection("search")} />
          )}
          {section === "requests" && (
            <ReceivedRequestsPanel onGoToSearch={() => setSection("search")} />
          )}
          {/* Only Buscar is gated on discovery eligibility (see
              SearchSection). Amigos and Solicitudes stay open to everyone
              signed in, including a private account or one with no username:
              privacy governs discovery, not relationships already formed. */}
          {section === "search" && (
            <SearchSection onGoToRequests={() => setSection("requests")} />
          )}
        </div>

        <p className="mt-10 text-center text-xs leading-relaxed text-krov-dust">
          ¿No apareces en las búsquedas de tus amigos?{" "}
          <Link href="/profile" className="krov-underline text-krov-rose">
            Haz público tu perfil
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

/** Static masthead, shared by the page and its skeleton. */
function FriendsHeader() {
  return (
    <header className="text-center">
      <p className="krov-eyebrow mb-5">Amigos</p>
      <h1 className="krov-display text-4xl text-krov-bone md:text-6xl">
        Tu círculo
      </h1>
      <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-krov-ash">
        Encuentra a otras personas por su nombre de usuario, responde tus
        solicitudes y administra tu lista de amigos.
      </p>
    </header>
  );
}

/**
 * Shown while auth resolves, so a signed-in user never sees a guest flash.
 *
 * Mirrors the real page rather than approximating it: the same wine aura and
 * container, the REAL header (static copy, known before auth), a tab bar at the
 * pill's exact height, and `SocialListSkeleton rows={3}` — the very placeholder
 * FriendsList shows while its query runs. So auth resolving → list loading is
 * a no-op on screen, and the only visible change is the rows arriving.
 */
function FriendsSkeleton() {
  return (
    <div className="relative min-h-screen bg-krov-void">
      <div
        aria-hidden
        className="krov-aura-wine pointer-events-none absolute -top-32 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 opacity-60"
      />
      <p role="status" className="sr-only">
        Cargando…
      </p>

      <div className="relative mx-auto max-w-2xl px-5 pt-28 pb-24 sm:px-8 md:pt-36">
        <FriendsHeader />

        {/* FriendsPortalTabs: p-1 + border + a py-2.5 label whose line is 15px
            (text-[10px]) on phones and 16px (text-xs) from sm up. */}
        <div className="krov-skeleton mt-10 sm:mt-12" aria-hidden>
          <div className="mx-auto h-[45px] w-full rounded-full bg-white/[0.06] sm:h-[46px] sm:w-[26rem]" />
        </div>

        <div className="mt-8 sm:mt-10">
          <SocialListSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
