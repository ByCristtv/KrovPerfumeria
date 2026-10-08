import { describe, expect, it } from "vitest";
import { makeProduct, makeVariant } from "@/test/helpers/seoFixtures";
import {
  concentrationLabel,
  effectivePrice,
  isListableProduct,
  lowestAvailablePrice,
  productDescription,
  productDisplayName,
  productImages,
  productPath,
  productSchemaInput,
  productTitle,
  variantLabel,
} from "./product";

describe("isListableProduct", () => {
  it("rejects a missing product and one with no active variant (the page 404s both)", () => {
    expect(isListableProduct(null)).toBe(false);
    expect(isListableProduct(makeProduct({ product_variants: [] }))).toBe(false);
    expect(isListableProduct(makeProduct())).toBe(true);
  });
});

describe("productPath", () => {
  it("is the canonical /products/<slug>, with no query string", () => {
    expect(productPath("lion")).toBe("/products/lion");
  });
});

describe("concentrationLabel", () => {
  it("expands the stored abbreviations", () => {
    expect(concentrationLabel("EDP")).toBe("Eau de Parfum");
    expect(concentrationLabel("edt")).toBe("Eau de Toilette");
    expect(concentrationLabel("E.D.C")).toBe("Eau de Cologne");
  });

  it("shows anything unrecognised as stored, and empty as empty", () => {
    expect(concentrationLabel("Extrait")).toBe("Extrait");
    expect(concentrationLabel("")).toBe("");
    expect(concentrationLabel(null)).toBe("");
  });
});

describe("productTitle / productDisplayName", () => {
  it("leads with brand, then name, then concentration", () => {
    expect(productDisplayName(makeProduct())).toBe("Rayhaan Lion");
    expect(productTitle(makeProduct())).toBe("Rayhaan Lion Eau de Parfum");
  });

  it("does not repeat a brand the product name already carries", () => {
    const product = makeProduct({ name: "Rayhaan Lion Noir" });
    expect(productDisplayName(product)).toBe("Rayhaan Lion Noir");
  });

  it("does not repeat a concentration already in the name", () => {
    const product = makeProduct({ name: "Lion Eau de Parfum" });
    expect(productTitle(product)).toBe("Rayhaan Lion Eau de Parfum");
  });

  it("copes with a missing brand", () => {
    expect(productTitle(makeProduct({ brands: null }))).toBe("Lion Eau de Parfum");
  });
});

describe("effectivePrice", () => {
  it("charges the offer price only while the offer is live", () => {
    expect(effectivePrice(makeVariant({ is_on_offer: true, offer_price: 19_500 }))).toBe(19_500);
    // A lingering offer_price with the offer toggled off must not apply.
    expect(effectivePrice(makeVariant({ is_on_offer: false, offer_price: 19_500 }))).toBe(21_000);
    expect(effectivePrice(makeVariant({ is_on_offer: true, offer_price: null }))).toBe(21_000);
  });
});

describe("lowestAvailablePrice", () => {
  it("counts decants as available through the shared ml pool, not their own stock", () => {
    // Every decant has stock 0 — the pool of 100 ml is what makes them sellable.
    expect(lowestAvailablePrice(makeProduct())).toBe(1_900);
  });

  it("ignores variants that cannot be bought", () => {
    const product = makeProduct({ decant_stock_ml: 0 });
    expect(lowestAvailablePrice(product)).toBe(19_500);
  });

  it("is null when nothing is in stock", () => {
    const product = makeProduct({
      decant_stock_ml: 0,
      product_variants: [makeVariant({ stock: 0 })],
    });
    expect(lowestAvailablePrice(product)).toBeNull();
  });
});

describe("productDescription", () => {
  it("builds from the product's own text, then a live price, within 160 chars", () => {
    const out = productDescription(makeProduct());
    expect(out.startsWith("Lion de Rayhaan es una fragancia")).toBe(true);
    expect(out).toMatch(/Desde ₡\s?1.900\./);
    expect(out.length).toBeLessThanOrEqual(160);
  });

  it("adds the shipping line only while it still fits", () => {
    const short = makeProduct({ description: "Una fragancia amaderada." });
    expect(productDescription(short)).toContain("envío a todo Costa Rica");

    const long = makeProduct({ description: "x ".repeat(78).trim() });
    expect(productDescription(long)).not.toContain("envío a todo Costa Rica");
  });

  it("never exceeds 160 characters, even for a very long description", () => {
    const out = productDescription(makeProduct({ description: "palabra ".repeat(100) }));
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
  });

  it("omits the price teaser when nothing is purchasable", () => {
    const product = makeProduct({ decant_stock_ml: 0, product_variants: [makeVariant({ stock: 0 })] });
    expect(productDescription(product)).not.toContain("Desde");
  });

  it("falls back to a factual sentence when there is no description", () => {
    const out = productDescription(makeProduct({ description: null }));
    expect(out).toContain("Rayhaan Lion Eau de Parfum");
    expect(out).toContain("perfume original");
  });
});

describe("productImages", () => {
  it("orders by position and falls back to the product name for alt text", () => {
    const images = productImages(makeProduct());
    expect(images.map((i) => i.url)).toEqual([
      "https://cdn.example/lion-1.webp",
      "https://cdn.example/lion-2.webp",
    ]);
    expect(images[0].alt).toBe("Frasco Lion");
    expect(images[1].alt).toBe("Rayhaan Lion");
  });

  it("caps the list and skips empty urls", () => {
    const product = makeProduct({
      product_images: Array.from({ length: 10 }, (_, i) => ({
        url: i === 3 ? "" : `https://cdn.example/${i}.webp`,
        position: i,
        alt_text: null,
        variant_id: null,
      })),
    });
    expect(productImages(product, 4)).toHaveLength(4);
    expect(productImages(product, 4).every((i) => i.url !== "")).toBe(true);
  });
});

describe("variantLabel", () => {
  it("mirrors what the selector shows", () => {
    expect(variantLabel(makeVariant({ size_ml: 100 }))).toBe("100 ml");
    expect(variantLabel(makeVariant({ size_ml: 5, product_type: "decant" }))).toBe("5 ml · Decant");
    expect(variantLabel(makeVariant({ size_ml: 30, product_type: "set" }))).toBe("30 ml · Set");
  });
});

describe("productSchemaInput", () => {
  it("prices each variant at what the page charges and sorts by size", () => {
    const { variants } = productSchemaInput(makeProduct());
    expect(variants.map((v) => [v.size, v.price])).toEqual([
      ["3 ml", 1_900],
      ["5 ml", 4_900],
      ["100 ml", 19_500],
    ]);
  });

  it("marks decants in stock from the ml pool and bottles from their own stock", () => {
    const inStock = Object.fromEntries(
      productSchemaInput(makeProduct()).variants.map((v) => [v.size, v.inStock])
    );
    expect(inStock).toEqual({ "3 ml": true, "5 ml": true, "100 ml": true });

    const drained = productSchemaInput(
      makeProduct({
        decant_stock_ml: 2, // fewer ml than the smallest decant needs
        product_variants: [
          makeVariant({ id: "d3", size_ml: 3, stock: 0, product_type: "decant", price: 1_900 }),
          makeVariant({ id: "b", size_ml: 100, stock: 0 }),
        ],
      })
    );
    expect(drained.variants.every((v) => v.inStock === false)).toBe(true);
  });

  it("carries real values only: brand, description, images, group id", () => {
    const input = productSchemaInput(makeProduct());
    expect(input).toMatchObject({
      id: "product-1",
      name: "Lion",
      slug: "lion",
      brand: "Rayhaan",
    });
    expect(input.images).toEqual([
      "https://cdn.example/lion-1.webp",
      "https://cdn.example/lion-2.webp",
    ]);
  });
});
