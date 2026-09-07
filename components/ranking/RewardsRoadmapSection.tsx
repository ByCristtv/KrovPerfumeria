"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAuthUser } from "@/hooks/useAuthUser";
import { getViewerXp } from "@/features/ranking/getViewerXp";
import RewardsRoadmap, { RewardsRoadmapSkeleton } from "./RewardsRoadmap";

/**
 * Loads the viewer's XP and hands it to the roadmap.
 *
 * Exists so the roadmap itself can stay a pure function of a number. It is also
 * what keeps /ranking cacheable: the page is a Server Component with
 * `revalidate = 60`, and reading the signed-in user server-side would make the
 * whole route dynamic — every visitor paying for a fresh render of a leaderboard
 * that is identical for all of them. Fetching the one personalised value in the
 * browser keeps the static shell and personalises only this section.
 *
 * Three states, all rendered rather than hidden:
 *   - resolving  → the skeleton, sized to the rail so nothing jumps
 *   - signed out → the full ladder with no tier highlighted, plus a sign-in CTA
 *   - signed in  → the ladder with their rank and progress marked
 */
export default function RewardsRoadmapSection() {
  const { user, isLoading: authLoading } = useAuthUser();

  const xpQuery = useQuery({
    queryKey: ["ranking", "viewer-xp", user?.id],
    queryFn: () => getViewerXp(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  // Only the FIRST resolve is a loading state. A background refetch keeps
  // showing the ladder we already have — swapping a rendered roadmap for a
  // skeleton because a stale query revalidated would be a worse experience than
  // a number being a few seconds old.
  const resolving = authLoading || (!!user && xpQuery.isPending);

  if (resolving) {
    return (
      <div aria-busy="true">
        <RewardsRoadmapSkeleton />
      </div>
    );
  }

  return (
    <>
      <RewardsRoadmap experiencePoints={user ? xpQuery.data ?? 0 : null} />

      {!user && (
        <p className="mt-6 text-center text-xs leading-relaxed text-krov-dust">
          <Link href="/login" className="krov-underline text-krov-rose">
            Inicia sesión
          </Link>{" "}
          para ver tu rango y cuánto te falta para el siguiente premio.
        </p>
      )}
    </>
  );
}
