import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductCardData, ProductCardVariant } from "@/types/product";
import type { VariantPricing } from "@/lib/pricing/wholesale";

const h = vi.hoisted(() => ({
  addItem: vi.fn(),
  wholesale: {
    eligible: false,
    pricingMap: {} as Record<string, unknown>,
  },
}));
vi.mock("@/hooks/useCart", () => ({ useAddToCart: () => h.addItem }));
vi.mock("@/components/catalog/CatalogWholesaleContext", () => ({
  useCatalogWholesale: () => h.wholesale,
}));

import ProductCard from "./ProductCard";

// ── fixtures ────────────────────────────────────────────────────────────────

const bottle = (o: Partial<ProductCardVariant> = {}): ProductCardVariant => ({
  id: "bottle",
  price: 21_000,
  offer_price: null,
  is_on_offer: false,
  stock: 12,
  size_ml: 100,
  product_type: "full_size",
  sku: "KRV-0042",
  supplier_available: false,
  ...o,
});

const decant = (
  size: number,
  price: number,
  o: Partial<ProductCardVariant> = {}
): ProductCardVariant => ({
  id: `decant-${size}`,
  price,
  offer_price: null,
  is_on_offer: false,
  stock: 0,
  size_ml: size,
  product_type: "decant",
  sku: `DEC-${size}`,
  supplier_available: false,
  ...o,
});

const DECANTS = [decant(3, 1_900), decant(5, 2_900), decant(10, 4_900)];

function card(
  variants: ProductCardVariant[],
  over: Partial<ProductCardData> = {}
): ProductCardData {
  return {
    id: "p1",
    name: "Lion",
    slug: "lion",
    gender: "masculine",
    concentration: "EDP",
    brands: { name: "Rayhaan" },
    decant_stock_ml: 0,
    featured_variant: variants[0] ?? null,
    variants,
    product_images: [{ url: "/placeholder.png", position: 0 }],
    ...over,
  };
}

const ADD = /Agregar Lion al carrito/;
const WHATSAPP = "Consultar disponibilidad de Lion por WhatsApp";
const PICK_DECANT = "Elegir un decant de Lion";

const INVENTORY_BADGES = /^(Últimas unidades|Por encargo|Solo en decants|Agotado)$/;
const inventoryBadges = () => screen.queryAllByText(INVENTORY_BADGES);

/** The overlay holding the two badge corners (availability left, discount right). */
const badgeRow = () =>
  document.querySelector<HTMLElement>(".pointer-events-none.absolute.inset-x-0.top-0");

/** The text of the link the WhatsApp control opens, decoded. */
const inquiryText = (link: HTMLElement) =>
  new URL(link.getAttribute("href")!).searchParams.get("text") ?? "";

beforeEach(() => {
  h.addItem.mockClear();
  h.wholesale.eligible = false;
  h.wholesale.pricingMap = {};
});

// ═════════════════════════════════════════════════════════════════════════════
describe("normal availability: own bottle in stock", () => {
  it("shows NO inventory badge, the bottle presentation and the + control", () => {
    render(<ProductCard product={card([bottle()])} />);

    expect(inventoryBadges()).toHaveLength(0);
    // Not merely "none of the four known labels": the badge row is EMPTY, so no
    // fifth label (e.g. a "Disponible") can creep in either.
    expect(badgeRow()).toBeEmptyDOMElement();
    expect(screen.getByText("Botella · 100 ml")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADD })).toBeEnabled();
  });

  it("quick-adds the bottle with its real stock and price", () => {
    render(<ProductCard product={card([bottle()])} />);

    fireEvent.click(screen.getByRole("button", { name: ADD }));

    expect(h.addItem).toHaveBeenCalledTimes(1);
    expect(h.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        variant_id: "bottle",
        product_name: "Lion",
        product_type: "full_size",
        size_ml: 100,
        price: 21_000,
        stock: 12,
      })
    );
  });

  it("supplier availability and decants do not change a stocked bottle at all", () => {
    render(
      <ProductCard
        product={card([bottle({ supplier_available: true }), ...DECANTS], { decant_stock_ml: 50 })}
      />
    );

    expect(inventoryBadges()).toHaveLength(0);
    expect(badgeRow()).toBeEmptyDOMElement();
    expect(screen.queryByText("También disponible en decants")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: WHATSAPP })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: PICK_DECANT })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ADD }));
    expect(h.addItem).toHaveBeenCalledTimes(1);
  });

  it("low stock is just 'in stock': NO badge, no count, and the + control is live", () => {
    render(
      <ProductCard
        product={card([bottle({ stock: 2, supplier_available: true }), ...DECANTS], {
          decant_stock_ml: 50,
        })}
      />
    );

    expect(inventoryBadges()).toHaveLength(0);
    expect(badgeRow()).toBeEmptyDOMElement();
    expect(screen.queryByText(/últimas|unidades|quedan|disponibles:/i)).not.toBeInTheDocument();
    expect(screen.getByText("Botella · 100 ml")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADD })).toBeEnabled();
    expect(screen.queryByRole("link", { name: WHATSAPP })).not.toBeInTheDocument();
  });

  it("looks the same at every stock level, and still adds with the REAL stock", () => {
    // The resolver still tells low stock from plenty (cardState.test.ts owns the
    // threshold); the card must draw no difference between them, and the units
    // handed to the cart must stay the true figure — stock validation is untouched.
    for (const stock of [1, 5, 6, 40]) {
      h.addItem.mockClear();
      const { unmount } = render(<ProductCard product={card([bottle({ stock })])} />);

      expect(inventoryBadges(), `stock ${stock}`).toHaveLength(0);
      expect(badgeRow(), `stock ${stock}`).toBeEmptyDOMElement();

      fireEvent.click(screen.getByRole("button", { name: ADD }));
      expect(h.addItem, `stock ${stock}`).toHaveBeenCalledWith(
        expect.objectContaining({ variant_id: "bottle", stock })
      );
      unmount();
    }
  });

  it("adds the bottle KROV actually holds when the featured size is out of stock", () => {
    const featured = bottle({ id: "b100", stock: 0 });
    const small = bottle({ id: "b50", size_ml: 50, price: 12_000, stock: 9 });
    render(<ProductCard product={card([featured, small], { featured_variant: featured })} />);

    expect(screen.getByText("Botella · 50 ml")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ADD }));
    expect(h.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ variant_id: "b50", size_ml: 50, price: 12_000 })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("POR ENCARGO: no own stock, the supplier can provide the bottle", () => {
  const madeToOrder = (extra: ProductCardVariant[] = [], pool = 0) =>
    card([bottle({ stock: 0, supplier_available: true }), ...extra], { decant_stock_ml: pool });

  it("shows the single badge and states it in the presentation line", () => {
    render(<ProductCard product={madeToOrder()} />);

    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Por encargo"]);
    expect(screen.getByText("Botella · 100 ml · Por encargo")).toBeInTheDocument();
    expect(screen.queryByText("También disponible en decants")).not.toBeInTheDocument();
  });

  it("wraps the presentation line between segments, never inside 'Por encargo' or '100 ml'", () => {
    render(<ProductCard product={madeToOrder()} />);

    const line = screen.getByText("Botella · 100 ml · Por encargo").textContent!;
    expect(line).toContain("Por\u00a0encargo");
    expect(line).toContain("100\u00a0ml");
    // The only breakable spaces are the ones around the "·" separators.
    expect(line.split(" ")).toEqual(["Botella", "·", "100\u00a0ml", "·", "Por\u00a0encargo"]);
  });

  it("the corner control is the WhatsApp contact link - not +, and not the cart", () => {
    render(<ProductCard product={madeToOrder()} />);

    const link = screen.getByRole("link", { name: WHATSAPP });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/50671434066\?text=/);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // The project's own WhatsApp glyph, decorative (the link carries the label).
    const icon = within(link).getByRole("presentation", { hidden: true });
    expect(icon.getAttribute("src")).toContain("whatsapp.svg");
    expect(screen.queryByRole("button", { name: ADD })).not.toBeInTheDocument();
  });

  it("the inquiry describes the bottle and its published price", () => {
    render(<ProductCard product={madeToOrder()} />);
    const text = inquiryText(screen.getByRole("link", { name: WHATSAPP }));

    expect(text).toContain("Producto: Rayhaan Lion");
    expect(text).toContain("Presentación: 100 ml");
    expect(text).toContain("Código: KRV-0042");
    expect(text).toMatch(/Precio publicado: .*21.?000/);
    expect(text).toContain("/products/lion");
  });

  it("never touches the cart, however the link is used", () => {
    render(<ProductCard product={madeToOrder()} />);
    const link = screen.getByRole("link", { name: WHATSAPP });

    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });
    expect(h.addItem).not.toHaveBeenCalled();
  });

  it("WITH decants: still ONE badge and ONE control; the decants are a quiet secondary line", () => {
    render(<ProductCard product={madeToOrder(DECANTS, 50)} />);

    // POR ENCARGO takes precedence over SOLO EN DECANTS...
    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Por encargo"]);
    expect(screen.queryByText("Solo en decants")).not.toBeInTheDocument();
    // ...the bottle stays the presentation...
    expect(screen.getByText("Botella · 100 ml · Por encargo")).toBeInTheDocument();
    // ...the decants are mentioned, not promoted...
    expect(screen.getByText("También disponible en decants")).toBeInTheDocument();
    // ...and there is exactly one corner control, and it is WhatsApp.
    expect(screen.getByRole("link", { name: WHATSAPP })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: PICK_DECANT })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Agregar|Sin stock/ })).not.toBeInTheDocument();
  });

  it("the secondary line needs REAL decant stock, not just decant variants", () => {
    render(<ProductCard product={madeToOrder(DECANTS, 0)} />);
    expect(screen.queryByText("También disponible en decants")).not.toBeInTheDocument();
  });

  it("is never shown as a wholesale sale, whatever the buyer's tier", () => {
    h.wholesale.eligible = true;
    h.wholesale.pricingMap = { bottle: wholesalePricing() };
    render(<ProductCard product={madeToOrder()} />);

    expect(screen.queryByText(/uds\./)).not.toBeInTheDocument();
    expect(screen.getByText(/21.?000/)).toBeInTheDocument();
  });

  it("omits message lines for data it lacks (legacy payload without a SKU)", () => {
    render(
      <ProductCard product={card([bottle({ stock: 0, supplier_available: true, sku: undefined })])} />
    );
    const text = inquiryText(screen.getByRole("link", { name: WHATSAPP }));
    expect(text).not.toContain("Código");
    expect(text).not.toMatch(/undefined|null/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("SOLO EN DECANTS: no bottle by any route, decants in stock", () => {
  const decantsOnly = (decants = DECANTS, pool = 50, bottleOver: Partial<ProductCardVariant> = {}) =>
    card([bottle({ stock: 0, supplier_available: false, ...bottleOver }), ...decants], {
      decant_stock_ml: pool,
    });

  it("shows SOLO EN DECANTS - never AGOTADO - and the decants, not the dead bottle", () => {
    render(<ProductCard product={decantsOnly()} />);

    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Solo en decants"]);
    expect(screen.queryByText("Agotado")).not.toBeInTheDocument();
    expect(screen.getByText("Decants disponibles · Desde 3 ml")).toBeInTheDocument();
    expect(screen.queryByText(/Botella/)).not.toBeInTheDocument();
  });

  it("prices from the cheapest purchasable decant, with 'Desde'", () => {
    render(<ProductCard product={decantsOnly()} />);

    expect(screen.getByText(/Desde/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/1.?900/)).toBeInTheDocument();
    // The bottle's price is NOT the price on show.
    expect(screen.queryByText(/21.?000/)).not.toBeInTheDocument();
  });

  it("only counts sizes the pool can actually fill", () => {
    // pool 4 ml: only the 3 ml decant fits.
    render(<ProductCard product={decantsOnly(DECANTS, 4)} />);

    expect(screen.getByText("Decant · 3 ml")).toBeInTheDocument(); // a single size: no "Desde"
    expect(screen.queryByText(/Desde/, { selector: "span" })).not.toBeInTheDocument();
  });

  it("the control is the existing + , leading to the size picker with the starting decant preselected", () => {
    render(<ProductCard product={decantsOnly()} />);

    const link = screen.getByRole("link", { name: PICK_DECANT });
    expect(link).toHaveAttribute("href", "/products/lion?variant=decant-3");
    expect(screen.queryByRole("link", { name: WHATSAPP })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ADD })).not.toBeInTheDocument();
  });

  it("does not add anything to the cart from the card", () => {
    render(<ProductCard product={decantsOnly()} />);
    fireEvent.click(screen.getByRole("link", { name: PICK_DECANT }));
    expect(h.addItem).not.toHaveBeenCalled();
  });

  it("is chosen only when the SUPPLIER cannot provide the bottle (precedence)", () => {
    render(<ProductCard product={decantsOnly(DECANTS, 50, { supplier_available: true })} />);
    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Por encargo"]);
  });

  it("a product sold only as decants reads the same way", () => {
    render(<ProductCard product={card(DECANTS, { decant_stock_ml: 50 })} />);
    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Solo en decants"]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("AGOTADO: genuinely nothing to buy or ask", () => {
  it("shows the badge, a disabled control, and no way in", () => {
    render(<ProductCard product={card([bottle({ stock: 0 })])} />);

    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Agotado"]);
    const control = screen.getByRole("button", { name: "Sin stock" });
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(h.addItem).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: WHATSAPP })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: PICK_DECANT })).not.toBeInTheDocument();
  });

  it("still lets the customer open the product page", () => {
    render(<ProductCard product={card([bottle({ stock: 0 })])} />);
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/products/lion");
  });

  it.each([
    ["null", null],
    ["missing", undefined],
  ])("an unverified supplier flag (%s) is sold out, not made to order", (_l, flag) => {
    render(<ProductCard product={card([bottle({ stock: 0, supplier_available: flag })])} />);
    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Agotado"]);
    expect(screen.queryByRole("link", { name: WHATSAPP })).not.toBeInTheDocument();
  });

  it("decants that exist but cannot be poured do not rescue the card", () => {
    render(<ProductCard product={card([bottle({ stock: 0 }), ...DECANTS], { decant_stock_ml: 2 })} />);
    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Agotado"]);
  });

  it("advertises no promotion on something nobody can buy", () => {
    render(
      <ProductCard
        product={card([bottle({ stock: 0, is_on_offer: true, offer_price: 15_000 })])}
      />
    );
    expect(screen.queryByText(/^-\d+%$/)).not.toBeInTheDocument();
    expect(document.querySelector(".line-through")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("discounts: top-right, real, and about the variant on show", () => {
  const onOffer = (o: Partial<ProductCardVariant> = {}) =>
    bottle({ is_on_offer: true, offer_price: 17_500, ...o });

  it("shows -N% top-right, the current price prominent and the original struck", () => {
    render(<ProductCard product={card([onOffer()])} />);

    expect(screen.getByText("-17%")).toBeInTheDocument();
    const current = screen.getByText(/17.?500/);
    const original = screen.getByText(/21.?000/);
    expect(original).toHaveClass("line-through");
    expect(current).not.toHaveClass("line-through");
    // Prominent vs muted: the current price is the larger of the two.
    expect(current.className).toContain("text-[17px]");
    expect(original.className).toContain("text-[12px]");
  });

  it("there is no OFERTA badge any more", () => {
    render(<ProductCard product={card([onOffer()])} />);
    expect(screen.queryByText(/oferta/i)).not.toBeInTheDocument();
  });

  it("is readable to assistive tech as '17% de descuento'", () => {
    render(<ProductCard product={card([onOffer()])} />);
    expect(screen.getByText("17% de descuento")).toBeInTheDocument();
  });

  it("sits beside the availability badge in its own corner, never stacked with it", () => {
    render(
      <ProductCard product={card([onOffer({ stock: 0, supplier_available: true })])} />
    );

    expect(inventoryBadges().map((n) => n.textContent)).toEqual(["Por encargo"]);
    const discount = screen.getByText("-17%").parentElement!;
    const availability = screen.getByText("Por encargo", { selector: "span" });
    expect(discount).not.toContainElement(availability);
    expect(availability.parentElement).toBe(discount.parentElement); // one row: left | right
    expect(discount.className).toContain("ml-auto"); // pinned right even with no left badge
    expect(availability.className).toContain("min-w-0"); // yields width (wraps) before colliding
  });

  it("with no availability badge the discount still sits top-right", () => {
    render(<ProductCard product={card([onOffer()])} />);
    expect(screen.getByText("-17%").parentElement!.className).toContain("ml-auto");
  });

  it("a discounted made-to-order bottle keeps WhatsApp and shows its discount", () => {
    render(
      <ProductCard product={card([onOffer({ stock: 0, supplier_available: true })])} />
    );
    expect(screen.getByText("-17%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: WHATSAPP })).toBeInTheDocument();
    expect(inquiryText(screen.getByRole("link", { name: WHATSAPP }))).toMatch(/17.?500/);
  });

  it("decants only: the discount is the DECANT's, and the bottle's is ignored", () => {
    render(
      <ProductCard
        product={card(
          [
            bottle({ stock: 0, is_on_offer: true, offer_price: 10_000 }),
            decant(5, 2_500, { is_on_offer: true, offer_price: 1_900 }),
          ],
          { decant_stock_ml: 50 }
        )}
      />
    );

    expect(screen.getByText("-24%")).toBeInTheDocument();
    expect(screen.getByText(/1.?900/)).toBeInTheDocument();
    expect(screen.getByText(/2.?500/)).toHaveClass("line-through");
    expect(screen.queryByText(/10.?000/)).not.toBeInTheDocument();
  });

  it("decants only, only the BOTTLE discounted: no discount badge at all", () => {
    render(
      <ProductCard
        product={card(
          [bottle({ stock: 0, is_on_offer: true, offer_price: 10_000 }), decant(5, 2_500)],
          { decant_stock_ml: 50 }
        )}
      />
    );
    expect(screen.queryByText(/^-\d+%$/)).not.toBeInTheDocument();
  });

  it.each([
    ["offer equal to list", 21_000],
    ["offer above list", 25_000],
  ])("%s is charged as configured but never advertised as a saving", (_l, offer) => {
    render(<ProductCard product={card([onOffer({ offer_price: offer })])} />);
    expect(screen.queryByText(/^-\d+%$/)).not.toBeInTheDocument();
    expect(document.querySelector(".line-through")).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("pricing that is missing or invalid", () => {
  it.each([0, -3, Number.NaN, null, undefined])(
    "price %s: no number, no NaN, no discount, and the card does not crash",
    (price) => {
      render(<ProductCard product={card([bottle({ price: price as unknown as number })])} />);

      expect(screen.getByText("Precio no disponible")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
      expect(screen.queryByText(/^-\d+%$/)).not.toBeInTheDocument();
    }
  );

  it("does not quick-add a bottle at an unknown price", () => {
    render(<ProductCard product={card([bottle({ price: Number.NaN })])} />);

    const control = screen.getByRole("button", { name: "Precio no disponible" });
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(h.addItem).not.toHaveBeenCalled();
  });

  it("a made-to-order bottle can still be asked about; the message just omits the price", () => {
    render(
      <ProductCard
        product={card([bottle({ stock: 0, supplier_available: true, price: Number.NaN })])}
      />
    );
    const text = inquiryText(screen.getByRole("link", { name: WHATSAPP }));
    expect(text).not.toContain("Precio publicado");
    expect(screen.getByText("Precio no disponible")).toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("long names", () => {
  const LONG = "Odyssey Mandarin Sky Elixir Extrait de Parfum Edición Limitada";

  it("clamps at TWO lines, not one, and keeps the full name reachable", () => {
    render(<ProductCard product={card([bottle()], { name: LONG })} />);

    const link = screen.getByRole("heading", { level: 3 }).querySelector("a")!;
    expect(link.className).toContain("line-clamp-2");
    expect(link.className).not.toContain("line-clamp-1");
    expect(link).toHaveTextContent(LONG); // nothing is cut in the DOM
    expect(screen.getByRole("heading", { level: 3 })).toHaveAttribute("title", LONG);
  });

  it("reserves two lines for every name, so a short name leaves the same rhythm", () => {
    render(<ProductCard product={card([bottle()], { name: "Yara" })} />);
    const link = screen.getByRole("heading", { level: 3 }).querySelector("a")!;
    expect(link.className).toContain("min-h-[2.4em]");
  });

  it("uses the editorial serif at the 18px reading size", () => {
    render(<ProductCard product={card([bottle()])} />);
    const heading = screen.getByRole("heading", { level: 3 });
    expect(heading.className).toContain("text-[18px]");
    expect(heading.getAttribute("style")).toContain("font-krov-display");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("one availability badge, ever", () => {
  const states: Array<[string, ProductCardData]> = [
    ["available", card([bottle()])],
    ["low stock", card([bottle({ stock: 1 })])],
    ["made to order", card([bottle({ stock: 0, supplier_available: true })])],
    ["made to order + decants", card([bottle({ stock: 0, supplier_available: true }), ...DECANTS], { decant_stock_ml: 50 })],
    ["decants only", card([bottle({ stock: 0 }), ...DECANTS], { decant_stock_ml: 50 })],
    ["sold out", card([bottle({ stock: 0 })])],
    ["discounted + low stock", card([bottle({ stock: 1, is_on_offer: true, offer_price: 15_000 })])],
    ["discounted + made to order", card([bottle({ stock: 0, supplier_available: true, is_on_offer: true, offer_price: 15_000 })])],
    ["featured decant, stocked pool", card([decant(5, 2_900)], { decant_stock_ml: 50 })],
  ];

  it.each(states)("%s: at most one availability badge, and no 'Oferta' / 'Decant' tag", (_label, product) => {
    render(<ProductCard product={product} />);

    expect(inventoryBadges().length).toBeLessThanOrEqual(1);
    expect(screen.queryByText(/^oferta$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^decant$/i)).not.toBeInTheDocument();
  });

  it.each(states)("%s: at most one corner control", (_label, product) => {
    render(<ProductCard product={product} />);

    const corner = [
      ...screen.queryAllByRole("button", { name: /Agregar|Sin stock|Precio no disponible/ }),
      ...screen.queryAllByRole("link", { name: /Consultar disponibilidad|Elegir un decant/ }),
    ];
    expect(corner.length).toBeLessThanOrEqual(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("wholesale pricing", () => {
  it("still shows an approved buyer their price on a normal, stocked bottle", () => {
    h.wholesale.eligible = true;
    h.wholesale.pricingMap = { bottle: wholesalePricing() };
    render(<ProductCard product={card([bottle()])} />);

    expect(screen.getByText(/15.?000/)).toBeInTheDocument();
    expect(screen.getByText(/21.?000/)).toHaveClass("line-through");
    expect(screen.getByText("Desde 3 uds.")).toBeInTheDocument();
  });

  it("retail visitors never see it", () => {
    h.wholesale.eligible = false;
    h.wholesale.pricingMap = { bottle: wholesalePricing() };
    render(<ProductCard product={card([bottle()])} />);

    expect(screen.queryByText(/15.?000/)).not.toBeInTheDocument();
  });

  it("is not shown on a decants-only card (the price on show is the decant's)", () => {
    h.wholesale.eligible = true;
    h.wholesale.pricingMap = { bottle: wholesalePricing() };
    render(<ProductCard product={card([bottle({ stock: 0 }), ...DECANTS], { decant_stock_ml: 50 })} />);

    expect(screen.queryByText(/15.?000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/uds\./)).not.toBeInTheDocument();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("shared behavior", () => {
  it("links the image and title to the product page in every state", () => {
    for (const variants of [
      [bottle()],
      [bottle({ stock: 0, supplier_available: true })],
      [bottle({ stock: 0 }), ...DECANTS],
      [bottle({ stock: 0 })],
    ]) {
      const { unmount } = render(<ProductCard product={card(variants, { decant_stock_ml: 50 })} />);
      const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
      expect(hrefs).toContain("/products/lion");
      unmount();
    }
  });

  it("renders nothing for a product with no commercial variant", () => {
    const { container } = render(
      <ProductCard product={card([], { featured_variant: null })} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("still works from a payload that carries only the featured variant", () => {
    render(<ProductCard product={card([bottle()], { variants: undefined })} />);
    expect(screen.getByText("Botella · 100 ml")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ADD })).toBeEnabled();
  });
});

function wholesalePricing(): VariantPricing {
  return {
    price: 21_000,
    offer_price: null,
    is_on_offer: false,
    is_wholesale_enabled: true,
    wholesale_price: 15_000,
    min_wholesale_quantity: 3,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Mobile scroll cost. These pin the rendering decisions that made the catalog
// stutter on phones, so a later restyle cannot quietly bring them back.
describe("rendering cost (mobile catalog)", () => {
  const everyState = () => [
    [bottle()],
    [bottle({ stock: 2 })],
    [bottle({ stock: 0, supplier_available: true })],
    [bottle({ stock: 0 }), ...DECANTS],
    [bottle({ stock: 0 })],
  ];

  it("no element in any state uses a backdrop filter (one compositor pass per badge)", () => {
    for (const variants of everyState()) {
      const { container, unmount } = render(
        <ProductCard product={card(variants, { decant_stock_ml: 50 })} />
      );
      expect(container.querySelector('[class*="backdrop"]')).toBeNull();
      unmount();
    }
  });

  it("the photograph paints on its own: no load-state fade, no skeleton pulse", () => {
    const { container } = render(<ProductCard product={card([bottle()])} />);

    expect(container.querySelector(".animate-pulse")).toBeNull();
    const img = container.querySelector("img")!;
    expect(img.className).not.toContain("opacity-0");
    // Only transforms animate on the image, and never `transition-all`.
    expect(img.className).toContain("transition-transform");
    expect(container.innerHTML).not.toContain("transition-all");
  });

  it("asks for the width the photograph is drawn at, not the whole column", () => {
    const { container } = render(<ProductCard product={card([bottle()])} />);
    const sizes = container.querySelector("img")!.getAttribute("sizes")!;

    // Two columns on a phone: (50vw column) - (56px of plate padding) - gutters.
    expect(sizes).toContain("(max-width: 639px) calc(50vw - 84px)");
    // The widest case is a fixed pixel size, so a big monitor does not ask for 25vw of 2560.
    expect(sizes.endsWith("230px")).toBe(true);
  });

  it("hides the corner control until hover ONLY where hover exists", () => {
    render(<ProductCard product={card([bottle()])} />);
    const cls = screen.getByRole("button", { name: ADD }).className;

    // The bare `sm:opacity-0` hid the add button from touch tablets (>= 640px).
    expect(cls).not.toMatch(/(^|\s)sm:opacity-0(\s|$)/);
    expect(cls).toContain("[@media(hover:hover)_and_(min-width:40rem)]:opacity-0");
    expect(cls).toContain("sm:group-hover:opacity-100");
    expect(cls).not.toContain("transition-all");
  });

  it("the 'added' confirmation stays visible (it must beat the hover-hidden state)", () => {
    render(<ProductCard product={card([bottle()])} />);
    fireEvent.click(screen.getByRole("button", { name: ADD }));
    expect(screen.getByRole("button", { name: ADD }).className).toContain("opacity-100!");
  });
});
