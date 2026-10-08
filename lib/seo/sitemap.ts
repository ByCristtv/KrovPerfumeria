import type { MetadataRoute } from "next";
import { productPath } from "./product";
import { absoluteUrl } from "./site";

/**
 * Pure assembly of the sitemap entries, kept apart from `app/sitemap.ts` (which
 * does the data fetching) so the inclusion rules can be tested without a database.
 */

export interface SitemapProduct {
  slug: string;
  /** ISO timestamp of the product row's last change. */
  updatedAt: string | null;
  /** First gallery image — feeds the image sitemap extension. */
  imageUrl?: string | null;
}

/**
 * Indexable, parameter-free pages that exist regardless of the catalog.
 * Private areas (admin, auth, cart, checkout, account, orders) are excluded by
 * construction — nothing here is ever derived from a route listing.
 */
const STATIC_PATHS = [
  "/ranking",
  "/howtobuy",
  "/legal/privacidad",
  "/legal/terminos",
] as const;

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * `lastModified` is only emitted where it is real. Stamping every URL with
 * "now" teaches Google the field is unreliable and it stops trusting it; the
 * catalog-driven pages use the newest product change, and the rest omit it.
 * (`changeFrequency` and `priority` are left out: Google ignores both.)
 */
export function buildSitemapEntries({
  products,
  landingPaths,
}: {
  products: SitemapProduct[];
  /** Landing pages that currently list at least one product. */
  landingPaths: string[];
}): MetadataRoute.Sitemap {
  const newest = products
    .map((product) => toDate(product.updatedAt))
    .filter((date): date is Date => date !== undefined)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const home: MetadataRoute.Sitemap[number] = {
    url: absoluteUrl("/"),
    lastModified: newest,
  };

  // The catalog and its landings change whenever a product does.
  const catalogPaths = ["/products", ...landingPaths];
  const catalogEntries: MetadataRoute.Sitemap = catalogPaths.map((path) => ({
    url: absoluteUrl(path),
    lastModified: newest,
  }));

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: absoluteUrl(path),
  }));

  const productEntries: MetadataRoute.Sitemap = products.map((product) => ({
    url: absoluteUrl(productPath(product.slug)),
    lastModified: toDate(product.updatedAt),
    ...(product.imageUrl && { images: [product.imageUrl] }),
  }));

  return [home, ...catalogEntries, ...staticEntries, ...productEntries];
}
