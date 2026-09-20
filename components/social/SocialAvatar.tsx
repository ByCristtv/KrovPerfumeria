"use client";

import Image from "next/image";
import { socialInitial } from "@/lib/social/display";

/**
 * Hostnames `next/image` is configured to optimize — kept in lockstep with
 * `images.remotePatterns` in next.config.ts.
 *
 * It has to be checked here because `avatar_url` is the one image source in the
 * app that comes from ANOTHER user's row rather than from our own catalog.
 * next/image refuses a hostname that is not in `remotePatterns`, and the refusal
 * surfaces as a broken/failed image on a page full of strangers — so an avatar
 * from a provider we have not configured degrades to the monogram instead.
 *
 * Today the only producers are Google OAuth (`lh3.googleusercontent.com`) and
 * Supabase Storage; everyone who signed up with an email has no avatar at all.
 */
const OPTIMIZABLE_AVATAR_HOSTS = [
  "lh3.googleusercontent.com",
  "xabzbvanmqeplenfoozx.supabase.co",
] as const;

function isRenderableAvatar(url: string | null): url is string {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      OPTIMIZABLE_AVATAR_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`)
      )
    );
  } catch {
    // Not an absolute URL — including the empty string the signup trigger
    // writes for email/password accounts.
    return false;
  }
}

/**
 * A person's picture, anywhere in the social module.
 *
 * Falls back to a monogram rather than a shared silhouette: a list is scanned,
 * not read, and a column of identical anonymous icons gives the eye nothing to
 * land on. The monogram is decorative — the name sits beside it as real text
 * — so it is hidden from assistive tech.
 *
 * `username` is NULLABLE here, and the prop says so. Only
 * `search_public_users` filters out profiles without one; every other social
 * RPC joins `profiles` unfiltered, so an existing friend or requester can
 * genuinely have none. The generated Supabase types widen the column to
 * `string`, which is exactly how `username.charAt(0)` got here and crashed —
 * so the type is corrected rather than asserted away, and the initial is
 * resolved by `socialInitial` (username → full name → "?").
 */
export default function SocialAvatar({
  username,
  fullName,
  avatarUrl,
  size = 44,
}: {
  username: string | null;
  /** Only passed where the RPC returns it (friends, friend profiles). */
  fullName?: string | null;
  avatarUrl: string | null;
  size?: number;
}) {
  if (isRenderableAvatar(avatarUrl)) {
    return (
      <Image
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-krov-smoke object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full border border-krov-smoke bg-krov-graphite text-krov-rose"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {socialInitial(username, fullName)}
    </span>
  );
}
