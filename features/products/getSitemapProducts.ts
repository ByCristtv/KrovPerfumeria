import { supabase } from "@/lib/supabase/client";
import type { SitemapProduct } from "@/lib/seo/sitemap";

interface SitemapProductRow {
  slug: string;
  updated_at: string | null;
  product_images: { url: string; position: number }[] | null;
}

/**
 * Products that can actually be served: active AND with at least one active
 * variant. The detail page 404s a product with no active variant, so listing
 * one in the sitemap submits a dead URL.
 *
 * `product_variants!…!inner` makes PostgREST drop parent rows with no matching
 * variant (a plain embedded filter would only prune the embedded array and keep
 * the parent). Returns `null` on a query error so the caller can degrade to the
 * static routes instead of failing the whole sitemap.
 */
export async function getSitemapProducts(): Promise<SitemapProduct[] | null> {
  const { data, error } = await supabase
    .from("products")
    .select(
      `
      slug,
      updated_at,
      product_variants!product_variants_product_id_fkey!inner ( id ),
      product_images ( url, position )
    `
    )
    .eq("is_active", true)
    .eq("product_variants.is_active", true)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[sitemap] product fetch failed", error.message);
    return null;
  }

  return ((data ?? []) as unknown as SitemapProductRow[]).map((row) => ({
    slug: row.slug,
    updatedAt: row.updated_at,
    imageUrl:
      [...(row.product_images ?? [])].sort((a, b) => a.position - b.position)[0]
        ?.url ?? null,
  }));
}
