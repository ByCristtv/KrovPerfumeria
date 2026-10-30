import { describe, expect, it } from "vitest";
import { makeProduct, makeVariant } from "@/test/helpers/seoFixtures";
import { productGroupSchema, type JsonLdNode } from "./jsonLd";
import { lowestAvailablePrice, productDescription, productSchemaInput } from "./product";

/**
 * A made-to-order ("Por encargo") variant cannot be bought on the page, so
 * search engines must not be told it can. These pin the decision documented on
 * `variantInStock`: it is published exactly as it was before the feature -
 * OutOfStock - and never as InStock, nor as a value Google would reject or ask
 * an availability date for.
 */
const IN_STOCK = "https://schema.org/InStock";
const OUT_OF_STOCK = "https://schema.org/OutOfStock";

const offersOf = (schema: JsonLdNode) =>
  (schema.hasVariant as Array<{ size: string; offers: { availability: string; price: number } }>).map(
    (v) => ({ size: v.size, availability: v.offers.availability, price: v.offers.price })
  );

function lion() {
  return makeProduct({
    decant_stock_ml: 0,
    product_variants: [
      makeVariant({ id: "bottle", size_ml: 100, price: 21_000, stock: 3 }),
      makeVariant({ id: "mto", size_ml: 50, price: 12_000, stock: 0, supplier_available: true }),
      makeVariant({ id: "gone", size_ml: 30, price: 8_000, stock: 0, supplier_available: false }),
    ],
  });
}

describe("structured data for made-to-order variants", () => {
  it("is not in stock: the supplier flag never reaches the in-stock input", () => {
    const inputs = productSchemaInput(lion()).variants;
    expect(Object.fromEntries(inputs.map((v) => [v.size, v.inStock]))).toEqual({
      "100 ml": true,
      "50 ml": false, // made to order
      "30 ml": false, // sold out
    });
  });

  it("publishes OutOfStock for made-to-order and sold-out, InStock only for real stock", () => {
    const offers = offersOf(productGroupSchema(productSchemaInput(lion())));

    expect(offers).toEqual([
      { size: "30 ml", availability: OUT_OF_STOCK, price: 8_000 },
      { size: "50 ml", availability: OUT_OF_STOCK, price: 12_000 },
      { size: "100 ml", availability: IN_STOCK, price: 21_000 },
    ]);
  });

  it("never emits an availability value that needs a date or that Google rejects", () => {
    const json = JSON.stringify(productGroupSchema(productSchemaInput(lion())));
    expect(json).not.toMatch(/MadeToOrder|BackOrder|PreOrder|PreSale|BuildToOrder/);
  });

  it("a product whose only variant is made-to-order is OutOfStock throughout", () => {
    const only = makeProduct({
      decant_stock_ml: 0,
      product_variants: [
        makeVariant({ id: "mto", size_ml: 100, stock: 0, supplier_available: true }),
      ],
    });
    const offers = offersOf(productGroupSchema(productSchemaInput(only)));
    expect(offers.map((o) => o.availability)).toEqual([OUT_OF_STOCK]);
  });

  it("is left out of the 'desde' price and the meta description (it is not purchasable)", () => {
    const product = lion();
    expect(lowestAvailablePrice(product)).toBe(21_000);
    expect(productDescription(product)).not.toContain("12");
  });
});
