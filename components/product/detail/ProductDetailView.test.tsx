import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeProduct, makeVariant } from "@/test/helpers/seoFixtures";
import type { ProductDetailData, ProductVariant } from "@/types/product";

const { addItem } = vi.hoisted(() => ({ addItem: vi.fn() }));
vi.mock("@/hooks/useCart", () => ({ useCart: () => ({ addItem }) }));
vi.mock("@/hooks/useWholesalePricingMap", () => ({
  useWholesalePricingMap: () => ({ eligible: false, pricingMap: {} }),
}));

// Heavy, state-free children that are irrelevant to the purchase wiring.
vi.mock("./ProductGallery", () => ({ default: () => null }));
vi.mock("./AmbientBackground", () => ({ default: () => null }));
vi.mock("./ProductDescription", () => ({ default: () => null }));
vi.mock("./FragranceNotes", () => ({ default: () => null }));
vi.mock("./RelatedProducts", () => ({ default: () => null }));
vi.mock("./Reveal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import ProductDetailView from "./ProductDetailView";

const IN_STOCK = makeVariant({
  id: "v-100", size_ml: 100, price: 21_000, stock: 4, sku: "KRV-100", supplier_available: false,
});
const MADE_TO_ORDER = makeVariant({
  id: "v-50", size_ml: 50, price: 12_000, stock: 0, sku: "KRV-050", supplier_available: true,
});
const SOLD_OUT = makeVariant({
  id: "v-30", size_ml: 30, price: 8_000, stock: 0, sku: "KRV-030", supplier_available: false,
});

function product(
  variants: ProductVariant[],
  featured: string,
  overrides: Partial<ProductDetailData> = {}
): ProductDetailData {
  return makeProduct({
    featured_variant_id: featured,
    product_variants: variants,
    decant_stock_ml: 0,
    ...overrides,
  });
}

function mount(p: ProductDetailData, initialVariantId?: string) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  );
  render(<ProductDetailView product={p} related={[]} initialVariantId={initialVariantId} />);
}

const size = (ml: number) => screen.getByRole("button", { name: new RegExp(`^${ml} ml`) });
const addToCart = () => screen.queryByRole("button", { name: "Agregar al carrito" });
/** The panel's inquiry link (the mobile bar's twin sits in an aria-hidden region). */
const panelInquiry = () => screen.queryByRole("link", { name: /Consultar disponibilidad/ });
const decoded = (a: HTMLElement) =>
  new URL(a.getAttribute("href")!).searchParams.get("text") ?? "";

beforeEach(() => addItem.mockClear());

describe("ProductDetailView: in stock", () => {
  it("adds the selected quantity of the real variant to the cart", () => {
    mount(product([IN_STOCK, MADE_TO_ORDER, SOLD_OUT], "v-100"));

    fireEvent.click(screen.getByRole("button", { name: "Aumentar cantidad" }));
    fireEvent.click(addToCart()!);

    expect(addItem).toHaveBeenCalledTimes(2); // quantity 2 => two addItem calls (existing behavior)
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        variant_id: "v-100",
        product_name: "Lion",
        size_ml: 100,
        price: 21_000,
        stock: 4,
      })
    );
    expect(panelInquiry()).not.toBeInTheDocument();
  });
});

describe("ProductDetailView: made to order", () => {
  it("shows the inquiry, not the cart, and never calls addItem", () => {
    mount(product([IN_STOCK, MADE_TO_ORDER], "v-50"));

    expect(addToCart()).not.toBeInTheDocument();
    const link = panelInquiry()!;
    fireEvent.click(link);

    expect(addItem).not.toHaveBeenCalled();
  });

  it("writes the SELECTED size's facts into the message", () => {
    mount(product([IN_STOCK, MADE_TO_ORDER], "v-50"));

    const text = decoded(panelInquiry()!);
    expect(text).toContain("Producto: Rayhaan Lion");
    expect(text).toContain("Presentación: 50 ml");
    expect(text).toContain("Código: KRV-050");
    expect(text).toMatch(/Precio publicado: .*12.?000/);
    expect(text).not.toContain("KRV-100");
  });

  it("links the canonical product URL with no ?variant= query", () => {
    mount(product([IN_STOCK, MADE_TO_ORDER], "v-50"), "v-50");
    const text = decoded(panelInquiry()!);
    expect(text).toMatch(/Enlace: .*\/products\/lion$/m);
    expect(text).not.toContain("?variant");
  });

  it("flips between the cart and the inquiry as the customer changes size", () => {
    mount(product([IN_STOCK, MADE_TO_ORDER], "v-100"));

    // Starts on the in-stock bottle.
    expect(addToCart()).toBeInTheDocument();
    expect(panelInquiry()).not.toBeInTheDocument();

    // Made-to-order size is selectable and swaps the CTA.
    fireEvent.click(size(50));
    expect(addToCart()).not.toBeInTheDocument();
    expect(decoded(panelInquiry()!)).toContain("Código: KRV-050");

    // And back.
    fireEvent.click(size(100));
    expect(addToCart()).toBeInTheDocument();
    expect(panelInquiry()).not.toBeInTheDocument();

    expect(addItem).not.toHaveBeenCalled();
  });

  it("the mobile bar offers the same inquiry and no add button", () => {
    mount(product([MADE_TO_ORDER], "v-50"));

    // Two links: the panel's, and the one in the (aria-hidden until scrolled) bar.
    const links = screen.getAllByRole("link", { name: /Consultar/, hidden: true });
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.getAttribute("href"))).size).toBe(1);

    const bars = links
      .map((l) => l.closest<HTMLElement>(".md\\:hidden"))
      .filter((el): el is HTMLElement => el !== null);
    expect(bars).toHaveLength(1);
    expect(within(bars[0]).queryByRole("button", { hidden: true })).not.toBeInTheDocument();
  });

  it("opens straight onto a made-to-order size from a ?variant= link", () => {
    mount(product([IN_STOCK, MADE_TO_ORDER], "v-100"), "v-50");
    expect(addToCart()).not.toBeInTheDocument();
    expect(panelInquiry()).toBeInTheDocument();
  });
});

describe("ProductDetailView: sold out", () => {
  it("shows Agotado with no cart and no inquiry", () => {
    mount(product([SOLD_OUT], "v-30"));

    expect(addToCart()).not.toBeInTheDocument();
    expect(panelInquiry()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agotado", hidden: false })).toBeDisabled();
  });

  it("a sold-out size cannot be selected from the picker", () => {
    mount(product([IN_STOCK, SOLD_OUT], "v-100"));

    expect(size(30)).toBeDisabled();
    fireEvent.click(size(30));
    expect(addToCart()).toBeInTheDocument(); // still on the in-stock bottle
  });

  it("a legacy variant with no supplier flag is sold out, never made to order", () => {
    const legacy = makeVariant({ id: "v-legacy", size_ml: 75, stock: 0 });
    mount(product([legacy], "v-legacy"));

    expect(panelInquiry()).not.toBeInTheDocument();
    expect(addToCart()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agotado", hidden: false })).toBeDisabled();
  });

  it("decants: a drained pool is sold out whatever the supplier flag says", () => {
    const decant = makeVariant({
      id: "v-dec", size_ml: 5, stock: 0, product_type: "decant", supplier_available: true,
    });
    mount(product([decant], "v-dec", { decant_stock_ml: 0 }));

    expect(panelInquiry()).not.toBeInTheDocument();
    expect(addToCart()).not.toBeInTheDocument();
  });

  it("decants: a stocked pool still sells normally", () => {
    const decant = makeVariant({
      id: "v-dec", size_ml: 5, price: 4_900, stock: 0, product_type: "decant",
    });
    mount(product([decant], "v-dec", { decant_stock_ml: 50 }));

    fireEvent.click(addToCart()!);
    expect(addItem).toHaveBeenCalledWith(
      expect.objectContaining({ variant_id: "v-dec", product_type: "decant", stock: 10 })
    );
  });
});
