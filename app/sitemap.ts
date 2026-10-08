import type { MetadataRoute } from "next";
import { getLandingCatalog } from "@/features/products/getLandingCatalog";
import { getSitemapProducts } from "@/features/products/getSitemapProducts";
import { LANDING_LIST } from "@/lib/seo/landings";
import { buildSitemapEntries } from "@/lib/seo/sitemap";

/**
 * Served at /sitemap.xml.
 *
 * Regenerated hourly rather than pinned at build time so newly published
 * products appear without a redeploy. The inclusion rules live in
 * lib/seo/sitemap.ts; this file only gathers the data.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // A landing is submitted only while it lists at least one product — the same
  // condition under which its own page is indexable (see landingMetadata).
  const [products, landingTotals] = await Promise.all([
    getSitemapProducts(),
    Promise.all(
      LANDING_LIST.map(async (landing) => ({
        path: landing.path,
        total: (await getLandingCatalog(landing.slug, 1)).totalProducts,
      }))
    ),
  ]);

  // A partial sitemap beats a 500: if the product query failed, the static and
  // landing routes are still submitted and products stay discoverable through
  // the internal links on /products.
  return buildSitemapEntries({
    products: products ?? [],
    landingPaths: landingTotals
      .filter((landing) => landing.total > 0)
      .map((landing) => landing.path),
  });
}
