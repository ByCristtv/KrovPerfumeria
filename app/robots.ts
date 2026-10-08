import type { MetadataRoute } from "next";
import { DISALLOWED_PATHS } from "@/lib/seo/privatePaths";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * Served at /robots.txt.
 *
 * Disallow lists the private areas that have nothing to index and are not
 * linked from the public pages. The paths that ARE linked from every page
 * (/login, /register, /cart) are deliberately left crawlable: a crawler blocked
 * by robots.txt never sees their `noindex`, so a blocked-but-linked URL can
 * still surface as a bare listing. They are kept out of the index by the
 * `noindex` meta tag and `X-Robots-Tag` header instead — see
 * lib/seo/privatePaths.ts for the full reasoning.
 *
 * This is a crawl hint, not access control: /admin is protected by proxy
 * redirects, RLS, and `is_admin()` guards in the RPCs.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [...DISALLOWED_PATHS],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
