import { describe, expect, it } from "vitest";
import type { ProductCardData, ProductCardVariant } from "@/types/product";
import {
  LOW_STOCK_THRESHOLD,
  cardPrice,
  resolveCardState,
  type CardState,
} from "./cardState";

/** A 100 ml bottle, 21 000, no stock, supplier unverified: sold out unless overridden. */
const bottle = (o: Partial<ProductCardVariant> = {}): ProductCardVariant => ({
  id: "bottle",
  price: 21_000,
  offer_price: null,
  is_on_offer: false,
  stock: 0,
  size_ml: 100,
  product_type: "full_size",
  sku: "KRV-100",
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
  stock: 0, // a decant never holds stock of its own: it is poured from the pool
  size_ml: size,
  product_type: "decant",
  sku: `DEC-${size}`,
  supplier_available: false,
  ...o,
});

type Input = Pick<ProductCardData, "featured_variant" | "variants" | "decant_stock_ml">;

/** Build a card input; the first variant is the featured one unless stated. */
function product(variants: ProductCardVariant[], pool = 0, featuredId?: string): Input {
  return {
    featured_variant: variants.find((v) => v.id === (featuredId ?? variants[0]?.id)) ?? null,
    variants,
    decant_stock_ml: pool,
  };
}

function state(input: Input): CardState {
  const s = resolveCardState(input);
  if (!s) throw new Error("expected a card state");
  return s;
}

const DECANTS = [decant(3, 1_900), decant(5, 2_900), decant(10, 4_900)];

// ─────────────────────────────────────────────────────────────────────────────
describe("the 13-case matrix", () => {
  it("1. own stock, supplier unavailable, no decants -> available, add to cart", () => {
    const s = state(product([bottle({ stock: 12 })]));
    expect(s).toMatchObject({ status: "available", action: "add_to_cart", kind: "bottle" });
    expect(s.alsoDecants).toBe(false);
  });

  it("2. own stock, supplier available, decants available -> still a normal sale", () => {
    const s = state(product([bottle({ stock: 12, supplier_available: true }), ...DECANTS], 50));
    expect(s).toMatchObject({ status: "available", action: "add_to_cart" });
    // Supplier availability never overrides physical stock, and a stocked bottle
    // does not advertise decants as a competing option.
    expect(s.alsoDecants).toBe(false);
  });

  it("3. low own stock, supplier available, decants available -> low stock, add to cart", () => {
    const s = state(product([bottle({ stock: 2, supplier_available: true }), ...DECANTS], 50));
    expect(s).toMatchObject({ status: "low_stock", action: "add_to_cart", units: 2 });
  });

  it("4. no stock, supplier available, no decants -> made to order, WhatsApp", () => {
    const s = state(product([bottle({ supplier_available: true })]));
    expect(s).toMatchObject({ status: "made_to_order", action: "whatsapp", kind: "bottle" });
    expect(s.alsoDecants).toBe(false);
  });

  it("5. no stock, supplier available, decants available -> POR ENCARGO wins; decants are secondary", () => {
    const s = state(product([bottle({ supplier_available: true }), ...DECANTS], 50));
    expect(s).toMatchObject({ status: "made_to_order", action: "whatsapp", kind: "bottle" });
    expect(s.presented.id).toBe("bottle"); // the bottle stays the presentation
    expect(s.alsoDecants).toBe(true);
    expect(s.decantsAvailable).toHaveLength(3);
  });

  it("6. no stock, supplier unavailable, decants available -> SOLO EN DECANTS", () => {
    const s = state(product([bottle(), ...DECANTS], 50));
    expect(s).toMatchObject({ status: "decants_only", action: "choose_decant", kind: "decants" });
    expect(s.presented.product_type).toBe("decant");
    expect(s.decantFromMl).toBe(3);
  });

  it("7. no stock, supplier unavailable, no decants -> AGOTADO, nothing to do", () => {
    expect(state(product([bottle()]))).toMatchObject({ status: "sold_out", action: "none" });
  });

  it("8. discounted bottle available normally -> the bottle's own discount", () => {
    const s = state(product([bottle({ stock: 9, is_on_offer: true, offer_price: 17_500 })]));
    expect(s.status).toBe("available");
    expect(s.price).toEqual({ current: 17_500, original: 21_000, discountPercent: 17 });
  });

  it("9. discounted bottle available by order -> discount shown, action still WhatsApp", () => {
    const s = state(
      product([bottle({ supplier_available: true, is_on_offer: true, offer_price: 16_800 })])
    );
    expect(s).toMatchObject({ status: "made_to_order", action: "whatsapp" });
    expect(s.price).toEqual({ current: 16_800, original: 21_000, discountPercent: 20 });
  });

  it("10. discounted product, decants only -> the DECANT's discount, never the bottle's", () => {
    const s = state(
      product(
        [
          // The bottle is on a big offer but cannot be bought: its discount is irrelevant.
          bottle({ is_on_offer: true, offer_price: 10_000 }),
          decant(5, 2_500, { is_on_offer: true, offer_price: 1_900 }),
        ],
        50
      )
    );
    expect(s.status).toBe("decants_only");
    expect(s.presented.id).toBe("decant-5");
    expect(s.price).toEqual({ current: 1_900, original: 2_500, discountPercent: 24 });
  });

  it("10b. decants only, nothing discounted -> no discount even though the bottle is", () => {
    const s = state(
      product([bottle({ is_on_offer: true, offer_price: 10_000 }), decant(5, 2_500)], 50)
    );
    expect(s.price).toEqual({ current: 2_500, original: null, discountPercent: null });
  });

  it("11. several decant sizes -> starts from the cheapest purchasable one", () => {
    // pool 25 ml: 3, 5 and 10 ml fit; a 30 ml decant does not and is not offered.
    const s = state(product([bottle(), ...DECANTS, decant(30, 9_000)], 25));
    expect(s.decantsAvailable.map((d) => d.size_ml)).toEqual([3, 5, 10]);
    expect(s.decantFromMl).toBe(3);
    expect(s.presented.id).toBe("decant-3");
    expect(s.price.current).toBe(1_900);
  });

  it("11b. the cheapest decant is not always the smallest: price and size are independent", () => {
    const s = state(product([bottle(), decant(3, 3_000), decant(5, 2_500)], 50));
    expect(s.decantFromMl).toBe(3); // "Desde 3 ml"
    expect(s.presented.id).toBe("decant-5"); // ...but the starting PRICE is the 5 ml one
    expect(s.price.current).toBe(2_500);
  });

  it("13. missing or invalid pricing -> no number, no discount, no crash", () => {
    for (const price of [0, -5, Number.NaN, null, undefined] as unknown as number[]) {
      const s = state(product([bottle({ stock: 12, price })]));
      expect(s.price).toEqual({ current: null, original: null, discountPercent: null });
      expect(s.status).toBe("available"); // inventory is a separate question...
      expect(s.action).toBe("none"); // ...but nothing is quick-added at an unknown price
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("precedence over EVERY combination (the rule, not the examples)", () => {
  const stocks = [0, 1, LOW_STOCK_THRESHOLD, LOW_STOCK_THRESHOLD + 1, 40];
  const flags = [true, false, null, undefined] as const;
  const pools = [0, 2, 3, 50];
  const decantSets: Array<[string, ProductCardVariant[]]> = [
    ["no decant variants", []],
    ["decants 3/5/10", DECANTS],
  ];

  const cases = stocks.flatMap((stock) =>
    flags.flatMap((flag) =>
      pools.flatMap((pool) =>
        decantSets.map(([label, ds]) => ({
          stock,
          flag,
          pool,
          label,
          s: state(product([bottle({ stock, supplier_available: flag }), ...ds], pool)),
          // Independent restatement of "a decant can be bought right now".
          decantBuyable: ds.some((d) => Math.floor(pool / d.size_ml) >= 1),
        }))
      )
    )
  );

  it("covers the whole grid", () => {
    expect(cases).toHaveLength(stocks.length * flags.length * pools.length * decantSets.length);
  });

  it("follows the table exactly", () => {
    for (const { stock, flag, decantBuyable, s } of cases) {
      const where = JSON.stringify({ stock, flag, decantBuyable });
      if (stock > 0) {
        expect(["available", "low_stock"], where).toContain(s.status);
      } else if (flag === true) {
        expect(s.status, where).toBe("made_to_order");
      } else if (decantBuyable) {
        expect(s.status, where).toBe("decants_only");
      } else {
        expect(s.status, where).toBe("sold_out");
      }
    }
  });

  it("own stock is never overridden by the supplier or by decants", () => {
    for (const { stock, s } of cases.filter((c) => c.stock > 0)) {
      expect(s.status).not.toBe("made_to_order");
      expect(s.status).not.toBe("decants_only");
      expect(s.action).toBe("add_to_cart");
      expect(s.units).toBe(stock);
    }
  });

  it("low stock is exactly 1..threshold", () => {
    for (const { stock, s } of cases.filter((c) => c.stock > 0)) {
      expect(s.status === "low_stock").toBe(stock <= LOW_STOCK_THRESHOLD);
    }
  });

  it("exactly one action per state, and the action follows the STATE (not the mere existence of decants)", () => {
    const expected = {
      available: "add_to_cart",
      low_stock: "add_to_cart",
      made_to_order: "whatsapp",
      decants_only: "choose_decant",
      sold_out: "none",
    } as const;
    for (const { s } of cases) expect(s.action).toBe(expected[s.status]);
  });

  it("WhatsApp is offered only for a bottle the supplier can provide - never for a sold-out card", () => {
    for (const { s, flag, stock } of cases) {
      if (s.action === "whatsapp") {
        expect(stock).toBe(0);
        expect(flag).toBe(true);
      }
      if (s.status === "sold_out") expect(s.action).not.toBe("whatsapp");
    }
  });

  it("AGOTADO only when there is genuinely no way to buy or ask", () => {
    for (const { s, stock, flag, decantBuyable } of cases) {
      if (s.status === "sold_out") {
        expect(stock).toBe(0);
        expect(flag).not.toBe(true);
        expect(decantBuyable).toBe(false);
      }
    }
  });

  it("the secondary decants hint appears only on a made-to-order card with buyable decants", () => {
    for (const { s, decantBuyable } of cases) {
      expect(s.alsoDecants).toBe(s.status === "made_to_order" && decantBuyable);
    }
  });

  it("only a made-to-order or decants-only card ever reports buyable decants as part of its story", () => {
    for (const { s } of cases.filter((c) => c.s.status === "decants_only")) {
      expect(s.kind).toBe("decants");
      expect(s.presented.product_type).toBe("decant");
    }
    for (const { s } of cases.filter((c) => c.s.status !== "decants_only")) {
      expect(s.kind).toBe("bottle");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("what is actually purchasable", () => {
  it("a parent existing says nothing about its decants: a drained pool means none", () => {
    const s = state(product([bottle(), ...DECANTS], 0));
    expect(s.decantsAvailable).toEqual([]);
    expect(s.status).toBe("sold_out");
  });

  it("a pool smaller than the smallest decant is also none", () => {
    expect(state(product([bottle(), ...DECANTS], 2)).status).toBe("sold_out");
  });

  it("a decant's own stock column is ignored - only the shared pool counts", () => {
    const stray = decant(5, 2_900, { stock: 99 }); // the DB forbids this; the card must not trust it
    expect(state(product([bottle(), stray], 0)).status).toBe("sold_out");
    expect(state(product([bottle(), stray], 50)).status).toBe("decants_only");
  });

  it("a bottle's stock is never inferred from decants, or the other way round", () => {
    const s = state(product([bottle({ stock: 0 }), decant(5, 2_900)], 100));
    expect(s.units).toBe(0);
    expect(s.status).toBe("decants_only");
  });

  it("the supplier flag on a decant is ignored (decants are never made to order)", () => {
    const flagged = decant(5, 2_900, { supplier_available: true });
    expect(state(product([flagged], 0)).status).toBe("sold_out");
  });

  it("a product sold ONLY as decants is 'decants only' while the pool lasts", () => {
    expect(state(product(DECANTS, 50)).status).toBe("decants_only");
    expect(state(product(DECANTS, 0)).status).toBe("sold_out");
  });

  it("with several bottle sizes, the one KROV actually holds is presented", () => {
    const big = bottle({ id: "b100", size_ml: 100, stock: 0 });
    const small = bottle({ id: "b50", size_ml: 50, stock: 3 });
    const s = state(product([big, small], 0, "b100"));
    expect(s.status).toBe("low_stock");
    expect(s.presented.id).toBe("b50");
  });

  it("own stock of ANY bottle beats a made-to-order featured one", () => {
    const featured = bottle({ id: "b100", stock: 0, supplier_available: true });
    const small = bottle({ id: "b50", size_ml: 50, stock: 8 });
    const s = state(product([featured, small], 0, "b100"));
    expect(s.status).toBe("available");
    expect(s.presented.id).toBe("b50");
  });

  it("the featured bottle is preferred when several qualify", () => {
    const a = bottle({ id: "a", size_ml: 50, stock: 8 });
    const b = bottle({ id: "b", size_ml: 100, stock: 8 });
    expect(state(product([a, b], 0, "b")).presented.id).toBe("b");
  });

  it("a set is a bottle for these purposes", () => {
    const set = bottle({ id: "set", product_type: "set", stock: 4 });
    expect(state(product([set])).kind).toBe("bottle");
    const ordered = bottle({ id: "set", product_type: "set", supplier_available: true });
    expect(state(product([ordered])).status).toBe("made_to_order");
  });

  it("falls back to the featured variant alone when no variant list was loaded", () => {
    const featuredOnly: Input = {
      featured_variant: bottle({ stock: 6 }),
      variants: undefined,
      decant_stock_ml: 50,
    };
    // Decants are UNKNOWN here, never assumed: a sold-out bottle stays sold out.
    expect(state(featuredOnly).status).toBe("available");
    expect(
      state({ ...featuredOnly, featured_variant: bottle({ stock: 0 }) }).status
    ).toBe("sold_out");
  });

  it("returns null when there is nothing to present", () => {
    expect(
      resolveCardState({ featured_variant: null, variants: [], decant_stock_ml: 0 })
    ).toBeNull();
    expect(
      resolveCardState({ featured_variant: null, variants: undefined, decant_stock_ml: 0 })
    ).toBeNull();
  });

  it("does not mutate its input", () => {
    const input = product([bottle({ stock: 0, supplier_available: true }), ...DECANTS], 50);
    const snapshot = JSON.stringify(input);
    resolveCardState(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("a sold-out card keeps its price readable but advertises no promotion", () => {
    const s = state(product([bottle({ is_on_offer: true, offer_price: 15_000 })]));
    expect(s.status).toBe("sold_out");
    expect(s.price).toEqual({ current: 15_000, original: null, discountPercent: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("cardPrice: a discount is shown only when it is real", () => {
  const priced = (o: Partial<ProductCardVariant>) => cardPrice(bottle(o));

  it("rounds the saving to a whole percent with the specified formula", () => {
    expect(priced({ price: 20_000, is_on_offer: true, offer_price: 18_000 }).discountPercent).toBe(10);
    expect(priced({ price: 21_000, is_on_offer: true, offer_price: 17_500 }).discountPercent).toBe(17);
    expect(priced({ price: 10_000, is_on_offer: true, offer_price: 6_500 }).discountPercent).toBe(35);
  });

  it("charges the offer price while the offer is on, exactly as checkout does", () => {
    expect(priced({ is_on_offer: true, offer_price: 17_500 }).current).toBe(17_500);
  });

  it("an offer that is switched off is ignored even if offer_price lingers", () => {
    expect(priced({ is_on_offer: false, offer_price: 17_500 })).toEqual({
      current: 21_000,
      original: null,
      discountPercent: null,
    });
  });

  it("an offer flag with no offer price falls back to the list price", () => {
    expect(priced({ is_on_offer: true, offer_price: null })).toEqual({
      current: 21_000,
      original: null,
      discountPercent: null,
    });
  });

  it.each([
    ["offer equal to list", 21_000],
    ["offer above list (misconfigured)", 25_000],
  ])("%s: charged as configured, but no discount is advertised", (_label, offer) => {
    expect(priced({ is_on_offer: true, offer_price: offer })).toEqual({
      current: offer,
      original: null,
      discountPercent: null,
    });
  });

  it("a saving that rounds to 0% is not advertised", () => {
    const p = priced({ price: 10_000, is_on_offer: true, offer_price: 9_970 });
    expect(p).toEqual({ current: 9_970, original: null, discountPercent: null });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined])(
    "an unusable offer price (%s) yields no number at all",
    (offer) => {
      const p = priced({ is_on_offer: true, offer_price: offer as unknown as number });
      expect(p.discountPercent).toBeNull();
      expect(p.original).toBeNull();
      if (offer == null) expect(p.current).toBe(21_000);
      else expect(p.current).toBeNull();
    }
  );

  it("an invalid list price with a valid offer shows the offer but no discount", () => {
    const p = priced({ price: Number.NaN, is_on_offer: true, offer_price: 15_000 });
    expect(p).toEqual({ current: 15_000, original: null, discountPercent: null });
  });
});
