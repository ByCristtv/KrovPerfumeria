import Link from "next/link";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

export interface Crumb {
  label: string;
  /** Omit on the current page. */
  href?: string;
}

interface CatalogHeroProps {
  eyebrow?: string;
  /** The page's one `<h1>`. */
  title?: string;
  /** Lead paragraph. Omitted on /products, where the grid should lead. */
  intro?: string;
  /** Breadcrumb trail — current page last. Mirrors the BreadcrumbList JSON-LD. */
  crumbs?: Crumb[];
  /**
   * Render the title as the page's `<h1>` (default). The loading skeleton
   * passes `false`: its markup is streamed as the Suspense fallback for every
   * route under /products — product pages included — so a real heading there
   * would put the catalog's `<h1>` in the initial HTML of each product page.
   */
  asHeading?: boolean;
}

/**
 * The masthead over the collection.
 *
 * It used to be a bare aura: the catalogue opened on nothing, and the page had
 * no `<h1>` at all — search engines had no statement of what the page is. It is
 * now a label and a single heading, kept deliberately compact so the toolbar and
 * grid still start close to the header. Landing pages (/decants,
 * /perfumes-arabes) add an intro and a breadcrumb on top of the same masthead.
 *
 * The defaults describe the main catalogue, so `app/products/loading.tsx` —
 * which renders this with no props — shows the identical heading while data
 * loads and nothing shifts when the page arrives.
 *
 * Server component. It was a client component only to run a Framer stagger on
 * two elements, which cost a hydration boundary at the very top of the most
 * visited page in the store for an animation nobody was waiting to see.
 */
export default function CatalogHero({
  eyebrow = "La colección",
  title = "Perfumes originales en Costa Rica",
  intro,
  crumbs,
  asHeading = true,
}: CatalogHeroProps) {
  const Title = asHeading ? "h1" : "p";

  return (
    <section className="relative overflow-hidden px-5 pb-6 pt-28 sm:px-8 md:pt-36">
      <div
        aria-hidden
        className="krov-aura-wine pointer-events-none absolute -top-28 left-1/4 h-[26rem] w-[26rem] opacity-60"
      />

      <div className="relative mx-auto max-w-7xl">
        {crumbs && crumbs.length > 0 && (
          <nav
            aria-label="Migas"
            className="mb-6 text-[10px] uppercase tracking-[0.24em] text-krov-dust"
          >
            <ol className="flex flex-wrap items-center">
              {crumbs.map((crumb, i) => (
                <li key={crumb.label} className="flex items-center">
                  {i > 0 && (
                    <span className="mx-2.5 text-krov-smoke" aria-hidden>
                      /
                    </span>
                  )}
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="transition-colors hover:text-krov-bone"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current="page" className="text-krov-rose">
                      {crumb.label}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        <p className="krov-eyebrow">{eyebrow}</p>

        <Title
          className="mt-4 text-3xl leading-[1.1] text-krov-bone md:text-5xl"
          style={{ fontFamily: serif }}
        >
          {title}
        </Title>

        {intro && (
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-krov-ash md:text-base">
            {intro}
          </p>
        )}
      </div>
    </section>
  );
}
