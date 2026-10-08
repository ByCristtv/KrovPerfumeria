import type { NextConfig } from "next";
// Relative import on purpose: the config file can't resolve the `@/` alias.
import { NOINDEX_PATHS } from "./lib/seo/privatePaths";

/**
 * Hostname of the Supabase project the app is currently pointed at. The
 * production and TESTING projects have different hosts, and uploaded avatars
 * are served from whichever one `.env.local` selects. Kept in lockstep with
 * lib/avatar/renderable.ts.
 */
function supabaseHostname(): string | null {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
}

const activeSupabaseHost = supabaseHostname();

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "https://pavement-exuberant-harness.ngrok-free.dev",
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'xabzbvanmqeplenfoozx.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      ...(activeSupabaseHost && activeSupabaseHost !== 'xabzbvanmqeplenfoozx.supabase.co'
        ? [
            {
              protocol: 'https' as const,
              hostname: activeSupabaseHost,
              pathname: '/storage/v1/object/public/**',
            },
          ]
        : []),
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
      
    ],
  },

  /**
   * Safety net against accidental indexing: every private prefix answers with
   * `X-Robots-Tag: noindex, nofollow`, whatever its page metadata says. It
   * covers route handlers and any page nobody remembered to annotate, and — unlike
   * robots.txt — it is an indexing directive, not a crawl hint. Per-page
   * `robots` metadata stays as the visible, second signal.
   */
  async headers() {
    return NOINDEX_PATHS.map((prefix) => ({
      source: `${prefix}/:path*`,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }));
  },

  /**
   * /about and /contact were folded into the home page. They were indexed and
   * linked from outside (and from printed material), so they redirect to the
   * anchors that replaced them rather than 404ing. Permanent (308) so search
   * engines transfer the ranking instead of keeping both around.
   */
  async redirects() {
    return [
      { source: "/about", destination: "/#historia", permanent: true },
      { source: "/contact", destination: "/#canales", permanent: true },
    ];
  },
};

export default nextConfig;
