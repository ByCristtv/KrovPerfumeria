import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductCardData } from "@/types/product";

// The grid is layout; the card and the wholesale fetch are tested on their own.
vi.mock("@/components/product/ProductCard", () => ({
  default: ({ product }: { product: ProductCardData }) => (
    <article data-testid="card">{product.name}</article>
  ),
}));
vi.mock("@/components/catalog/CatalogWholesaleContext", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import ProductGrid from "./ProductGrid";

const product = (id: string): ProductCardData => ({
  id,
  name: `Perfume ${id}`,
  slug: id,
  gender: "unisex",
  concentration: "EDP",
  brands: null,
  decant_stock_ml: 0,
  featured_variant: null,
  product_images: [],
});

describe("ProductGrid", () => {
  it("renders one card per product, in order", () => {
    render(<ProductGrid products={[product("a"), product("b"), product("c")]} />);
    expect(screen.getAllByTestId("card").map((c) => c.textContent)).toEqual([
      "Perfume a",
      "Perfume b",
      "Perfume c",
    ]);
  });

  it("keeps the two-column phone grid, widening to 3 and 4 columns", () => {
    render(<ProductGrid products={[product("a")]} />);
    const grid = screen.getByTestId("card").parentElement!;

    for (const cls of ["grid", "grid-cols-2", "md:grid-cols-3", "lg:grid-cols-4"]) {
      expect(grid.className).toContain(cls);
    }
  });

  it("separates ROWS more than columns: cards have no frame, so the row gap does the work", () => {
    render(<ProductGrid products={[product("a")]} />);
    const cls = screen.getByTestId("card").parentElement!.className;

    expect(cls).toContain("gap-x-4");
    expect(cls).toContain("gap-y-10");
    expect(cls).toContain("sm:gap-y-12");
    // The old uniform gap would silently undo the refinement.
    expect(cls).not.toMatch(/(^|\s)gap-4(\s|$)/);
  });
});
