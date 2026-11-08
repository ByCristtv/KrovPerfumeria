import { supabase } from "@/lib/supabase/client";
import { relatedGenders } from "@/lib/catalogCategoryFilter";
import type { ProductCardData, ProductGender } from "@/types/product";

/** The product being viewed, as the recommendation query needs it. */
export interface RelatedProductSource {
  id: string;
  /** `products.gender` — the only source of a product's audience. */
  gender: ProductGender | null;
  /**
   * COMMERCIAL category ids only (Árabe, Nicho, Diseñador, …). Callers strip the
   * legacy gender categories with `commercialCategoryIds`, so gender relevance
   * comes from `gender`, never from association rows.
   */
  categoryIds: string[];
}

/**
 * Candidates fetched per query, as a multiple of the requested limit: the
 * gender ranking and the de-duplication both need some slack to choose from.
 */
const CANDIDATE_FACTOR = 3;

/**
 * Fetch products related to the one being viewed, for the "También te puede
 * gustar" section on the detail page. Never includes the product itself.
 *
 * Relevance, best first:
 *   1. Shares a commercial category AND a compatible gender
 *      (masculine ↔ masculine/unisex, feminine ↔ feminine/unisex, unisex ↔ any),
 *      same gender ranked before unisex.
 *   2. If that leaves empty slots: a compatible gender alone. Without this, a
 *      product with no commercial category (common once gender stopped being a
 *      category) would get no recommendations at all.
 *   A product whose gender is unknown matches on categories only, as before.
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
  source: RelatedProductSource,
  limit = 4
): Promise<ProductCardData[]> {
  const genders = relatedGenders(source.gender);
  const picked: ProductCardData[] = [];
  const seen = new Set<string>([source.id]);

  // Deduplicate (the multi-category join may return a product twice) and clamp.
  const take = (rows: ProductCardData[]) => {
    for (const row of rankByGender(rows, source.gender)) {
      if (picked.length >= limit) return;
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      picked.push(row);
    }
  };

  if (source.categoryIds.length > 0) {
    take(
      await fetchCandidates({
        excludeId: source.id,
        categoryIds: source.categoryIds,
        genders,
        limit: limit * CANDIDATE_FACTOR,
      })
    );
  }

  if (picked.length < limit && genders) {
    take(
      await fetchCandidates({
        excludeId: source.id,
        categoryIds: null,
        genders,
        // Over-fetch by what is already picked: those rows may come back again.
        limit: limit * CANDIDATE_FACTOR + picked.length,
      })
    );
  }

  return picked;
}

/**
 * Order candidates by how well their gender matches (`relatedGenders` order).
 * Stable: rows of equal rank keep the order the database returned them in.
 */
export function rankByGender(
  rows: ProductCardData[],
  gender: ProductGender | null
): ProductCardData[] {
  const order = relatedGenders(gender);
  if (!order) return rows;
  const rank = (row: ProductCardData) => {
    const i = order.indexOf(row.gender);
    return i === -1 ? order.length : i;
  };
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index)
    .map(({ row }) => row);
}

async function fetchCandidates(args: {
  excludeId: string;
  /** `null` = don't require a shared category. */
  categoryIds: string[] | null;
  /** `null` = no gender preference. */
  genders: ProductGender[] | null;
  limit: number;
}): Promise<ProductCardData[]> {
  const byCategory = args.categoryIds !== null;

  let query = supabase
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
      ${byCategory ? "categories!inner ( id, name )" : "categories ( id, name )"},
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
    .neq("id", args.excludeId);

  if (args.categoryIds) query = query.in("categories.id", args.categoryIds);
  if (args.genders) query = query.in("gender", args.genders);

  const { data, error } = await query.limit(args.limit);

  if (error) {
    console.error("getRelatedProducts failed:", error.message);
    return [];
  }

  return (data as unknown as ProductCardData[]) ?? [];
}
