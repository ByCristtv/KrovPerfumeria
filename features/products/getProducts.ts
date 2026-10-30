import { supabase } from "@/lib/supabase/client";
import {
  GENDER_CATEGORY_SLUGS,
  expandCategoryFilter,
  type GenderCategoryIds,
  type GenderCategorySlug,
} from "@/lib/catalogCategoryFilter";
import type { ProductCardData } from "@/types/product";
import {
  PRODUCTS_PAGE_SIZE,
  type CatalogPageResult,
  type ProductFilters,
  type ProductPage,
} from "@/types/productFilter";

/**
 * Upper bound on how many search hits we resolve before paginating
 * over them. Search is an inherently narrow result set, so a single
 * generous cap lets the user page through matches without changing
 * the `search_products` RPC contract.
 */
const SEARCH_CANDIDATE_CAP = 200;

type CatalogQuery = ReturnType<typeof buildBaseQuery>;

/**
 * The catalog is PRODUCT-centric: one card per parent perfume, represented by
 * its featured (primary) variant and the parent's first image. Variant choice
 * happens on the detail page, not the catalog.
 *
 * Each card also carries ALL of the product's active variants (`variants`): the
 * card has to know whether the bottle can be had some other way - ordered from
 * the supplier, or poured as a decant - before it can say "Agotado". Sorting,
 * the wholesale filter and pagination still work on the featured variant alone.
 *
 * `categories!inner` is only used when filtering by category, so PostgREST
 * prunes products that don't match; otherwise we left-join so uncategorised
 * products still appear.
 */
function buildSelect(filterByCategory: boolean, filterByWholesale: boolean): string {
  const categoriesClause = filterByCategory
    ? `categories!inner ( id, name )`
    : `categories ( id, name )`;

  // When filtering to wholesale-eligible products we inner-join the featured
  // variant so the wholesale predicates in applyFilters actually prune parent
  // rows (and the exact count stays correct). We deliberately DON'T select the
  // wholesale price columns here — they're fetched client-side only for approved
  // buyers (see CatalogWholesaleProvider), so retail visitors never receive them.
  const featuredJoin = filterByWholesale
    ? `product_variants!fk_featured_variant!inner`
    : `product_variants!fk_featured_variant`;

  return `
    id,
    name,
    slug,
    gender,
    concentration,
    decant_stock_ml,
    brands ( name ),
    ${categoriesClause},
    featured_variant:${featuredJoin} (
      id,
      price,
      offer_price,
      is_on_offer,
      stock,
      size_ml,
      product_type,
      sku,
      supplier_available
    ),
    variants:product_variants!product_variants_product_id_fkey (
      id,
      price,
      offer_price,
      is_on_offer,
      stock,
      size_ml,
      product_type,
      sku,
      supplier_available
    ),
    product_images ( url, position )
  `;
}

/**
 * Active-products base query with an exact count for precise pagination.
 *
 * `variants.is_active` prunes only the EMBEDDED rows (no `!inner`), so a product
 * still lists whatever its active variants are. RLS already hides inactive
 * variants from visitors; the explicit filter keeps an admin browsing the
 * storefront from seeing deactivated sizes counted as "available".
 */
function buildBaseQuery(filterByCategory: boolean, filterByWholesale: boolean) {
  return supabase
    .from("products")
    .select(buildSelect(filterByCategory, filterByWholesale), { count: "exact" })
    .eq("is_active", true)
    .eq("variants.is_active", true);
}

/**
 * Resolve product IDs matching a free-text query via the trigram/ILIKE
 * `search_products` RPC. Returns `null` when there is no query.
 */
async function resolveSearchIds(query?: string): Promise<string[] | null> {
  if (!query) return null;

  const { data } = await supabase.rpc("search_products", {
    p_query: query,
    p_limit: SEARCH_CANDIDATE_CAP,
  });

  return ((data ?? []) as { id: string }[]).map((hit) => hit.id);
}

/**
 * Resolve IDs of products that have at least one active variant of the given
 * `product_type`. Lets the (product-centric) catalog keep the type filter —
 * "show perfumes available as decants/sets". Returns `null` when not filtering.
 */
async function resolveTypeIds(
  productType?: ProductFilters["productType"]
): Promise<string[] | null> {
  if (!productType) return null;

  const { data } = await supabase
    .from("product_variants")
    .select("product_id")
    .eq("product_type", productType)
    .eq("is_active", true);

  return [...new Set(((data ?? []) as { product_id: string }[]).map((r) => r.product_id))];
}

/**
 * Resolve IDs of products that have at least one active variant currently on
 * offer. Mirrors `resolveTypeIds`: a narrow `product_id`-only projection keeps
 * the round-trip cheap (no variant rows hydrated into memory) and lets the
 * product-centric catalog intersect by id. Returns `null` when not filtering.
 *
 * `is_on_offer` is the authoritative flag (an `offer_price` may linger while the
 * offer is toggled off), so we filter on it directly.
 */
async function resolveOfferIds(onOffer?: boolean): Promise<string[] | null> {
  if (!onOffer) return null;

  const { data } = await supabase
    .from("product_variants")
    .select("product_id")
    .eq("is_on_offer", true)
    .eq("is_active", true);

  return [...new Set(((data ?? []) as { product_id: string }[]).map((r) => r.product_id))];
}

/**
 * Resolve the selected category id into the id-list the query filters on,
 * applying the gender rule (Hombre/Mujer also include Unisex; see
 * `expandCategoryFilter`). Returns `null` when no category filter is active.
 * The dropdown carries an id, so we look up the gender categories' ids by their
 * stable slugs and hand both to the pure expansion helper.
 */
async function resolveCategoryIds(categoryId?: string): Promise<string[] | null> {
  if (!categoryId) return null;

  const { data } = await supabase
    .from("categories")
    .select("id, slug")
    .in("slug", [...GENDER_CATEGORY_SLUGS]);

  const genderIds: GenderCategoryIds = {};
  for (const row of (data ?? []) as { id: string; slug: string }[]) {
    genderIds[row.slug as GenderCategorySlug] = row.id;
  }

  return expandCategoryFilter(categoryId, genderIds);
}

/** Apply the active filters. All id-list filters AND together (intersection). */
function applyFilters(
  query: CatalogQuery,
  filters: ProductFilters | undefined,
  searchIds: string[] | null,
  typeIds: string[] | null,
  offerIds: string[] | null,
  categoryIds: string[] | null
): CatalogQuery {
  let next = query;

  if (searchIds) next = next.in("id", searchIds);
  if (typeIds) next = next.in("id", typeIds);
  if (offerIds) next = next.in("id", offerIds);

  if (categoryIds && categoryIds.length > 0) {
    // categories!inner makes this prune parent rows, not just the embedded array.
    // The id-list is the gender rule expanded to include Unisex where applicable
    // (see resolveCategoryIds), so this is (selectedCategory OR Unisex) — an OR
    // within the list — ANDed with every other filter above.
    next = next.in("categories.id", categoryIds);
  }

  if (filters?.wholesaleOnly) {
    // The featured variant is inner-joined (see buildSelect), so these predicates
    // prune to products whose CARD can actually show a wholesale price. Mirrors
    // isWholesaleConfigured() in lib/pricing/wholesale.ts.
    next = next
      .eq("featured_variant.is_wholesale_enabled", true)
      .gt("featured_variant.wholesale_price", 0)
      .gt("featured_variant.min_wholesale_quantity", 0);
  }

  return next;
}

/** Apply ordering. Falls back to newest-first when unspecified. */
function applyOrder(query: CatalogQuery, orderBy: ProductFilters["orderBy"]): CatalogQuery {
  switch (orderBy) {
    case "price_asc":
      // Order parent rows by the to-one featured variant's price.
      return query.order("featured_variant(price)", { ascending: true });
    case "price_desc":
      return query.order("featured_variant(price)", { ascending: false });
    case "name_asc":
      return query.order("name", { ascending: true });
    case "name_desc":
      return query.order("name", { ascending: false });
    default:
      return query.order("created_at", { ascending: false });
  }
}

/**
 * Shared core for both the offset (`getProductsPage`) and numbered
 * (`getCatalogPage`) entry points. Resolves the search/type id-lists,
 * builds + orders the query, and returns the requested `[from, to]`
 * window plus the exact total. Never throws: any failure degrades to
 * an empty window with `total: 0`.
 */
async function runCatalogQuery(
  from: number,
  to: number,
  filters?: ProductFilters
): Promise<{ items: ProductCardData[]; total: number }> {
  const [searchIds, typeIds, offerIds, categoryIds] = await Promise.all([
    resolveSearchIds(filters?.query),
    resolveTypeIds(filters?.productType),
    resolveOfferIds(filters?.onOffer),
    resolveCategoryIds(filters?.category),
  ]);

  // A non-null but empty id-list means "filtered, matched nothing".
  if (
    (searchIds !== null && searchIds.length === 0) ||
    (typeIds !== null && typeIds.length === 0) ||
    (offerIds !== null && offerIds.length === 0)
  ) {
    return { items: [], total: 0 };
  }

  let query = buildBaseQuery(!!filters?.category, !!filters?.wholesaleOnly);
  query = applyFilters(query, filters, searchIds, typeIds, offerIds, categoryIds);
  query = applyOrder(query, filters?.orderBy);

  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error("runCatalogQuery failed:", error.message);
    return { items: [], total: 0 };
  }

  return { items: (data as unknown as ProductCardData[]) ?? [], total: count ?? 0 };
}

/**
 * Fetch a single page of catalog products (offset-based pagination).
 *
 * One card per parent product. Edge cases: an empty search/type resolves to
 * zero results without a round-trip; a page past the end returns `[]` with
 * `nextPage: null`; any PostgREST error degrades to an empty terminal page.
 */
export async function getProductsPage(
  page: number,
  pageSize: number = PRODUCTS_PAGE_SIZE,
  filters?: ProductFilters
): Promise<ProductPage> {
  const from = page * pageSize;
  const to = from + pageSize - 1;

  const { items, total } = await runCatalogQuery(from, to, filters);
  const hasNextPage = from + items.length < total;

  return {
    items,
    nextPage: hasNextPage ? page + 1 : null,
    total,
  };
}

/**
 * Fetch one page of the catalog with full pagination metadata, for the
 * server-rendered `/products` route. Uses 1-based page numbers and
 * Supabase `range()` so only the 20 rows for the current page are fetched —
 * scalable to thousands of products without over-fetching.
 *
 * Out-of-range pages (e.g. `?page=999`) clamp to a valid window so the UI
 * always reflects a coherent `currentPage` / `totalPages`.
 */
export async function getCatalogPage(
  page: number,
  filters?: ProductFilters,
  pageSize: number = PRODUCTS_PAGE_SIZE
): Promise<CatalogPageResult> {
  // First fetch the requested page to learn the exact total.
  const requested = Math.max(1, Math.floor(page) || 1);
  const from = (requested - 1) * pageSize;
  const to = from + pageSize - 1;

  const { items: firstItems, total } = await runCatalogQuery(from, to, filters);
  let items = firstItems;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // If the caller asked for a page beyond the end (stale link, manual URL),
  // re-fetch the last valid page so the grid is never blank mid-catalog.
  let currentPage = requested;
  if (total > 0 && requested > totalPages) {
    currentPage = totalPages;
    const lastFrom = (currentPage - 1) * pageSize;
    ({ items } = await runCatalogQuery(lastFrom, lastFrom + pageSize - 1, filters));
  }

  return {
    products: items,
    totalProducts: total,
    currentPage,
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPreviousPage: currentPage > 1,
    pageSize,
  };
}
