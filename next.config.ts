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
    // 31 days. The effective lifetime is max(this, the upstream max-age), so it
    // covers the older Supabase objects (max-age=3600) that the previous 4-hour
    // default re-transformed, and billed, on the first request after each expiry.
    // Nothing invalidates it: replace a file by giving it a new URL.
    minimumCacheTTL: 2678400,
    // Every width here is one more transformation per image, so only widths a
    // real layout resolves to are listed. See the `sizes` on each image surface.
    imageSizes: [64, 96, 128, 256, 384],
    deviceSizes: [640, 828, 1080, 1200, 1920],
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
  serverExternalPackages: ["sharp"],

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
