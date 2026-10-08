import { cache } from "react";
import { getCategoryIdBySlug } from "@/features/categories/getCategoryIdBySlug";
import { getCatalogPage } from "@/features/products/getProducts";
import { DEFAULT_ORDER } from "@/lib/catalogParams";
import { LANDINGS, type LandingSlug } from "@/lib/seo/landings";
import type { CatalogPageResult, ProductFilters } from "@/types/productFilter";

const EMPTY: CatalogPageResult = {
  products: [],
  totalProducts: 0,
  currentPage: 1,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
  pageSize: 0,
};

/**
 * One page of a curated landing's listing — the regular catalog query with the
 * landing's fixed filter applied. A landing whose category doesn't exist yields
 * an empty result, which the page treats as "not indexable".
 *
 * Wrapped in React `cache` (primitive args, so keys match) so `generateMetadata`
 * and the page body share a single round-trip per request.
 */
export const getLandingCatalog = cache(
  async (slug: LandingSlug, page: number): Promise<CatalogPageResult> => {
    const { filter } = LANDINGS[slug];
    // Same default ordering as the main catalog, so the two listings agree.
    const filters: ProductFilters = { orderBy: DEFAULT_ORDER };

    if (filter.categorySlug) {
      const categoryId = await getCategoryIdBySlug(filter.categorySlug);
      if (!categoryId) return EMPTY;
      filters.category = categoryId;
    } else {
      filters.productType = filter.productType;
    }

    return getCatalogPage(page, filters);
  }
);
