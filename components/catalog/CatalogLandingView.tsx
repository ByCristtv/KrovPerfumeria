import { getLandingCatalog } from "@/features/products/getLandingCatalog";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbSchema } from "@/lib/seo/jsonLd";
import {
  LANDINGS,
  landingContext,
  type CatalogLanding,
} from "@/lib/seo/landings";
import CatalogHero from "@/components/catalog/CatalogHero";
import CatalogResults from "@/components/catalog/CatalogResults";
import CatalogLinks from "@/components/catalog/CatalogLinks";

interface CatalogLandingViewProps {
  landing: CatalogLanding;
  page: number;
}

/**
 * A curated catalog landing (/perfumes-arabes, /decants): the regular catalog
 * grid under a heading, an intro and a breadcrumb. Same query path, grid and
 * pagination as /products — only the fixed filter and the copy differ.
 *
 * The intro is built from live data (see `landingContext`), so it can't claim a
 * brand or a count the catalog doesn't have. Server component.
 */
export default async function CatalogLandingView({
  landing,
  page,
}: CatalogLandingViewProps) {
  const result = await getLandingCatalog(landing.slug, page);

  return (
    <div className="relative min-h-screen bg-krov-void">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-krov-ink via-krov-void to-krov-void"
      />

      {/* The names mirror the visible breadcrumb in the hero. */}
      <JsonLd
        data={breadcrumbSchema([
          { name: "KROV", path: "/" },
          { name: landing.navLabel, path: landing.path },
        ])}
      />

      <div className="relative">
        <CatalogHero
          eyebrow={landing.eyebrow}
          title={landing.heading}
          intro={landing.intro(landingContext(result))}
          crumbs={[{ label: "KROV", href: "/" }, { label: landing.navLabel }]}
        />

        <div className="mx-auto max-w-7xl px-5 pb-24 sm:px-8">
          <CatalogResults result={result} filtered={false} />

          <CatalogLinks
            heading="Sigue explorando"
            links={[
              ...landing.related.map((slug) => ({
                href: LANDINGS[slug].path,
                label: LANDINGS[slug].navLabel,
              })),
              { href: "/products", label: "Ver todo el catálogo" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
