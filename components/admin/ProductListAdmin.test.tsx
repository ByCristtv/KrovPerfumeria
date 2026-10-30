import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AdminVariantRow } from "@/types/product";
import type { ActionResult } from "@/types/action";

// `next/image` needs the framework's image loader/config, which does not exist
// in jsdom. A plain <img> preserves everything this suite asserts on (src, alt).
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

// The row actions talk to Supabase + SweetAlert; the activate/deactivate path is
// not exercised here, and the supplier action is replaced by a spy.
vi.mock("sweetalert2", () => ({ default: { fire: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { from: vi.fn() } }));
const { setSupplier } = vi.hoisted(() => ({ setSupplier: vi.fn() }));
vi.mock("@/app/admin/products/actions", () => ({
  setSupplierAvailabilityAction: setSupplier,
}));

import Swal from "sweetalert2";
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
        "Stock propio",
        "Proveedor",
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

  // ── Phase 4: supplier availability ───────────────────────────────────────
  describe("supplier availability", () => {
    /** A bottle with supplier data loaded; override per scenario. */
    const supplierRow = (overrides: Partial<AdminVariantRow> = {}) =>
      variant({
        stock: 0,
        supplier_available: false,
        supplier_checked_at: null,
        ...overrides,
      });

    const btn = (name: RegExp) => screen.queryByRole("button", { name });
    const onlyRow = () => bodyRows()[0];

    describe("distinguishes the supplier from KROV's own stock", () => {
      it("labels the existing stock column 'Stock propio' and adds a separate 'Proveedor' one", () => {
        render(<ProductListAdmin rows={[supplierRow({ stock: 4 })]} />);

        expect(headers()).toContain("Stock propio");
        expect(headers()).toContain("Proveedor");
        expect(headers()).not.toContain("Stock");
      });

      it("keeps showing the physical stock number regardless of the supplier flag", () => {
        render(
          <ProductListAdmin
            rows={[supplierRow({ stock: 4, supplier_available: true })]}
          />
        );
        const cells = within(onlyRow()).getAllByRole("cell");
        const stockIndex = headers().indexOf("Stock propio");
        expect(cells[stockIndex]).toHaveTextContent("4");
      });
    });

    describe("what the cell says", () => {
      it("never verified: 'Sin verificar', with both ways to record a first check", () => {
        render(<ProductListAdmin rows={[supplierRow()]} />);

        expect(screen.getByText("Sin verificar")).toBeInTheDocument();
        expect(btn(/como disponible/)).toBeInTheDocument();
        expect(btn(/como agotado/)).toBeInTheDocument();
        expect(btn(/Reconfirmar/)).not.toBeInTheDocument(); // nothing to reconfirm yet
      });

      it("available: says so, shows when it was checked, offers sold-out and Reconfirmar", () => {
        render(
          <ProductListAdmin
            rows={[
              supplierRow({
                supplier_available: true,
                // 03:00 UTC on the 29th is still the 28th in Costa Rica (UTC-6).
                supplier_checked_at: "2026-10-29T03:00:00Z",
              }),
            ]}
          />
        );

        expect(screen.getByText("Disponible en proveedor")).toBeInTheDocument();
        expect(screen.getByText(/verificado\s+28\b/)).toBeInTheDocument();
        expect(btn(/como agotado/)).toBeInTheDocument();
        expect(btn(/Reconfirmar/)).toBeInTheDocument();
        expect(btn(/como disponible/)).not.toBeInTheDocument();
      });

      it("verified sold out: says so, offers available and Reconfirmar", () => {
        render(
          <ProductListAdmin
            rows={[supplierRow({ supplier_checked_at: "2026-10-20T15:00:00Z" })]}
          />
        );

        expect(screen.getByText("Agotado en proveedor")).toBeInTheDocument();
        expect(btn(/como disponible/)).toBeInTheDocument();
        expect(btn(/Reconfirmar/)).toBeInTheDocument();
        expect(btn(/como agotado/)).not.toBeInTheDocument();
      });

      it("data that could not be loaded shows a dash and NO controls, not 'agotado'", () => {
        render(
          <ProductListAdmin
            rows={[supplierRow({ supplier_available: undefined, supplier_checked_at: undefined })]}
          />
        );

        // Scoped to the Proveedor cell: "Mayorista" also renders a dash.
        const cell = within(onlyRow()).getAllByRole("cell")[headers().indexOf("Proveedor")];
        expect(cell).toHaveTextContent(/^—$/);
        expect(within(cell).queryByRole("button")).not.toBeInTheDocument();
        expect(btn(/proveedor/)).not.toBeInTheDocument();
      });

      it("decants get no control - their stock is the ml pool", () => {
        render(
          <ProductListAdmin
            rows={[
              supplierRow({
                product_type: "decant",
                size_ml: 5,
                // Even a (database-forbidden) flagged decant gets no control.
                supplier_available: true,
              }),
            ]}
          />
        );

        expect(screen.getByText("No aplica")).toBeInTheDocument();
        expect(btn(/proveedor/)).not.toBeInTheDocument();
      });
    });

    describe("'En tienda' shows what customers will see", () => {
      const storeLine = () => screen.getByText(/En tienda:/).textContent;

      it.each([
        ["no stock + available → Por encargo", { stock: 0, supplier_available: true }, "Por encargo"],
        ["no stock + not available → Agotado", { stock: 0, supplier_available: false }, "Agotado"],
        ["stock wins over an available flag → En stock", { stock: 4, supplier_available: true }, "En stock"],
        ["stock, flag off → En stock", { stock: 4, supplier_available: false }, "En stock"],
      ])("%s", (_label, overrides, expected) => {
        render(<ProductListAdmin rows={[supplierRow(overrides)]} />);
        expect(storeLine()).toContain(expected);
      });

      it("is left out for an inactive variant, which customers cannot see at all", () => {
        render(<ProductListAdmin rows={[supplierRow({ is_active: false })]} />);
        expect(screen.queryByText(/En tienda:/)).not.toBeInTheDocument();
      });
    });

    describe("changing it", () => {
      beforeEach(() => {
        setSupplier.mockResolvedValue({ ok: true, message: "Marcado como disponible en el proveedor." });
      });

      it("'Marcar disponible' sends (variantId, true), refreshes the page, and toasts", async () => {
        const onChanged = vi.fn();
        render(
          <ProductListAdmin
            rows={[supplierRow({ variant_id: "v-9" })]}
            onChanged={onChanged}
          />
        );

        fireEvent.click(btn(/como disponible/)!);

        await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
        expect(setSupplier).toHaveBeenCalledTimes(1);
        expect(setSupplier).toHaveBeenCalledWith("v-9", true);
        expect(Swal.fire).toHaveBeenCalledWith(
          expect.objectContaining({ toast: true, icon: "success" })
        );
      });

      it("'Marcar agotado' sends (variantId, false)", async () => {
        render(
          <ProductListAdmin
            rows={[supplierRow({ variant_id: "v-9", supplier_available: true, supplier_checked_at: "2026-10-28T10:00:00Z" })]}
            onChanged={vi.fn()}
          />
        );

        fireEvent.click(btn(/como agotado/)!);

        await waitFor(() => expect(setSupplier).toHaveBeenCalledWith("v-9", false));
      });

      it.each([
        ["available", true],
        ["sold out", false],
      ])("Reconfirmar on a verified %s row re-sends the SAME value (%s)", async (_label, current) => {
        render(
          <ProductListAdmin
            rows={[supplierRow({ variant_id: "v-9", supplier_available: current, supplier_checked_at: "2026-10-28T10:00:00Z" })]}
            onChanged={vi.fn()}
          />
        );

        fireEvent.click(btn(/Reconfirmar/)!);

        await waitFor(() => expect(setSupplier).toHaveBeenCalledWith("v-9", current));
      });

      it("disables the row's controls while the request is in flight, then re-enables them", async () => {
        let finish!: (value: ActionResult) => void;
        setSupplier.mockReturnValue(new Promise<ActionResult>((resolve) => (finish = resolve)));
        render(<ProductListAdmin rows={[supplierRow()]} onChanged={vi.fn()} />);

        fireEvent.click(btn(/como disponible/)!);

        await waitFor(() => expect(btn(/como disponible/)).toBeDisabled());
        expect(btn(/como agotado/)).toBeDisabled();

        // A second click while pending must not fire a second request.
        fireEvent.click(btn(/como disponible/)!);
        expect(setSupplier).toHaveBeenCalledTimes(1);

        finish({ ok: true, message: "ok" });
        await waitFor(() => expect(btn(/como disponible/)).toBeEnabled());
      });

      it("a refused change shows the server's message and does NOT refresh as if it worked", async () => {
        setSupplier.mockResolvedValue({ ok: false, message: "No tienes permiso para realizar esta acción." });
        const onChanged = vi.fn();
        render(<ProductListAdmin rows={[supplierRow()]} onChanged={onChanged} />);

        fireEvent.click(btn(/como disponible/)!);

        await waitFor(() =>
          expect(Swal.fire).toHaveBeenCalledWith(
            expect.objectContaining({ icon: "error", text: "No tienes permiso para realizar esta acción." })
          )
        );
        expect(onChanged).not.toHaveBeenCalled();
        expect(btn(/como disponible/)).toBeEnabled();
      });

      it("a network failure is reported and leaves the row usable", async () => {
        setSupplier.mockRejectedValue(new Error("fetch failed"));
        const onChanged = vi.fn();
        render(<ProductListAdmin rows={[supplierRow()]} onChanged={onChanged} />);

        fireEvent.click(btn(/como disponible/)!);

        await waitFor(() =>
          expect(Swal.fire).toHaveBeenCalledWith(
            expect.objectContaining({ icon: "error", text: expect.stringMatching(/conexión/i) })
          )
        );
        expect(onChanged).not.toHaveBeenCalled();
        await waitFor(() => expect(btn(/como disponible/)).toBeEnabled());
      });

      it("acts on the clicked row only", async () => {
        render(
          <ProductListAdmin
            rows={[
              supplierRow({ variant_id: "v-1", sku: "A-1" }),
              supplierRow({ variant_id: "v-2", sku: "B-2" }),
            ]}
            onChanged={vi.fn()}
          />
        );

        fireEvent.click(
          screen.getByRole("button", { name: "Marcar B-2 como disponible en el proveedor" })
        );

        await waitFor(() => expect(setSupplier).toHaveBeenCalledTimes(1));
        expect(setSupplier).toHaveBeenCalledWith("v-2", true);
      });
    });
  });

  it("renders an empty state instead of a headerless table", () => {
    render(<ProductListAdmin rows={[]} />);

    expect(screen.getByText("No hay variantes disponibles.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
