import type { ProductDetailData, ProductVariant } from "@/types/product";

/**
 * A product shaped like the real "Lion" row: one full-size bottle (on offer)
 * and three decants whose own `stock` is 0 because decant inventory lives in
 * the parent's shared ml pool.
 */
export function makeVariant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: "variant-100",
    price: 21_000,
    offer_price: null,
    is_on_offer: false,
    stock: 1,
    size_ml: 100,
    product_type: "full_size",
    position: 0,
    ...overrides,
  };
}

export function makeProduct(
  overrides: Partial<ProductDetailData> = {}
): ProductDetailData {
  return {
    id: "product-1",
    name: "Lion",
    slug: "lion",
    description:
      "Lion de Rayhaan es una fragancia de la familia olfativa Aromática Especiada para Hombres.",
    gender: "masculine",
    concentration: "EDP",
    notes_top: null,
    notes_middle: null,
    notes_base: null,
    featured_variant_id: "variant-100",
    decant_stock_ml: 100,
    brands: { name: "Rayhaan" },
    categories: [{ id: "cat-arabe", name: "Árabe" }],
    product_variants: [
      makeVariant({ id: "variant-3", size_ml: 3, price: 1_900, stock: 0, product_type: "decant" }),
      makeVariant({ id: "variant-5", size_ml: 5, price: 4_900, stock: 0, product_type: "decant" }),
      makeVariant({
        id: "variant-100",
        size_ml: 100,
        price: 21_000,
        offer_price: 19_500,
        is_on_offer: true,
        stock: 1,
      }),
    ],
    product_images: [
      { url: "https://cdn.example/lion-2.webp", position: 1, alt_text: null, variant_id: null },
      { url: "https://cdn.example/lion-1.webp", position: 0, alt_text: "Frasco Lion", variant_id: null },
    ],
    ...overrides,
  };
}
