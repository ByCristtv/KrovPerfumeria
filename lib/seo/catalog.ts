import {
  CATALOG_PARAM,
  parseCatalogPage,
  type RawSearchParams,
} from "@/lib/catalogParams";
import { NOINDEX_FOLLOW } from "./metadata";

/**
 * Indexing rules for the URL-driven catalog.
 *
 * The catalog is driven entirely by the query string, so one route yields an
 * unbounded set of URLs. The rule that keeps the index clean:
 *
 *   - Plain pages of the series (`/products`, `/products?page=2`) are indexable
 *     and each canonicalises to itself. A "page 2" that canonicalised to page 1
 *     would tell Google the products on it are a duplicate of page 1's.
 *   - Any URL that narrows or re-orders the listing (search, category, type,
 *     offer, wholesale, sort) is `noindex, follow`: it is a view of the same
 *     products, not a page worth ranking, but its links are still followed.
 *   - Tracking junk (`?utm_source=…`, `?fbclid=…`) keeps the page indexable and
 *     canonicalises back to the clean URL.
 */

/** Params that change WHICH products are shown or HOW they are ordered. */
const VIEW_PARAMS = [
  CATALOG_PARAM.query,
  CATALOG_PARAM.category,
  CATALOG_PARAM.type,
  CATALOG_PARAM.offer,
  CATALOG_PARAM.wholesale,
  CATALOG_PARAM.sort,
] as const;

function hasValue(value: string | string[] | undefined): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return Boolean(first?.trim());
}

/** Does the URL carry a filter/search/sort param (as opposed to just a page)? */
export function isFilteredView(searchParams: RawSearchParams): boolean {
  return VIEW_PARAMS.some((param) => hasValue(searchParams[param]));
}

/** Canonical path for one page of the series — page 1 has no query string. */
export function catalogCanonicalPath(basePath: string, page: number): string {
  return page > 1 ? `${basePath}?${CATALOG_PARAM.page}=${page}` : basePath;
}

export interface CatalogSeo {
  page: number;
  /** Canonical path, or undefined for views that must not name one. */
  canonicalPath: string;
  /** Present when the URL must stay out of the index. */
  robots?: typeof NOINDEX_FOLLOW;
}

/**
 * @param basePath   The route this listing lives at ("/products", "/decants").
 * @param honorFilters  Whether filter params change what the page renders.
 *   `/products` honours them (so filtered URLs are noindexed); the curated
 *   landing pages ignore them, so a stray `?sort=` there is just noise.
 */
export function catalogSeo(
  basePath: string,
  searchParams: RawSearchParams,
  honorFilters = true
): CatalogSeo {
  const page = parseCatalogPage(searchParams);
  const filtered = honorFilters && isFilteredView(searchParams);

  return {
    page,
    canonicalPath: catalogCanonicalPath(basePath, page),
    ...(filtered && { robots: NOINDEX_FOLLOW }),
  };
}
