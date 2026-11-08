import type { ProductGender } from "@/types/product";

/**
 * Storefront gender rule for the catalog category filter.
 *
 * `products.gender` is the single source of truth for a product's audience.
 * The catalog dropdown still lists Hombre / Mujer / Unisex next to the
 * commercial categories, and links carry `?category=<uuid>` — those three
 * category ids are kept as COMPATIBILITY identifiers only: selecting one
 * resolves to gender values, never to `product_categories` rows (which no
 * longer hold gender; see migration 20261107000100).
 *
 *   Hombre  -> gender in (masculine, unisex)
 *   Mujer   -> gender in (feminine, unisex)
 *   Unisex  -> gender = unisex
 *   any other category (Árabe, Nicho, Diseñador, …) -> its association rows
 *
 * The category ids are looked up by their stable slugs at request time (the
 * caller does that), so no UUID is hardcoded and this module stays pure and
 * trivially unit-testable (see catalogCategoryFilter.test.ts).
 */

/** Slugs of the three categories that stand for a gender, not a classification. */
export const GENDER_CATEGORY_SLUGS = ["hombre", "mujer", "unisex"] as const;

export type GenderCategorySlug = (typeof GENDER_CATEGORY_SLUGS)[number];

/** Map of gender-category slug -> its id. Any entry may be absent if unseeded. */
export type GenderCategoryIds = Partial<Record<GenderCategorySlug, string>>;

/** Which `products.gender` values each gender filter includes. Unisex is shared. */
const GENDERS_FOR_FILTER: Record<GenderCategorySlug, readonly ProductGender[]> = {
  hombre: ["masculine", "unisex"],
  mujer: ["feminine", "unisex"],
  unisex: ["unisex"],
};

/** Is this category slug one of the gender compatibility categories? */
export function isGenderCategorySlug(
  slug: string | null | undefined
): slug is GenderCategorySlug {
  return (GENDER_CATEGORY_SLUGS as readonly string[]).includes(slug ?? "");
}

/** What a selected `?category=<id>` actually filters on. */
export type CatalogCategoryFilter =
  | { kind: "gender"; genders: ProductGender[] }
  | { kind: "category"; categoryId: string };

/**
 * Resolve a selected category id. A gender category becomes a gender-value
 * filter on `products.gender`; every other id (including an unknown one, which
 * then simply matches nothing) stays a category-association filter.
 */
export function resolveCatalogCategoryFilter(
  selectedId: string,
  genderIds: GenderCategoryIds
): CatalogCategoryFilter {
  for (const slug of GENDER_CATEGORY_SLUGS) {
    if (genderIds[slug] && genderIds[slug] === selectedId) {
      return { kind: "gender", genders: [...GENDERS_FOR_FILTER[slug]] };
    }
  }
  return { kind: "category", categoryId: selectedId };
}

/**
 * Genders worth recommending next to a product of `gender`, best match first.
 * Unisex belongs with both men's and women's perfumes; a unisex perfume goes
 * with anything, but other unisex ones first. `null` (unknown) = no preference.
 */
export function relatedGenders(gender: ProductGender | null | undefined): ProductGender[] | null {
  switch (gender) {
    case "masculine":
      return ["masculine", "unisex"];
    case "feminine":
      return ["feminine", "unisex"];
    case "unisex":
      return ["unisex", "masculine", "feminine"];
    default:
      return null;
  }
}

/**
 * The commercial category ids among a product's categories — the legacy gender
 * rows (if a product still has any) are dropped, so matching on categories can
 * never smuggle gender back in.
 */
export function commercialCategoryIds(
  categories: readonly { id: string; slug?: string | null }[]
): string[] {
  return categories.filter((c) => !isGenderCategorySlug(c.slug)).map((c) => c.id);
}
