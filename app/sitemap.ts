import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase/client";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * Served at /sitemap.xml.
 *
 * Regenerated hourly rather than pinned at build time so newly published
 * products appear without a redeploy.
 */
export const revalidate = 3600;

/** Static, indexable routes. Private areas are excluded by construction. */
const STATIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/products", changeFrequency: "daily", priority: 0.9 },
  { path: "/ranking", changeFrequency: "daily", priority: 0.5 },
  { path: "/howtobuy", changeFrequency: "monthly", priority: 0.5 },
  { path: "/legal/privacidad", changeFrequency: "yearly", priority: 0.2 },
  { path: "/legal/terminos", changeFrequency: "yearly", priority: 0.2 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // Only active products — listing a 404 wastes crawl budget and erodes trust
  // in the sitemap as a whole.
  const { data, error } = await supabase
    .from("products")
    .select("slug, updated_at")
    .eq("is_active", true)
    .order("updated_at", { ascending: false });

  if (error) {
    // A partial sitemap beats a 500. The static routes still get submitted and
    // products remain discoverable via internal links from /products.
    console.error("[sitemap] product fetch failed", error);
    return staticEntries;
  }

  const productEntries: MetadataRoute.Sitemap = (data ?? []).map((product) => ({
    url: absoluteUrl(`/products/${product.slug}`),
    lastModified: new Date(product.updated_at),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticEntries, ...productEntries];
}
