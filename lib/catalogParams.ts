import type { ProductFilters, ProductOrderBy } from "@/types/productFilter";
import type { ProductTypes } from "@/types/product";

/**
 * URL <-> catalog-state mapping for the `/products` route.
 *
 * The catalog is driven entirely by the query string so it stays
 * server-renderable, SEO-friendly, and shareable. These helpers are the
 * single source of truth for the param names and their parsing rules,
 * shared by the server page (parse) and the client toolbar/pagination
 * (build).
 */

export const CATALOG_PARAM = {
  query: "q",
  category: "category",
  type: "type",
  offer: "offer",
  wholesale: "wholesale",
  sort: "sort",
  page: "page",
} as const;

export type RawSearchParams = Record<string, string | string[] | undefined>;

const ORDER_VALUES: ProductOrderBy[] = [
  "price_asc",
  "price_desc",
  "name_asc",
  "name_desc",
];
const TYPE_VALUES: ProductTypes[] = ["full_size", "decant", "set"];

/**
 * No explicit sort = default catalog order (trending first, then price asc).
 * An explicit `sort=price_asc` stays a pure price ordering.
 */

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** Parse raw Next.js searchParams into typed catalog filters. */
export function parseCatalogFilters(params: RawSearchParams): ProductFilters {
  const query = first(params[CATALOG_PARAM.query]);
  const category = first(params[CATALOG_PARAM.category]);
  const typeRaw = first(params[CATALOG_PARAM.type]) as ProductTypes;
  const offerRaw = first(params[CATALOG_PARAM.offer]);
  const wholesaleRaw = first(params[CATALOG_PARAM.wholesale]);
  const sortRaw = first(params[CATALOG_PARAM.sort]) as ProductOrderBy;

  return {
    query: query || undefined,
    category: category || undefined,
    productType: TYPE_VALUES.includes(typeRaw) ? typeRaw : undefined,
    onOffer: offerRaw === "1" ? true : undefined,
    wholesaleOnly: wholesaleRaw === "1" ? true : undefined,
    orderBy: ORDER_VALUES.includes(sortRaw) ? sortRaw : undefined,
  };
}

/** Parse the 1-based page number (defaults to 1; never below 1). */
export function parseCatalogPage(params: RawSearchParams): number {
  const n = Number.parseInt(first(params[CATALOG_PARAM.page]), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Are any narrowing filters (search/category/type) currently active? */
export function hasActiveFilters(filters: ProductFilters): boolean {
  return Boolean(
    filters.query ||
      filters.category ||
      filters.productType ||
      filters.onOffer ||
      filters.wholesaleOnly
  );
}

/**
 * Build a `?…` query string from the current URLSearchParams plus a set of
 * overrides. Empty/undefined overrides remove the key. Any change that isn't
 * an explicit page change resets to page 1 (call sites pass `page` when they
 * intend to keep/advance it).
 */
export function buildCatalogQuery(
  current: URLSearchParams,
  overrides: Partial<Record<keyof typeof CATALOG_PARAM, string | number | undefined>>
): string {
  const next = new URLSearchParams(current.toString());

  for (const [key, paramName] of Object.entries(CATALOG_PARAM)) {
    if (!(key in overrides)) continue;
    const value = overrides[key as keyof typeof CATALOG_PARAM];
    if (value === undefined || value === "" || value === null) {
      next.delete(paramName);
    } else {
      next.set(paramName, String(value));
    }
  }

  // Drop page=1 to keep canonical URLs clean.
  if (next.get(CATALOG_PARAM.page) === "1") next.delete(CATALOG_PARAM.page);

  const qs = next.toString();
  return qs ? `?${qs}` : "";
}
