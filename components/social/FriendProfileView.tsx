"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import SocialAvatar from "@/components/social/SocialAvatar";
import { SocialStatePanel } from "@/components/social/socialUi";
import PurchasedFragrances, {
  PurchasedFragrancesEmptyState,
  PurchasedFragrancesErrorState,
  PurchasedFragrancesSkeleton,
} from "@/components/social/PurchasedFragrances";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useFriendProfile, useFriendPurchases } from "@/hooks/useFriendProfile";
import { getRankFromXP } from "@/lib/rank";
import { socialDisplayName } from "@/lib/social/display";
import { formatXp } from "@/lib/format";

/**
 * /friends/[userId] — a friend's social profile.
 *
 * Authorization is NOT this component's job. `get_friend_profile` and
 * `get_friend_purchased_products` both re-check `social_are_friends` on every
 * single call, so the page cannot show protected data to a non-friend even if
 * every guard below were deleted. What this file decides is only how a refusal
 * LOOKS.
 *
 * And it looks like one thing. "No existe", "ya no son amigos" and "no tienes
 * acceso" collapse into a single unavailable panel, because distinguishing them
 * would turn this route into an oracle: a stranger could learn which user ids
 * are real accounts by reading which message came back. The UI says no more
 * than the database is willing to confirm.
 */
export default function FriendProfileView({ userId }: { userId: string }) {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthUser();

  const profile = useFriendProfile(userId);
  const purchases = useFriendPurchases(userId);

  // Guests have no friends to view. `replace` so Back does not bounce, the same
  // rule ProfileView and FriendsView follow.
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  if (authLoading || !user) return <FriendProfileSkeleton />;

  return (
    <div className="relative min-h-screen bg-krov-void">
      <div
        aria-hidden
        className="krov-aura-wine pointer-events-none absolute -top-32 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 opacity-60"
      />

      <div className="relative mx-auto max-w-4xl px-5 pt-28 pb-24 sm:px-8 md:pt-36">
        <BackToFriends />

        {profile.isLoading ? (
          <FriendProfileHeaderSkeleton />
        ) : profile.isUnavailable ? (
          <UnavailableProfile />
        ) : profile.isError ? (
          <SocialStatePanel title="No pudimos cargar este perfil">
            <p>Vuelve a intentarlo en unos segundos.</p>
          </SocialStatePanel>
        ) : profile.profile ? (
          <>
            <ProfileHeader
              username={profile.profile.username}
              fullName={profile.profile.fullName}
              avatarUrl={profile.profile.avatarUrl}
              experiencePoints={profile.profile.experiencePoints}
            />

            {/*
              The fragrance section renders independently of the header above:
              it is a second query, so a slow product join never holds the
              identity card hostage, and a failed one degrades this block alone.
            */}
            <section className="mt-14 sm:mt-16">
              <header className="mb-7 flex items-baseline justify-between gap-4 border-b border-krov-smoke/70 pb-4">
                <h2 className="krov-eyebrow">Fragancias compradas</h2>
                {!purchases.isLoading && !purchases.isError && (
                  <span className="shrink-0 text-xs tabular-nums text-krov-dust">
                    {purchases.fragrances.length}
                  </span>
                )}
              </header>

              {purchases.isLoading ? (
                <PurchasedFragrancesSkeleton />
              ) : purchases.isError ? (
                <PurchasedFragrancesErrorState onRetry={purchases.refetch} />
              ) : purchases.fragrances.length === 0 ? (
                <PurchasedFragrancesEmptyState
                  name={socialDisplayName(
                    profile.profile.username,
                    profile.profile.fullName
                  )}
                />
              ) : (
                <PurchasedFragrances
                  fragrances={purchases.fragrances}
                  ownerName={socialDisplayName(
                    profile.profile.username,
                    profile.profile.fullName
                  )}
                />
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function BackToFriends() {
  return (
    <Link
      href="/friends"
      className="group inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-krov-ash transition-colors duration-300 hover:text-krov-bone"
    >
      <ArrowLeft
        size={14}
        aria-hidden
        className="transition-transform duration-300 group-hover:-translate-x-0.5"
      />
      Volver a amigos
    </Link>
  );
}

function ProfileHeader({
  username,
  fullName,
  avatarUrl,
  experiencePoints,
}: {
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  experiencePoints: number;
}) {
  // One ladder, shared with /ranking and /profile. Nothing about rank is stored
  // or recomputed here.
  const rank = getRankFromXP(experiencePoints);

  // A friend who has cleared their username still has a profile to show.
  const heading = socialDisplayName(username, fullName);

  return (
    <header className="mt-10 flex flex-col items-center gap-5 text-center sm:mt-12 sm:flex-row sm:gap-7 sm:text-left">
      <SocialAvatar
        username={username}
        fullName={fullName}
        avatarUrl={avatarUrl}
        size={96}
      />

      <div className="min-w-0">
        <h1 className="krov-display truncate text-3xl text-krov-bone sm:text-4xl">
          {heading}
        </h1>

        {/* Only a SECOND line: suppressed when the full name is already doing
            duty as the heading because there is no username. */}
        {fullName && fullName !== heading && (
          <p className="mt-1.5 truncate text-sm text-krov-ash">{fullName}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5 sm:justify-start">
          <span className="border border-krov-blood/50 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] text-krov-rose">
            {rank}
          </span>
          <span className="text-xs tabular-nums text-krov-dust">
            {formatXp(experiencePoints)} XP
          </span>
        </div>
      </div>
    </header>
  );
}

/**
 * One panel for every denial.
 *
 * Says nothing about whether the account exists, whether it is private, or
 * whether the friendship was removed — all three arrive here identically.
 */
function UnavailableProfile() {
  return (
    <div className="mt-16">
      <SocialStatePanel title="Este perfil no está disponible">
        <p>
          Puede que ya no sean amigos, o que la cuenta ya no exista. Solo puedes
          ver el perfil de las personas con las que tienes una amistad activa.
        </p>
        <Link
          href="/friends"
          className="mt-4 inline-block border border-krov-blood/50 px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
        >
          Ver mis amigos
        </Link>
      </SocialStatePanel>
    </div>
  );
}

function FriendProfileHeaderSkeleton() {
  return (
    <div className="mt-10 animate-pulse sm:mt-12" aria-hidden>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-7">
        <div className="h-24 w-24 shrink-0 rounded-full bg-white/5" />
        <div className="w-full max-w-xs">
          <div className="h-8 w-48 max-w-full rounded bg-white/5" />
          <div className="mt-3 h-3.5 w-32 rounded bg-white/5" />
          <div className="mt-5 h-6 w-40 rounded bg-white/5" />
        </div>
      </div>
      <div className="mt-14 h-3 w-40 rounded bg-white/5" />
      <div className="mt-7">
        <PurchasedFragrancesSkeleton />
      </div>
    </div>
  );
}

/** Shown while auth resolves, so a signed-in visitor never sees a guest flash. */
function FriendProfileSkeleton() {
  return (
    <div className="relative min-h-screen bg-krov-void">
      <div className="mx-auto max-w-4xl px-5 pt-28 pb-24 sm:px-8 md:pt-36">
        <FriendProfileHeaderSkeleton />
      </div>
    </div>
  );
}
