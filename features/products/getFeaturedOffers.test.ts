import { describe, expect, it, vi } from "vitest";

// The transform is pure; the client is mocked only so importing the module
// doesn't try to build a real Supabase client.
vi.mock("@/lib/supabase/client", () => ({ supabase: {} }));

import {
  discountPercent,
  toFeaturedOffers,
  type OfferVariantRow,
} from "./getFeaturedOffers";

function row(overrides: Partial<OfferVariantRow> = {}, productOverrides = {}): OfferVariantRow {
  return {
    id: "v1",
    price: 50000,
    offer_price: 40000,
    is_on_offer: true,
    stock: 3,
    size_ml: 100,
    product_type: "full_size",
    product: {
      id: "p1",
      name: "Khamrah",
      slug: "khamrah",
      description: "  Dulce y especiado.  ",
      decant_stock_ml: 0,
      brands: { name: "Lattafa" },
      product_images: [
        { url: "https://x/p-2.webp", position: 2, alt_text: null, variant_id: null },
        { url: "https://x/p-1.webp", position: 1, alt_text: null, variant_id: null },
      ],
      ...productOverrides,
    },
    ...overrides,
  };
}

describe("discountPercent", () => {
  it("rounds the saving to a whole percent", () => {
    expect(discountPercent(50000, 40000)).toBe(20);
    expect(discountPercent(30000, 19990)).toBe(33);
  });

  it("refuses to invent a figure from invalid prices", () => {
    expect(discountPercent(0, 100)).toBeNull();
    expect(discountPercent(100, 0)).toBeNull();
    expect(discountPercent(100, 100)).toBeNull();
    expect(discountPercent(100, 120)).toBeNull();
    expect(discountPercent(100000, 99900)).toBeNull(); // rounds to 0%
  });
});

describe("toFeaturedOffers", () => {
  it("maps a valid on-offer variant to a slide routed to its product + variant", () => {
    const [offer] = toFeaturedOffers([row()]);
    expect(offer).toMatchObject({
      productId: "p1",
      variantId: "v1",
      name: "Khamrah",
      brand: "Lattafa",
      description: "Dulce y especiado.",
      price: 50000,
      offerPrice: 40000,
      discountPercent: 20,
      imageUrl: "https://x/p-1.webp",
      imageAlt: "Lattafa Khamrah",
      href: "/products/khamrah?variant=v1",
    });
  });

  it("skips variants without a valid promotional price", () => {
    expect(toFeaturedOffers([row({ offer_price: null })])).toEqual([]);
    expect(toFeaturedOffers([row({ offer_price: 50000 })])).toEqual([]);
    expect(toFeaturedOffers([row({ offer_price: 60000 })])).toEqual([]);
    expect(toFeaturedOffers([row({ is_on_offer: false })])).toEqual([]);
  });

  it("skips variants that cannot be bought right now", () => {
    expect(toFeaturedOffers([row({ stock: 0 })])).toEqual([]);
    // Decants derive stock from the parent's ml pool, not the stock column.
    expect(
      toFeaturedOffers([row({ product_type: "decant", size_ml: 10, stock: 0 }, { decant_stock_ml: 5 })])
    ).toEqual([]);
    expect(
      toFeaturedOffers([row({ product_type: "decant", size_ml: 10, stock: 0 }, { decant_stock_ml: 30 })])
    ).toHaveLength(1);
  });

  it("skips rows whose parent product was not returned", () => {
    expect(toFeaturedOffers([row({ product: null })])).toEqual([]);
  });

  it("keeps one slide per product — the biggest saving — in its first position", () => {
    const offers = toFeaturedOffers([
      row({ id: "a-small", offer_price: 45000 }),
      row({ id: "b" }, { id: "p2", slug: "b" }),
      row({ id: "a-big", offer_price: 30000 }),
    ]);
    expect(offers.map((o) => o.variantId)).toEqual(["a-big", "b"]);
  });

  it("prefers the variant's own image and its alt text", () => {
    const [offer] = toFeaturedOffers([
      row({}, {
        product_images: [
          { url: "https://x/p.webp", position: 0, alt_text: null, variant_id: null },
          { url: "https://x/v1.webp", position: 5, alt_text: "Khamrah 100 ml", variant_id: "v1" },
        ],
      }),
    ]);
    expect(offer.imageUrl).toBe("https://x/v1.webp");
    expect(offer.imageAlt).toBe("Khamrah 100 ml");
  });

  it("falls back to the placeholder when the product has no images", () => {
    const [offer] = toFeaturedOffers([row({}, { product_images: [] })]);
    expect(offer.imageUrl).toBe("/placeholder.png");
  });

  it("clamps to the slide limit", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ id: `v${i}` }, { id: `p${i}`, slug: `s${i}` })
    );
    expect(toFeaturedOffers(rows, 6)).toHaveLength(6);
  });
});
