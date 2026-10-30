import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolveAvailability, type SupplierAwareVariant } from "@/lib/stock";
import StockBadge from "./StockBadge";

function badge(variant: Partial<SupplierAwareVariant>, poolMl = 0) {
  const availability = resolveAvailability(
    { product_type: "full_size", size_ml: 100, stock: 0, ...variant },
    poolMl
  );
  return render(<StockBadge availability={availability} />);
}

describe("StockBadge", () => {
  it("in stock: 'En existencia' with healthy stock", () => {
    badge({ stock: 12 });
    expect(screen.getByText("En existencia")).toBeInTheDocument();
  });

  it("in stock: counts down the last few units", () => {
    badge({ stock: 3 });
    expect(screen.getByText("Últimas 3 unidades")).toBeInTheDocument();
  });

  it("made to order: says 'Por encargo' - not a unit count, not sold out", () => {
    badge({ stock: 0, supplier_available: true });

    expect(screen.getByText("Por encargo")).toBeInTheDocument();
    expect(screen.queryByText(/Últimas/)).not.toBeInTheDocument();
    expect(screen.queryByText("Agotado")).not.toBeInTheDocument();
    expect(screen.queryByText("En existencia")).not.toBeInTheDocument();
  });

  it("sold out: uses the storefront-wide word 'Agotado'", () => {
    badge({ stock: 0, supplier_available: false });

    expect(screen.getByText("Agotado")).toBeInTheDocument();
    expect(screen.queryByText("Sin existencias")).not.toBeInTheDocument();
    expect(screen.queryByText("Por encargo")).not.toBeInTheDocument();
  });

  it("a flagged variant with units is simply in stock", () => {
    badge({ stock: 8, supplier_available: true });
    expect(screen.getByText("En existencia")).toBeInTheDocument();
    expect(screen.queryByText("Por encargo")).not.toBeInTheDocument();
  });

  it("a decant is judged by the pool: stocked pool in stock, empty pool sold out", () => {
    const decant = { product_type: "decant", size_ml: 5, stock: 0, supplier_available: true };
    const { unmount } = badge(decant, 100);
    expect(screen.getByText("En existencia")).toBeInTheDocument();
    unmount();

    badge(decant, 0);
    expect(screen.getByText("Agotado")).toBeInTheDocument();
    expect(screen.queryByText("Por encargo")).not.toBeInTheDocument();
  });
});
