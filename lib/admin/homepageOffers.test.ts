import { describe, expect, it } from "vitest";
import {
  classifyProductEdit,
  classifyVariantWrite,
  isHomepageOfferChange,
  type ProductEditSnapshot,
} from "./homepageOffers";

const PRODUCT_ID = "11111111-2222-4333-8444-555555555555";

function snapshot(
  variant: Partial<ProductEditSnapshot["variant"]> = {},
  product: Partial<ProductEditSnapshot["product"]> = {}
): ProductEditSnapshot {
  return {
    product: { name: "Khamrah", brand_id: "b-1", description: "Dulce", ...product },
    variant: {
      price: 30000,
      offer_price: null,
      is_on_offer: false,
      stock: 3,
      is_active: true,
      product_type: "full_size",
      size_ml: 100,
      ...variant,
    },
  };
}

const onOffer = { is_on_offer: true, offer_price: 25000 };

describe("classifyProductEdit", () => {
  it("revalidates when an offer is switched on", () => {
    expect(classifyProductEdit(PRODUCT_ID, snapshot(), snapshot(onOffer))).toEqual({
      scope: "offers",
    });
  });

  it("revalidates when an offer is switched off (the slide must disappear)", () => {
    expect(classifyProductEdit(PRODUCT_ID, snapshot(onOffer), snapshot())).toEqual({
      scope: "offers",
    });
  });

  it.each([
    ["promotional price", { offer_price: 22000 }],
    ["original price", { price: 32000 }],
    ["stock", { stock: 0 }],
    ["activation", { is_active: false }],
    ["size", { size_ml: 50 }],
    ["type", { product_type: "set" }],
  ])("revalidates when an on-offer variant's %s changes", (_label, change) => {
    expect(
      classifyProductEdit(PRODUCT_ID, snapshot(onOffer), snapshot({ ...onOffer, ...change }))
    ).toEqual({ scope: "offers" });
  });

  it("ignores eligibility edits on a variant that is not on offer", () => {
    expect(
      classifyProductEdit(PRODUCT_ID, snapshot(), snapshot({ price: 99000, stock: 0 }))
    ).toBeNull();
  });

  it("asks the server to check the product when a displayed field changes", () => {
    // Another variant of this product may be the one on the hero.
    expect(
      classifyProductEdit(PRODUCT_ID, snapshot(), snapshot({}, { name: "Khamrah Qahwa" }))
    ).toEqual({ scope: "product", productId: PRODUCT_ID });
  });

  it("ignores a save that changed nothing the hero uses", () => {
    expect(classifyProductEdit(PRODUCT_ID, snapshot(onOffer), snapshot(onOffer))).toBeNull();
  });
});

describe("classifyVariantWrite", () => {
  it("revalidates when any touched variant is on offer", () => {
    expect(classifyVariantWrite([{ is_on_offer: false }, { is_on_offer: true }])).toEqual({
      scope: "offers",
    });
  });

  it("skips writes that touch no on-offer variant", () => {
    expect(classifyVariantWrite([{ is_on_offer: false }])).toBeNull();
    expect(classifyVariantWrite([])).toBeNull();
  });
});

describe("isHomepageOfferChange", () => {
  it("accepts the two well-formed scopes", () => {
    expect(isHomepageOfferChange({ scope: "offers" })).toBe(true);
    expect(isHomepageOfferChange({ scope: "product", productId: PRODUCT_ID })).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isHomepageOfferChange(null)).toBe(false);
    expect(isHomepageOfferChange("offers")).toBe(false);
    expect(isHomepageOfferChange({ scope: "everything" })).toBe(false);
    expect(isHomepageOfferChange({ scope: "product" })).toBe(false);
    expect(isHomepageOfferChange({ scope: "product", productId: "not-a-uuid" })).toBe(false);
  });
});
