import type { Metadata } from "next";
import FriendProfileView from "@/components/social/FriendProfileView";

export const metadata: Metadata = {
  title: "Perfil de amigo",
  description: "El perfil social de una persona de tu círculo en KROV.",
  // Protected, signed-in-only, and different for every viewer — the same rule
  // /profile and /friends follow. Nothing here is for a crawler.
  robots: { index: false, follow: false },
};

interface FriendProfilePageProps {
  // Next.js 16: params is async and MUST be awaited.
  params: Promise<{ userId: string }>;
}

/**
 * /friends/[userId] — a friend's social profile.
 *
 * ROUTE KEY: the user id, not the username.
 *
 * A username-based URL would read better, but usernames in this app are
 * MUTABLE — /profile lets anyone change theirs at any time, and there is no
 * alias or history table (nor should this MVP build one). Keying on a value
 * that can change out from under a link means saved links rot and a freed
 * username can later point somewhere else entirely.
 *
 * The user id avoids all of it: it is stable, it is exactly what
 * `get_friend_profile(p_friend_user_id uuid)` takes, so there is no
 * username-to-id resolution step and no extra query, and `/orders/[id]` already
 * establishes UUID-keyed authenticated routes here. The id is not a secret —
 * it opens nothing on its own, because the RPCs re-check the friendship on
 * every call.
 *
 * This page is a thin shell on purpose. Every read is per-viewer and
 * permissioned, so there is nothing a server render could cache or share; the
 * client component owns the queries, as on /friends and /profile.
 */
export default async function FriendProfilePage({
  params,
}: FriendProfilePageProps) {
  const { userId } = await params;

  return <FriendProfileView userId={userId} />;
}
