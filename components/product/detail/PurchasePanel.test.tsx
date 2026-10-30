import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeProduct, makeVariant } from "@/test/helpers/seoFixtures";
import { resolveAvailability } from "@/lib/stock";
import type { VariantPricing } from "@/lib/pricing/wholesale";
import type { ProductVariant } from "@/types/product";
import PurchasePanel from "./PurchasePanel";

const INQUIRY_URL = "https://wa.me/50671434066?text=Hola";

const WHOLESALE: VariantPricing = {
  price: 21_000,
  offer_price: null,
  is_on_offer: false,
  is_wholesale_enabled: true,
  wholesale_price: 15_000,
  min_wholesale_quantity: 3,
};

function setup(
  opts: {
    variant?: Partial<ProductVariant>;
    poolMl?: number;
    inquiryUrl?: string | null;
    wholesale?: boolean;
  } = {}
) {
  const variant = makeVariant({
    id: "sel",
    size_ml: 100,
    stock: 0,
    supplier_available: false,
    sku: "KRV-0042",
    ...opts.variant,
  });
  const product = makeProduct({
    product_variants: [variant],
    decant_stock_ml: opts.poolMl ?? 0,
  });
  const availability = resolveAvailability(variant, product.decant_stock_ml);
  const handlers = {
    onSelectVariant: vi.fn(),
    onIncrement: vi.fn(),
    onDecrement: vi.fn(),
    onSetQuantity: vi.fn(),
    onAddToCart: vi.fn(),
  };

  render(
    <PurchasePanel
      product={product}
      selectedVariant={variant}
      variants={[variant]}
      quantity={1}
      effectivePrice={21_000}
      hasOffer={false}
      availability={availability}
      inquiryUrl={opts.inquiryUrl ?? null}
      availableStock={availability.units}
      wholesaleEligible={!!opts.wholesale}
      wholesalePricing={opts.wholesale ? WHOLESALE : undefined}
      {...handlers}
    />
  );
  return handlers;
}

const addToCart = () => screen.queryByRole("button", { name: "Agregar al carrito" });
const inquiry = () => screen.queryByRole("link", { name: /Consultar disponibilidad/ });

describe("PurchasePanel: in stock", () => {
  it("offers the normal purchase flow", () => {
    const { onAddToCart } = setup({ variant: { stock: 10 } });

    expect(screen.getByText("En existencia")).toBeInTheDocument();
    expect(screen.getByText("Cantidad")).toBeInTheDocument();
    expect(inquiry()).not.toBeInTheDocument();
    expect(screen.queryByText(/Antes de finalizar tu compra/)).not.toBeInTheDocument();

    fireEvent.click(addToCart()!);
    expect(onAddToCart).toHaveBeenCalledTimes(1);
  });

  it("still shows wholesale pricing to an eligible buyer", () => {
    setup({ variant: { stock: 10 }, wholesale: true });
    expect(screen.getByText("Tu precio mayorista")).toBeInTheDocument();
  });

  it("an in-stock variant that is also flagged supplier_available is a normal sale", () => {
    setup({ variant: { stock: 10, supplier_available: true }, inquiryUrl: null });

    expect(addToCart()).toBeEnabled();
    expect(inquiry()).not.toBeInTheDocument();
    expect(screen.queryByText("Por encargo", { selector: "span" })).not.toBeInTheDocument();
  });
});

describe("PurchasePanel: made to order", () => {
  const madeToOrder = { variant: { stock: 0, supplier_available: true }, inquiryUrl: INQUIRY_URL };

  it("replaces add-to-cart with the WhatsApp inquiry", () => {
    const { onAddToCart } = setup(madeToOrder);

    expect(addToCart()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agotado|Sin stock/ })).not.toBeInTheDocument();

    const link = inquiry()!;
    expect(link).toHaveAttribute("href", INQUIRY_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");

    fireEvent.click(link);
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it("labels the state and tells the customer availability is confirmed first", () => {
    setup(madeToOrder);

    // The badge, and the notice heading.
    expect(screen.getAllByText("Por encargo").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Antes de finalizar tu compra confirmamos por WhatsApp si sigue disponible y cuál sería el plazo de entrega/)
    ).toBeInTheDocument();
  });

  it("does not claim a message was sent", () => {
    setup(madeToOrder);
    expect(
      screen.getByText("Se abrirá WhatsApp con el mensaje listo para que lo envíes.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/enviado|enviamos tu/i)).not.toBeInTheDocument();
  });

  it("has no quantity stepper and no wholesale tier, even for an eligible buyer", () => {
    setup({ ...madeToOrder, wholesale: true });

    expect(screen.queryByText("Cantidad")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aumentar cantidad" })).not.toBeInTheDocument();
    expect(screen.queryByText("Tu precio mayorista")).not.toBeInTheDocument();
    expect(screen.queryByText(/mínimo mayorista/)).not.toBeInTheDocument();
  });

  it("with no inquiry link there is NO action at all - never a fallback to the cart", () => {
    setup({ variant: madeToOrder.variant, inquiryUrl: null });

    expect(inquiry()).not.toBeInTheDocument();
    expect(addToCart()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agregar|Agotado/ })).not.toBeInTheDocument();
  });
});

describe("PurchasePanel: sold out", () => {
  it("shows Agotado, a disabled button, and no inquiry", () => {
    const { onAddToCart } = setup({ variant: { stock: 0, supplier_available: false } });

    expect(screen.getAllByText("Agotado").length).toBeGreaterThanOrEqual(1);
    const button = screen.getByRole("button", { name: "Agotado" });
    expect(button).toBeDisabled();
    expect(inquiry()).not.toBeInTheDocument();
    expect(screen.queryByText(/Antes de finalizar tu compra/)).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it("a variant with no supplier flag at all is sold out, not made to order", () => {
    setup({ variant: { stock: 0, supplier_available: undefined }, inquiryUrl: INQUIRY_URL });

    // Even if a caller wrongly passes a link, the panel keys off availability.
    expect(inquiry()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agotado" })).toBeDisabled();
  });

  it("a drained decant flagged supplier_available stays sold out", () => {
    setup({
      variant: { product_type: "decant", size_ml: 5, stock: 0, supplier_available: true },
      poolMl: 0,
      inquiryUrl: INQUIRY_URL,
    });

    expect(inquiry()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agotado" })).toBeDisabled();
  });
});
