import ProductCard from "@/components/product/ProductCard";
import CatalogWholesaleProvider from "@/components/catalog/CatalogWholesaleContext";
import type { ProductCardData } from "@/types/product";

/**
 * Responsive showroom grid: 2 cols on mobile, 3 on tablet, 4 on desktop.
 * Server component — each card hydrates independently.
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
      <div className="krov-enter-stagger grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </CatalogWholesaleProvider>
  );
}
