import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract test for the two public product queries.
 *
 * Both swallow query errors (empty catalog / a 404 per product), so the columns
 * they SELECT are a deploy-order contract with the database: they must name
 * exactly the supplier columns the migration adds, and the storefront must be
 * able to resolve "Por encargo" from what comes back. This pins the select
 * strings the way getRelatedProducts.test.ts pins its filters.
 */
const { fromMock, calls } = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "gt", "order", "limit", "range"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.maybeSingle = async () => ({ data: null, error: null });
  // Thenable: `await builder.range(...)` resolves to an empty page.
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: [], error: null, count: 0 });

  return {
    calls,
    fromMock: vi.fn((table: string) => {
      calls.push({ method: "from", args: [table] });
      return builder;
    }),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  supabase: { from: fromMock, rpc: vi.fn(async () => ({ data: [], error: null })) },
}));

import { getCatalogPage } from "./getProducts";
import { getProductBySlug } from "./getProductBySlug";

/** The first `select(...)` string, whitespace-collapsed. */
function selectClause(): string {
  const raw = calls.find((c) => c.method === "select")?.args[0];
  return String(raw ?? "").replace(/\s+/g, " ");
}

/** Column names inside the first `<alias>:<rel> ( ... )` or `<rel> ( ... )` block. */
function columnsOf(select: string, relation: RegExp): string[] {
  const match = select.match(new RegExp(`${relation.source}\\s*\\(([^)]*)\\)`));
  expect(match, `relation ${relation} not found in: ${select}`).not.toBeNull();
  return match![1].split(",").map((c) => c.trim()).filter(Boolean);
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("catalog query (getCatalogPage)", () => {
  it.each([
    ["default", undefined],
    ["wholesale-only (inner-joined featured variant)", { wholesaleOnly: true }],
  ])("selects sku and supplier_available on the featured variant: %s", async (_label, filters) => {
    await getCatalogPage(1, filters);

    const columns = columnsOf(selectClause(), /featured_variant:product_variants[^(]*/);
    expect(columns).toEqual(
      expect.arrayContaining(["sku", "supplier_available"])
    );
  });

  it("keeps every column the card already relied on", async () => {
    await getCatalogPage(1);

    const columns = columnsOf(selectClause(), /featured_variant:product_variants[^(]*/);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id", "price", "offer_price", "is_on_offer", "stock", "size_ml", "product_type",
      ])
    );
  });

  it("still selects the parent's decant pool (decant availability needs it)", async () => {
    await getCatalogPage(1);
    expect(selectClause()).toMatch(/decant_stock_ml/);
  });

  describe("every active variant, for the card's availability state", () => {
    const VARIANTS = /variants:product_variants!product_variants_product_id_fkey/;

    it.each([
      ["default", undefined],
      ["wholesale-only", { wholesaleOnly: true }],
    ])("embeds the product's variants with what the card needs: %s", async (_label, filters) => {
      await getCatalogPage(1, filters);

      // Without these, "SOLO EN DECANTS" / "Desde ₡…" cannot be computed and a
      // product that is only out of stock as a bottle would read as sold out.
      expect(columnsOf(selectClause(), VARIANTS)).toEqual(
        expect.arrayContaining([
          "id", "price", "offer_price", "is_on_offer", "stock", "size_ml",
          "product_type", "sku", "supplier_available",
        ])
      );
    });

    it("keeps the featured-variant join that sorting and the wholesale filter use", async () => {
      await getCatalogPage(1);
      expect(selectClause()).toMatch(/featured_variant:product_variants!fk_featured_variant/);
    });

    it("prunes deactivated variants from the embed, not the parent product", async () => {
      await getCatalogPage(1);

      const eq = calls
        .filter((c) => c.method === "eq")
        .map((c) => [String(c.args[0]), c.args[1]]);
      expect(eq).toEqual(
        expect.arrayContaining([
          ["is_active", true],
          ["variants.is_active", true],
        ])
      );
      // No `!inner`: a product whose every variant is inactive must not change the
      // catalog count or pagination (the card simply renders nothing for it).
      expect(selectClause()).not.toMatch(/variants:product_variants[^(]*!inner/);
    });
  });

  it("does not select any wholesale price column for the public catalog", async () => {
    await getCatalogPage(1);
    expect(selectClause()).not.toMatch(/wholesale_price|min_wholesale_quantity/);
  });
});

describe("detail query (getProductBySlug)", () => {
  it("selects sku and supplier_available on every variant", async () => {
    await getProductBySlug("lion");

    const columns = columnsOf(selectClause(), /product_variants!product_variants_product_id_fkey/);
    expect(columns).toEqual(
      expect.arrayContaining(["sku", "supplier_available", "stock", "product_type", "size_ml"])
    );
  });

  it("still selects the parent's decant pool and the featured variant id", async () => {
    await getProductBySlug("lion");
    expect(selectClause()).toMatch(/decant_stock_ml/);
    expect(selectClause()).toMatch(/featured_variant_id/);
  });

  it("still serves only active products with active variants", async () => {
    await getProductBySlug("lion");
    const eq = calls.filter((c) => c.method === "eq").map((c) => [c.args[0], c.args[1]]);
    expect(eq).toEqual(
      expect.arrayContaining([
        ["slug", "lion"],
        ["is_active", true],
        ["product_variants.is_active", true],
      ])
    );
  });
});
