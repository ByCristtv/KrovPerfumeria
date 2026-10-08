import type { Metadata } from "next";
import { SITE } from "./site";

/**
 * One builder for page-level metadata.
 *
 * Next merges metadata SHALLOWLY: a page that sets `title` but not `alternates`
 * or `openGraph` inherits the parent's whole object. When the root layout pinned
 * `canonical: "/"` and `og:url: "/"`, every such page — /legal/*, /products,
 * /ranking — told search engines and social scrapers it was the home page. The
 * root layout no longer sets either; every indexable page goes through here so
 * canonical, og:url, og:title and the Twitter card are always set together and
 * always agree.
 */

/** `noindex, follow` — keep the page out of the index but let link equity flow. */
export const NOINDEX_FOLLOW: NonNullable<Metadata["robots"]> = {
  index: false,
  follow: true,
};

/** `noindex, nofollow` — private pages with nothing worth following. */
export const NOINDEX_NOFOLLOW: NonNullable<Metadata["robots"]> = {
  index: false,
  follow: false,
};

export interface PageMetadataInput {
  /**
   * Page title WITHOUT the brand — the root layout's template appends
   * " · KROV Perfumería". Pass `absoluteTitle` when it is already complete.
   */
  title: string;
  description: string;
  /** Site-relative canonical path, e.g. "/products" or "/products?page=2". */
  path: string;
  /** Skip the root title template (the title already carries the brand). */
  absoluteTitle?: boolean;
  /**
   * Social images. Leave unset to keep the site-wide /opengraph-image card —
   * which Next attaches to any route that doesn't supply its own.
   */
  images?: Array<{ url: string; alt?: string }>;
  /**
   * A robots directive. When it is a noindex, the canonical and og:url are left
   * out: a noindexed page that also names a canonical sends mixed signals.
   */
  robots?: Metadata["robots"];
}

function isNoindex(robots: Metadata["robots"]): boolean {
  if (!robots) return false;
  if (typeof robots === "string") return /noindex/i.test(robots);
  return robots.index === false;
}

/** The title as it appears in a social card (the template doesn't reach OG). */
function socialTitle(input: PageMetadataInput): string {
  return input.absoluteTitle ? input.title : `${input.title} · ${SITE.name}`;
}

export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const { title, description, path, absoluteTitle, images, robots } = input;
  const noindex = isNoindex(robots);
  const cardTitle = socialTitle(input);

  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(robots && { robots }),
    ...(!noindex && { alternates: { canonical: path } }),
    openGraph: {
      type: "website",
      siteName: SITE.name,
      locale: SITE.locale,
      title: cardTitle,
      description,
      ...(!noindex && { url: path }),
      ...(images && images.length > 0 && { images }),
    },
    twitter: {
      card: "summary_large_image",
      title: cardTitle,
      description,
      ...(images && images.length > 0 && {
        images: images.map((image) => image.url),
      }),
    },
  };
}

/**
 * Trim to a SERP-friendly length on a word boundary. Descriptions over ~160
 * characters are cut mid-sentence by Google.
 */
export function truncateDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}
