import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AdminVariantRow } from "@/types/product";

// `next/image` needs the framework's image loader/config, which does not exist
// in jsdom. A plain <img> preserves everything this suite asserts on (src, alt).
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

// The row actions talk to Supabase + SweetAlert; neither is exercised here.
vi.mock("sweetalert2", () => ({ default: { fire: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { from: vi.fn() } }));

import ProductListAdmin from "./ProductListAdmin";

function variant(overrides: Partial<AdminVariantRow> = {}): AdminVariantRow {
  return {
    variant_id: "v-1",
    product_id: "p-1",
    sku: "SKU-1",
    size_ml: 100,
    product_type: "full_size",
    price: 25000,
    stock: 4,
    is_on_offer: false,
    offer_price: null,
    is_active: true,
    wholesale_price: null,
    min_wholesale_quantity: null,
    name: "Sauvage",
    description: null,
    brand: "Dior",
    categories: [{ id: "c-1", name: "Hombre" }],
    image_url: "https://cdn/sauvage.jpg",
    ...overrides,
  };
}

/** The header cells, in render order. */
function headers(): string[] {
  return screen
    .getAllByRole("columnheader")
    .map((th) => th.textContent?.trim() ?? "");
}

/** Body rows only (the header row is excluded). */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

describe("ProductListAdmin", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Task 2: the Categorías → Miniatura swap ──────────────────────────────
  describe("columns", () => {
    it("no longer shows a Categorías column", () => {
      render(<ProductListAdmin rows={[variant()]} />);

      expect(headers()).not.toContain("Categorías");
    });

    it("shows a Miniatura column in its place", () => {
      render(<ProductListAdmin rows={[variant()]} />);

      expect(headers()).toContain("Miniatura");
    });

    it("does not render the category names anywhere in the row", () => {
      render(
        <ProductListAdmin
          rows={[variant({ categories: [{ id: "c-9", name: "Amaderados" }] })]}
        />
      );

      expect(screen.queryByText(/Amaderados/)).not.toBeInTheDocument();
    });

    it("keeps every other column intact", () => {
      render(<ProductListAdmin rows={[variant()]} />);

      expect(headers()).toEqual([
        "Miniatura",
        "SKU",
        "Producto",
        "Marca",
        "Tipo",
        "Tamaño",
        "Precio",
        "Mayorista",
        "Stock",
        "Estado",
        "Acciones",
      ]);
    });

    it("gives every body row the same number of cells as the header", () => {
      render(
        <ProductListAdmin
          rows={[variant(), variant({ variant_id: "v-2", image_url: null })]}
        />
      );

      const columns = headers().length;
      for (const row of bodyRows()) {
        expect(within(row).getAllByRole("cell")).toHaveLength(columns);
      }
    });
  });

  // ── Task 2: the thumbnail itself ─────────────────────────────────────────
  describe("thumbnail", () => {
    it("renders the variant's image", () => {
      render(<ProductListAdmin rows={[variant()]} />);

      const img = document.querySelector("img");
      expect(img).toHaveAttribute("src", "https://cdn/sauvage.jpg");
    });

    it("renders a placeholder — not a broken image — when there is none", () => {
      render(<ProductListAdmin rows={[variant({ image_url: null })]} />);

      expect(document.querySelector("img")).toBeNull();
      expect(screen.getByTitle("Sauvage — sin imagen")).toBeInTheDocument();
    });

    it("leaves the image out of the accessibility tree", () => {
      // The product name is already in the next cell; repeating it is noise.
      render(<ProductListAdmin rows={[variant()]} />);

      expect(document.querySelector("img")).toHaveAttribute("alt", "");
    });

    it("renders one thumbnail per row", () => {
      render(
        <ProductListAdmin
          rows={[
            variant({ variant_id: "v-1", image_url: "https://cdn/a.jpg" }),
            variant({ variant_id: "v-2", image_url: "https://cdn/b.jpg" }),
          ]}
        />
      );

      expect(
        Array.from(document.querySelectorAll("img")).map((i) => i.getAttribute("src"))
      ).toEqual(["https://cdn/a.jpg", "https://cdn/b.jpg"]);
    });
  });

  // ── Ordering is the server's job; the table must not reorder it ───────────
  describe("ordering", () => {
    it("renders rows in exactly the order it was given", () => {
      render(
        <ProductListAdmin
          rows={[
            variant({ variant_id: "v-1", sku: "ON-1", is_active: true }),
            variant({ variant_id: "v-2", sku: "ON-2", is_active: true }),
            variant({ variant_id: "v-3", sku: "OFF-1", is_active: false }),
          ]}
        />
      );

      const skus = bodyRows().map(
        (row) => within(row).getAllByRole("cell")[1].textContent
      );
      expect(skus).toEqual(["ON-1", "ON-2", "OFF-1"]);
    });

    it("labels each row's status so active/inactive is readable at a glance", () => {
      render(
        <ProductListAdmin
          rows={[
            variant({ variant_id: "v-1", is_active: true }),
            variant({ variant_id: "v-2", is_active: false }),
          ]}
        />
      );

      expect(screen.getByText("Activa")).toBeInTheDocument();
      expect(screen.getByText("Inactiva")).toBeInTheDocument();
    });
  });

  it("renders an empty state instead of a headerless table", () => {
    render(<ProductListAdmin rows={[]} />);

    expect(screen.getByText("No hay variantes disponibles.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
