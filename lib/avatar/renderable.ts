/**
 * Hostnames `next/image` is configured to optimize — kept in lockstep with
 * `images.remotePatterns` in next.config.ts.
 *
 * `avatar_url` is an image source that can come from ANOTHER user's row rather
 * than from our own catalog, and `next/image` throws on a hostname outside
 * `remotePatterns`. So every avatar is checked here first, and one from a
 * provider we have not configured degrades to a monogram/silhouette instead of
 * a broken image.
 *
 * Producers today: Google OAuth (`lh3.googleusercontent.com`) and our own
 * Supabase Storage project. The storage host is read from the same env var the
 * Supabase client uses, so it follows whichever project the app is pointed at
 * (the production and TESTING projects have different hostnames); the
 * production host stays listed so rows written there still render.
 */
function supabaseHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

const OPTIMIZABLE_AVATAR_HOSTS: readonly string[] = [
  "lh3.googleusercontent.com",
  "xabzbvanmqeplenfoozx.supabase.co",
  ...(supabaseHost() ? [supabaseHost() as string] : []),
];

export function isRenderableAvatar(url: string | null | undefined): url is string {
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
