import type { Metadata } from "next";
import { getCatalogPage } from "@/features/products/getProducts";
import {
  hasActiveFilters,
  parseCatalogFilters,
  parseCatalogPage,
  type RawSearchParams,
} from "@/lib/catalogParams";
import { catalogSeo } from "@/lib/seo/catalog";
import { LANDING_LIST } from "@/lib/seo/landings";
import { buildPageMetadata } from "@/lib/seo/metadata";
import CatalogHero from "@/components/catalog/CatalogHero";
import CatalogToolbar from "@/components/catalog/CatalogToolbar";
import CatalogResults from "@/components/catalog/CatalogResults";
import CatalogLinks from "@/components/catalog/CatalogLinks";

interface ProductsPageProps {
  // Next.js 16: searchParams is async.
  searchParams: Promise<RawSearchParams>;
}

/**
 * The catalog is one route with an unbounded set of URLs (search, category,
 * type, sort, page). Plain pages index and canonicalise to themselves; any
 * narrowed or re-ordered view is `noindex, follow` — see lib/seo/catalog.ts.
 */
export async function generateMetadata({
  searchParams,
}: ProductsPageProps): Promise<Metadata> {
  const seo = catalogSeo("/products", await searchParams);

  return buildPageMetadata({
    title:
      seo.page > 1
        ? `Catálogo de perfumes originales en Costa Rica – Página ${seo.page}`
        : "Catálogo de perfumes originales en Costa Rica",
    description:
      seo.page > 1
        ? `Página ${seo.page} del catálogo de KROV Perfumería: perfumes originales, perfumes árabes y decants con envío a todo Costa Rica.`
        : "Explora el catálogo de KROV Perfumería: perfumes originales, perfumes árabes y decants con envío a todo Costa Rica. Filtra por categoría, tipo y precio.",
    path: seo.canonicalPath,
    robots: seo.robots,
  });
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const sp = await searchParams;
  const filters = parseCatalogFilters(sp);
  const page = parseCatalogPage(sp);

  const result = await getCatalogPage(page, filters);
  const filtered = hasActiveFilters(filters);

  return (
    <div className="relative min-h-screen bg-krov-void">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-krov-ink via-krov-void to-krov-void"
      />

      <div className="relative">
        <CatalogHero />

        <div className="mx-auto max-w-7xl px-5 pb-24 sm:px-8">
          <CatalogToolbar filters={filters} />

          <CatalogResults result={result} filtered={filtered} />

          <CatalogLinks
            heading="Explora por categoría"
            text="Descubre una selección de perfumes árabes originales, o prueba una fragancia antes de comprar el frasco completo con los decants."
            links={LANDING_LIST.map((landing) => ({
              href: landing.path,
              label: landing.navLabel,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
