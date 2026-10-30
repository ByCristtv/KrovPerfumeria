import { describe, expect, it } from "vitest";
import {
  availableUnits,
  isInStock,
  resolveAvailability,
  type SupplierAwareVariant,
} from "./stock";

function variant(overrides: Partial<SupplierAwareVariant> = {}): SupplierAwareVariant {
  return { product_type: "full_size", size_ml: 100, stock: 0, ...overrides };
}

describe("availableUnits / isInStock (unchanged physical-stock rules)", () => {
  it("returns a bottle's or set's own stock column", () => {
    expect(availableUnits(variant({ stock: 4 }), null)).toBe(4);
    expect(availableUnits(variant({ product_type: "set", stock: 2 }), 500)).toBe(2);
  });

  it("derives decant units from the shared pool, ignoring the variant's own stock", () => {
    const decant = variant({ product_type: "decant", size_ml: 5, stock: 0 });
    expect(availableUnits(decant, 23)).toBe(4);
    expect(availableUnits(decant, 4)).toBe(0);
    expect(availableUnits(decant, null)).toBe(0);
    expect(availableUnits(decant, undefined)).toBe(0);
  });

  it("is blind to supplier availability, so cart/checkout/SEO callers stay safe", () => {
    // The whole point of keeping these two untouched: a made-to-order variant
    // must read as NOT in stock to every caller that has not opted in.
    const madeToOrder = variant({ stock: 0, supplier_available: true });
    expect(availableUnits(madeToOrder, null)).toBe(0);
    expect(isInStock(madeToOrder, null)).toBe(false);
  });
});

describe("resolveAvailability: the three states", () => {
  it("in_stock when KROV owns units", () => {
    expect(resolveAvailability(variant({ stock: 3 }), null)).toEqual({
      status: "in_stock",
      units: 3,
      canAddToCart: true,
      canInquire: false,
    });
  });

  it("made_to_order when stock is 0 and the supplier is verified available", () => {
    expect(
      resolveAvailability(variant({ stock: 0, supplier_available: true }), null)
    ).toEqual({
      status: "made_to_order",
      units: 0,
      canAddToCart: false,
      canInquire: true,
    });
  });

  it("sold_out when stock is 0 and the supplier is not available", () => {
    expect(
      resolveAvailability(variant({ stock: 0, supplier_available: false }), null)
    ).toEqual({
      status: "sold_out",
      units: 0,
      canAddToCart: false,
      canInquire: false,
    });
  });

  it("treats sets exactly like bottles", () => {
    const set = (o: Partial<SupplierAwareVariant>) =>
      resolveAvailability(variant({ product_type: "set", ...o }), null).status;
    expect(set({ stock: 1 })).toBe("in_stock");
    expect(set({ stock: 0, supplier_available: true })).toBe("made_to_order");
    expect(set({ stock: 0, supplier_available: false })).toBe("sold_out");
  });
});

describe("resolveAvailability: physical stock takes precedence", () => {
  it("a variant that is also supplier-available is a normal in-stock sale", () => {
    const result = resolveAvailability(
      variant({ stock: 5, supplier_available: true }),
      null
    );
    expect(result.status).toBe("in_stock");
    expect(result.canAddToCart).toBe(true);
    expect(result.canInquire).toBe(false);
  });

  it("reports only KROV's own units, never anything from the supplier", () => {
    expect(
      resolveAvailability(variant({ stock: 2, supplier_available: true }), null).units
    ).toBe(2);
    expect(
      resolveAvailability(variant({ stock: 0, supplier_available: true }), null).units
    ).toBe(0);
  });

  it("flips to made_to_order when the last physical unit sells, without touching the flag", () => {
    const flagged = { supplier_available: true } as const;
    expect(resolveAvailability(variant({ stock: 1, ...flagged }), null).status).toBe("in_stock");
    expect(resolveAvailability(variant({ stock: 0, ...flagged }), null).status).toBe("made_to_order");
  });
});

describe("resolveAvailability: unverified data fails closed", () => {
  it.each([
    ["null", null],
    ["undefined (column not selected / legacy payload)", undefined],
  ])("supplier_available %s is NOT made-to-order", (_label, supplier_available) => {
    expect(
      resolveAvailability(variant({ stock: 0, supplier_available }), null).status
    ).toBe("sold_out");
  });

  it("is not made-to-order when the key is missing entirely", () => {
    const legacy: SupplierAwareVariant = {
      product_type: "full_size",
      size_ml: 100,
      stock: 0,
    };
    expect("supplier_available" in legacy).toBe(false);
    expect(resolveAvailability(legacy, null).status).toBe("sold_out");
  });

  it("accepts only the boolean true, not truthy look-alikes", () => {
    // Types forbid these, but a JSON payload or a bad cast can carry them.
    for (const bad of ["true", "t", 1, "yes", {}, []]) {
      const v = variant({
        stock: 0,
        supplier_available: bad as unknown as boolean,
      });
      expect(resolveAvailability(v, null).status).toBe("sold_out");
    }
  });

  it("does not treat corrupt stock as sellable", () => {
    for (const stock of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveAvailability(variant({ stock }), null).status).not.toBe("in_stock");
    }
    // ...but a corrupt stock number does not hide a verified supplier flag either.
    expect(
      resolveAvailability(variant({ stock: -1, supplier_available: true }), null).status
    ).toBe("made_to_order");
  });
});

describe("resolveAvailability: decants never use supplier availability", () => {
  const decant = (o: Partial<SupplierAwareVariant> = {}) =>
    variant({ product_type: "decant", size_ml: 5, stock: 0, ...o });

  it("is in_stock while the pool can fill at least one unit", () => {
    const result = resolveAvailability(decant(), 12);
    expect(result.status).toBe("in_stock");
    expect(result.units).toBe(2);
    expect(result.canAddToCart).toBe(true);
  });

  it("is sold_out when the pool cannot fill one unit", () => {
    expect(resolveAvailability(decant(), 4).status).toBe("sold_out");
    expect(resolveAvailability(decant(), 0).status).toBe("sold_out");
    expect(resolveAvailability(decant(), null).status).toBe("sold_out");
    expect(resolveAvailability(decant(), undefined).status).toBe("sold_out");
  });

  it("stays sold_out with an empty pool even if a bad row carries supplier_available = true", () => {
    // The database forbids this state (chk_decant_not_supplier_available); the
    // UI must still never offer an inquiry for a decant.
    for (const pool of [0, 4, null, undefined]) {
      const result = resolveAvailability(decant({ supplier_available: true }), pool);
      expect(result.status).toBe("sold_out");
      expect(result.canInquire).toBe(false);
      expect(result.canAddToCart).toBe(false);
    }
  });

  it("is driven by the pool alone, whatever the flag says", () => {
    expect(resolveAvailability(decant({ supplier_available: true }), 10).status).toBe("in_stock");
    expect(resolveAvailability(decant({ supplier_available: false }), 10).status).toBe("in_stock");
  });

  it("does not let a made-to-order bottle's supplier flag leak to its decants", () => {
    const bottle = variant({ stock: 0, supplier_available: true });
    expect(resolveAvailability(bottle, 0).status).toBe("made_to_order");
    expect(resolveAvailability(decant(), 0).status).toBe("sold_out");
  });
});

describe("resolveAvailability: invariants over every combination", () => {
  const types = ["full_size", "set", "decant"] as const;
  const stocks = [-1, 0, 1, 7];
  const flags = [true, false, null, undefined] as const;
  const pools = [null, undefined, 0, 4, 5, 50];

  const cases = types.flatMap((product_type) =>
    stocks.flatMap((stock) =>
      flags.flatMap((supplier_available) =>
        pools.map((pool) => ({
          v: { product_type, size_ml: 5, stock, supplier_available } as SupplierAwareVariant,
          pool,
        }))
      )
    )
  );

  it("covers a meaningful number of combinations", () => {
    expect(cases.length).toBe(3 * 4 * 4 * 6);
  });

  it("exactly one state; add-to-cart and inquiry are never both offered", () => {
    for (const { v, pool } of cases) {
      const a = resolveAvailability(v, pool);
      expect(["in_stock", "made_to_order", "sold_out"]).toContain(a.status);
      expect(a.canAddToCart && a.canInquire).toBe(false);
      expect(a.canAddToCart).toBe(a.status === "in_stock");
      expect(a.canInquire).toBe(a.status === "made_to_order");
    }
  });

  it("agrees with isInStock/availableUnits: in_stock <=> KROV has units", () => {
    for (const { v, pool } of cases) {
      const a = resolveAvailability(v, pool);
      expect(a.status === "in_stock").toBe(isInStock(v, pool));
      expect(a.units).toBe(a.status === "in_stock" ? availableUnits(v, pool) : 0);
    }
  });

  it("made_to_order only ever for a non-decant with no units and a verified flag", () => {
    for (const { v, pool } of cases) {
      const a = resolveAvailability(v, pool);
      if (a.status !== "made_to_order") continue;
      expect(v.product_type).not.toBe("decant");
      expect(v.supplier_available).toBe(true);
      expect(isInStock(v, pool)).toBe(false);
    }
  });

  it("never reaches the purchase flow for anything KROV cannot ship", () => {
    for (const { v, pool } of cases) {
      const a = resolveAvailability(v, pool);
      if (a.canAddToCart) expect(isInStock(v, pool)).toBe(true);
    }
  });

  it("does not mutate its input", () => {
    const v = variant({ stock: 0, supplier_available: true });
    const snapshot = JSON.stringify(v);
    resolveAvailability(v, 10);
    expect(JSON.stringify(v)).toBe(snapshot);
  });
});
