import type { Metadata } from "next";
import type { ProductTypes } from "@/types/product";
import type { CatalogPageResult } from "@/types/productFilter";
import { catalogCanonicalPath } from "./catalog";
import { NOINDEX_FOLLOW, buildPageMetadata, truncateDescription } from "./metadata";

/**
 * Curated catalog landing pages — the indexable "category" URLs.
 *
 * The catalog filters by `?category=<uuid>`, which is right for browsing and
 * wrong for search: a UUID URL can't carry a heading, an intro or a clean
 * canonical, and every filtered view is `noindex` (see lib/seo/catalog.ts).
 * These pages give the two searches the store genuinely serves — árabes and
 * decants — a stable, readable URL over the SAME catalog query and components.
 *
 * They are not location pages and not doorway pages: each is a real filtered
 * listing, its copy states facts the catalog backs up, and a landing with no
 * products is `noindex` and absent from the sitemap rather than served thin.
 */

export type LandingSlug = "perfumes-arabes" | "decants";

/** What the landing's listing is filtered by. Exactly one of the two is set. */
export type LandingFilter =
  | { categorySlug: string; productType?: undefined }
  | { productType: ProductTypes; categorySlug?: undefined };

/** Live facts the copy is built from — never hand-typed numbers or brands. */
export interface LandingContext {
  total: number;
  /** Distinct brands among the listed products (a few, for the copy). */
  brands: string[];
}

export interface CatalogLanding {
  slug: LandingSlug;
  path: `/${string}`;
  filter: LandingFilter;
  /** Short link text for the footer, breadcrumbs and cross-links. */
  navLabel: string;
  /** <title>, without the brand (the root template appends it). */
  title: string;
  eyebrow: string;
  heading: string;
  /** Visible lead paragraph under the heading. */
  intro: (ctx: LandingContext) => string;
  /** Meta description, built from the same live facts. */
  description: (ctx: LandingContext) => string;
  related: LandingSlug[];
}

/** "A", "A y B", "A, B y C" — Spanish list. */
export function joinSpanish(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function fragranceCount(total: number): string {
  return total === 1 ? "1 fragancia" : `${total} fragancias`;
}

export const LANDINGS: Record<LandingSlug, CatalogLanding> = {
  "perfumes-arabes": {
    slug: "perfumes-arabes",
    path: "/perfumes-arabes",
    filter: { categorySlug: "arabe" },
    navLabel: "Perfumes árabes",
    title: "Perfumes árabes en Costa Rica",
    eyebrow: "Categoría",
    heading: "Perfumes árabes en Costa Rica",
    intro: ({ brands }) =>
      `Selección de perfumes árabes originales${
        brands.length > 0 ? ` de ${joinSpanish(brands)}` : ""
      }, con envío a todo Costa Rica. Si prefieres probar antes de comprar el frasco completo, revisa las fragancias disponibles en decant.`,
    description: ({ total, brands }) =>
      truncateDescription(
        `Perfumes árabes originales en Costa Rica: ${fragranceCount(total)}${
          brands.length > 0 ? ` de ${joinSpanish(brands)}` : ""
        }. Envío a todo el país, pago con tarjeta o SINPE Móvil.`
      ),
    related: ["decants"],
  },
  decants: {
    slug: "decants",
    path: "/decants",
    filter: { productType: "decant" },
    navLabel: "Decants",
    title: "Decants de perfumes originales en Costa Rica",
    eyebrow: "Presentaciones pequeñas",
    heading: "Decants de perfumes originales",
    intro: () =>
      "Un decant es una porción pequeña de un perfume original, preparada a partir de un frasco auténtico. Te permite probar una fragancia antes de invertir en el frasco completo. Enviamos a todo Costa Rica.",
    description: ({ total }) =>
      truncateDescription(
        `Decants de perfumes originales en Costa Rica: prueba ${fragranceCount(
          total
        )} antes de comprar el frasco completo. Envío a todo el país, tarjeta o SINPE Móvil.`
      ),
    related: ["perfumes-arabes"],
  },
};

export const LANDING_LIST: CatalogLanding[] = Object.values(LANDINGS);

type LandingResult = Pick<CatalogPageResult, "products" | "totalProducts" | "currentPage">;

/** The live facts a landing's copy and metadata are built from. */
export function landingContext(result: LandingResult): LandingContext {
  return {
    total: result.totalProducts,
    brands: pickBrands(result.products),
  };
}

/**
 * Metadata for one page of a landing.
 *
 * Canonical follows the page actually rendered (`currentPage`, which the
 * catalog clamps when `?page=` is past the end), so an out-of-range URL
 * canonicalises to a real page instead of duplicating the last one. A landing
 * with no products is `noindex`: better absent than thin.
 */
export function landingMetadata(
  landing: CatalogLanding,
  result: LandingResult
): Metadata {
  const page = result.currentPage;

  return buildPageMetadata({
    title: page > 1 ? `${landing.title} – Página ${page}` : landing.title,
    description: landing.description(landingContext(result)),
    path: catalogCanonicalPath(landing.path, page),
    robots: result.totalProducts === 0 ? NOINDEX_FOLLOW : undefined,
  });
}

/** Distinct, non-empty brand names in first-seen order, capped for the copy. */
export function pickBrands(
  products: Array<{ brands: { name: string } | null }>,
  max = 3
): string[] {
  const seen: string[] = [];
  for (const product of products) {
    const name = product.brands?.name?.trim();
    if (name && !seen.includes(name)) seen.push(name);
    if (seen.length === max) break;
  }
  return seen;
}
