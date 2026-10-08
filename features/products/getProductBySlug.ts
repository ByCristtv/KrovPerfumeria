import { cache } from "react";
import { supabase } from "@/lib/supabase/client";
import type { ProductDetailData } from "@/types/product";

/**
 * Fetch a single product by slug for the public detail page.
 * Returns null when missing/inactive — callers should `notFound()`.
 *
 * Wrapped in React `cache`: the route calls this from both `generateMetadata`
 * and the page body, and without it each request hit the database twice for the
 * identical row. Within one server render the second call is a memo hit.
 */
export const getProductBySlug = cache(async function getProductBySlug(
  slug: string
): Promise<ProductDetailData | null> {
  const { data, error } = await supabase
    .from("products")
    .select(
      `
      id,
      name,
      slug,
      description,
      gender,
      concentration,
      notes_top,
      notes_middle,
      notes_base,
      featured_variant_id,
      decant_stock_ml,
      brands ( name ),
      categories ( id, name ),
      product_variants!product_variants_product_id_fkey (
        id,
        price,
        offer_price,
        is_on_offer,
        stock,
        size_ml,
        product_type,
        position
      ),
      product_images ( url, position, alt_text, variant_id )
    `
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .eq("product_variants.is_active", true)
    .maybeSingle();

  if (error) {
    console.error("getProductBySlug failed:", error.message);
    return null;
  }

  return data as unknown as ProductDetailData | null;
});
