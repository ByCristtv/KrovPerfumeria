import ProductCard from "@/components/product/ProductCard";
import CatalogWholesaleProvider from "@/components/catalog/CatalogWholesaleContext";
import type { ProductCardData } from "@/types/product";

/**
 * Responsive showroom grid: 2 cols on mobile, 3 on tablet, 4 on desktop.
 * Server component — each card hydrates independently.
 *
 * Spacing: cards have no frame of their own, so the ROW gap carries the
 * separation between one card's price and the next card's photograph; it is
 * deliberately larger than the column gap (which only has to keep two light
 * plates from touching) and grows with the viewport.
 *
 * `krov-enter-stagger` rises the cards in reading order as the page streams in
 * from `loading.tsx`. Pure CSS on the grid, so it costs no client JS and no
 * per-card prop; it overrides ProductCard's own fade only inside this grid.
 *
 * Wrapped in {@link CatalogWholesaleProvider} so approved wholesale buyers get
 * one shared pricing fetch for the whole page; retail visitors fetch nothing.
 */
export default function ProductGrid({ products }: { products: ProductCardData[] }) {
  const variantIds = products
    .map((p) => p.featured_variant?.id)
    .filter((id): id is string => !!id);

  return (
    <CatalogWholesaleProvider variantIds={variantIds}>
      <div className="krov-enter-stagger grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 sm:gap-y-12 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </CatalogWholesaleProvider>
  );
}
