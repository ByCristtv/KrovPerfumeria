import { supabase } from "@/lib/supabase/client";
import type { ProductCardData } from "@/types/product";

/**
 * Fetch products that share at least one category with the given product,
 * excluding the product itself. Used for the "También te puede gustar"
 * section on the detail page.
 *
 * ACTIVE VARIANTS ONLY — this is load-bearing, not a nicety.
 *
 * `products.is_active` alone is not enough: a product can be active while its
 * variants have all been deactivated in `/admin/products`. The detail page
 * (`app/products/[slug]`) fetches only ACTIVE variants and calls `notFound()`
 * when none come back, so recommending such a product hands the visitor a card
 * that 404s. It also priced that card from an inactive variant.
 *
 * The fix is `!inner` PLUS the explicit `is_active` filter, and both halves earn
 * their place:
 *
 *   · `!inner` is what actually removes the parent row. For an anonymous
 *     visitor the RLS policy "Anyone can view active variants" already hides an
 *     inactive variant — but hiding it only EMPTIED the embedded object, and
 *     PostgREST still returned the product. That is the bug as users hit it: a
 *     card with no price that 404s on click. (`RelatedCard` has no null-variant
 *     guard; `ProductCard` does, which is why the catalog never showed this.)
 *   · `.eq("featured_variant.is_active", true)` states the rule explicitly, so
 *     the query is still correct in any context where RLS does not apply
 *     (an admin session, a service-role client, a future server-side move).
 *
 * The featured variant is the one the card renders AND a variant of the
 * product, so requiring it to be active both prices the card correctly and
 * guarantees the detail page has at least one variant to show.
 */
export async function getRelatedProducts(
  productId: string,
  categoryIds: string[],
  limit = 4
): Promise<ProductCardData[]> {
  if (categoryIds.length === 0) return [];

  const { data, error } = await supabase
    .from("products")
    .select(
      `
      id,
      name,
      slug,
      gender,
      concentration,
      decant_stock_ml,
      brands ( name ),
      categories!inner ( id, name ),
      featured_variant:product_variants!fk_featured_variant!inner (
        id,
        price,
        offer_price,
        is_on_offer,
        stock,
        size_ml,
        product_type
      ),
      product_images ( url, position )
    `
    )
    .eq("is_active", true)
    .eq("featured_variant.is_active", true)
    .neq("id", productId)
    .in("categories.id", categoryIds)
    .limit(limit);

  if (error) {
    console.error("getRelatedProducts failed:", error.message);
    return [];
  }

  // Deduplicate (multi-category join may produce dupes) and clamp.
  const seen = new Set<string>();
  const unique: ProductCardData[] = [];
  for (const row of (data as unknown as ProductCardData[]) ?? []) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    unique.push(row);
    if (unique.length >= limit) break;
  }
  return unique;
}
