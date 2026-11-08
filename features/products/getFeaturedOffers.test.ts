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

  it("includes in-stock offers as in_stock", () => {
    expect(toFeaturedOffers([row()])[0].availability).toBe("in_stock");
    // Physical stock wins even when the supplier also has it.
    expect(toFeaturedOffers([row({ supplier_available: true })])[0].availability).toBe(
      "in_stock"
    );
  });

  it("includes supplier-confirmed offers with no local stock as made_to_order", () => {
    const [offer] = toFeaturedOffers([row({ stock: 0, supplier_available: true })]);
    expect(offer).toMatchObject({
      availability: "made_to_order",
      // Routed to the product page (the WhatsApp inquiry lives there), with the
      // same discount presentation as any other offer.
      href: "/products/khamrah?variant=v1",
      discountPercent: 20,
      offerPrice: 40000,
      price: 50000,
    });
  });

  it("excludes sold-out offers (no stock, supplier not confirmed)", () => {
    expect(toFeaturedOffers([row({ stock: 0 })])).toEqual([]);
    expect(toFeaturedOffers([row({ stock: 0, supplier_available: false })])).toEqual([]);
    // Fail-closed: an unverified / missing flag is not "available".
    expect(toFeaturedOffers([row({ stock: 0, supplier_available: null })])).toEqual([]);
  });

  it("derives decant availability from the pool and never makes a decant made-to-order", () => {
    const decant = { product_type: "decant" as const, size_ml: 10, stock: 0 };
    expect(toFeaturedOffers([row(decant, { decant_stock_ml: 5 })])).toEqual([]);
    expect(toFeaturedOffers([row(decant, { decant_stock_ml: 30 })])).toHaveLength(1);
    expect(
      toFeaturedOffers([row({ ...decant, supplier_available: true }, { decant_stock_ml: 0 })])
    ).toEqual([]);
  });

  it("skips rows whose parent product was not returned", () => {
    expect(toFeaturedOffers([row({ product: null })])).toEqual([]);
  });

  it("keeps one slide per product — its biggest saving", () => {
    const offers = toFeaturedOffers([
      row({ id: "a-small", offer_price: 45000 }),
      row({ id: "b" }, { id: "p2", name: "B", slug: "b" }),
      row({ id: "a-big", offer_price: 30000 }),
    ]);
    expect(offers.map((o) => o.variantId)).toEqual(["a-big", "b"]);
    expect(new Set(offers.map((o) => o.productId)).size).toBe(offers.length);
  });

  it("ranks slides by discount percentage, biggest first", () => {
    const offers = toFeaturedOffers([
      row({ id: "v10", offer_price: 45000 }, { id: "p10", name: "Diez" }), // 10%
      row({ id: "v40", offer_price: 30000 }, { id: "p40", name: "Cuarenta" }), // 40%
      row({ id: "v20", offer_price: 40000 }, { id: "p20", name: "Veinte" }), // 20%
    ]);
    expect(offers.map((o) => o.discountPercent)).toEqual([40, 20, 10]);
  });

  it("compares the saving exactly, not by its rounded label", () => {
    // 20.4% and 20.0% both read "20%"; the larger real saving still leads.
    const offers = toFeaturedOffers([
      row({ id: "a", price: 25000, offer_price: 20000 }, { id: "pa", name: "A" }), // 20.0%
      row({ id: "b", price: 50000, offer_price: 39800 }, { id: "pb", name: "B" }), // 20.4%
    ]);
    expect(offers.map((o) => o.variantId)).toEqual(["b", "a"]);
  });

  it("is deterministic on equal discounts, whatever the row order", () => {
    // 20 000 → 16 000 and 50 000 → 40 000 are both exactly 20%.
    const rows = [
      row({ id: "vz", price: 20000, offer_price: 16000 }, { id: "pz", name: "Zafiro" }),
      row({ id: "va", price: 50000, offer_price: 40000 }, { id: "pa", name: "Ámbar" }),
      row({ id: "vm", price: 50000, offer_price: 40000, stock: 0, supplier_available: true }, { id: "pm", name: "Aaa" }),
    ];
    const expected = ["va", "vz", "vm"]; // in-stock first, then name (es): Ámbar < Zafiro
    expect(toFeaturedOffers(rows).map((o) => o.variantId)).toEqual(expected);
    expect(toFeaturedOffers([...rows].reverse()).map((o) => o.variantId)).toEqual(expected);
  });

  it("picks a product's variant deterministically when several tie", () => {
    const rows = [
      row({ id: "v-made", stock: 0, supplier_available: true }),
      row({ id: "v-stock" }),
    ];
    // Equal saving: the one KROV can ship today represents the product.
    expect(toFeaturedOffers(rows).map((o) => o.variantId)).toEqual(["v-stock"]);
    expect(toFeaturedOffers([...rows].reverse()).map((o) => o.variantId)).toEqual(["v-stock"]);
  });

  it("does not let a sold-out variant displace a product's obtainable one", () => {
    const offers = toFeaturedOffers([
      row({ id: "v-sold-out", offer_price: 10000, stock: 0 }),
      row({ id: "v-ok", offer_price: 45000 }),
    ]);
    expect(offers.map((o) => o.variantId)).toEqual(["v-ok"]);
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
