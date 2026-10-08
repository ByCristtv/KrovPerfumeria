import ProductGrid from "@/components/catalog/ProductGrid";
import CatalogPagination from "@/components/catalog/CatalogPagination";
import CatalogEmptyState from "@/components/catalog/CatalogEmptyState";
import type { CatalogPageResult } from "@/types/productFilter";

interface CatalogResultsProps {
  result: CatalogPageResult;
  /** Whether narrowing filters are active (changes the empty-state copy). */
  filtered: boolean;
}

/**
 * The result count, grid and pagination — shared by /products and the curated
 * landing pages so the three listings can never drift apart. Server component.
 */
export default function CatalogResults({ result, filtered }: CatalogResultsProps) {
  if (result.products.length === 0) {
    return <CatalogEmptyState filtered={filtered} />;
  }

  const from = (result.currentPage - 1) * result.pageSize + 1;
  const to = Math.min(result.currentPage * result.pageSize, result.totalProducts);

  return (
    <>
      {/* Result count doubles as the rule that closes the toolbar and
          opens the grid, so the page has one seam here instead of two. */}
      <div className="mb-8 mt-10 flex items-center gap-5">
        <p className="shrink-0 text-[10px] uppercase tracking-[0.24em] text-krov-dust">
          {from}–{to} de {result.totalProducts}
        </p>
        <span aria-hidden className="krov-rule h-px flex-1" />
      </div>

      <ProductGrid products={result.products} />

      <CatalogPagination
        currentPage={result.currentPage}
        totalPages={result.totalPages}
        hasNextPage={result.hasNextPage}
        hasPreviousPage={result.hasPreviousPage}
      />
    </>
  );
}
