import CatalogHero from "@/components/catalog/CatalogHero";
import {
  Bone,
  LoadingAnnouncement,
  SkeletonRegion,
  TextBone,
} from "@/components/ui/Skeleton";

/** Enough to fill the first viewport at every breakpoint (2 rows of 4). */
const PLACEHOLDER_CARDS = 8;

/**
 * Shown while a catalog page is fetched server-side (first load, pagination,
 * and every filter change — each is a new URL).
 *
 * Mirrors `app/products/page.tsx` element for element:
 * · the REAL `CatalogHero` (a server component with no data), so the space
 *   above the toolbar can never drift from the page again — the previous
 *   skeleton drew a title the hero no longer has, and the grid jumped up
 *   ~150px when the data landed;
 * · the toolbar's shell at its collapsed height (search field + Filtros);
 * · the result-count rule;
 * · cards built from the same plate + type rhythm as `ProductCard`.
 */
export default function CatalogLoading() {
  return (
    <div className="relative min-h-screen bg-krov-void">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-krov-ink via-krov-void to-krov-void"
      />
      <LoadingAnnouncement label="Cargando el catálogo…" />

      <div className="relative">
        <CatalogHero />

        <div className="mx-auto max-w-7xl px-5 pb-24 sm:px-8">
          {/* Toolbar: the real glass shell, not a bone — it is chrome the user
              already knows, and keeping it solid stops the page from reading as
              "everything is missing". Only its controls are placeholders. The
              46px rows match the real input (py-3 + 20px line + 2px border). */}
          <div className="rounded-2xl border border-white/8 bg-krov-ink/85 p-4 sm:p-5">
            <SkeletonRegion className="flex items-center gap-3">
              <Bone className="h-[46px] flex-1 rounded-lg" />
              <Bone className="h-[46px] w-[7.5rem] shrink-0 rounded-lg" />
            </SkeletonRegion>
          </div>

          <SkeletonRegion>
            {/* Result count + rule */}
            <div className="mb-8 mt-10 flex items-center gap-5">
              <TextBone
                className="shrink-0 text-[10px] tracking-[0.24em]"
                width="4.5rem"
              />
              <span className="krov-rule h-px flex-1 opacity-60" />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: PLACEHOLDER_CARDS }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          </SkeletonRegion>
        </div>
      </div>
    </div>
  );
}

/**
 * `ProductCard` without data. Every text row reuses the card's own type classes
 * (see `TextBone`), so the card height matches to the pixel; the plate keeps
 * the linen gradient so the swap to the photograph doesn't flash dark → light.
 */
function ProductCardSkeleton() {
  return (
    <div className="flex h-full flex-col rounded-2xl">
      <div className="aspect-4/5 rounded-t-xl bg-linear-to-b from-krov-linen to-krov-linen-deep" />
      <div className="flex flex-1 flex-col pt-4">
        <TextBone className="text-[9px]" width="3.5rem" />
        <TextBone
          className="mt-2 text-lg leading-snug"
          width="80%"
          strong
        />
        <TextBone className="mt-1 text-[11px]" width="5.5rem" />
        <TextBone className="mt-auto pt-3 text-base" width="4.5rem" strong />
      </div>
    </div>
  );
}
