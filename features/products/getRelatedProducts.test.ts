import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A PostgREST builder recorder.
 *
 * Every chained call is captured, and the builder itself is thenable so the
 * production code can `await` whichever call it ends on. This lets the test
 * assert on the QUERY that was built — which is the whole point here: the bug
 * was a missing filter, and a filter is invisible in the returned rows.
 */
const { fromMock, calls, setResult } = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  let result: { data: unknown; error: { message: string } | null } = {
    data: [],
    error: null,
  };

  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  // Thenable: `await builder` resolves to the configured PostgREST response.
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result);

  return {
    calls,
    fromMock: vi.fn((table: string) => {
      calls.push({ method: "from", args: [table] });
      return builder;
    }),
    setResult: (next: typeof result) => {
      result = next;
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ supabase: { from: fromMock } }));

import { getRelatedProducts } from "./getRelatedProducts";

/** The `select(...)` string the query was built with. */
function selectClause(): string {
  return String(calls.find((c) => c.method === "select")?.args[0] ?? "");
}

/** Every `.eq(column, value)` pair recorded on the query. */
function eqFilters(): [string, unknown][] {
  return calls
    .filter((c) => c.method === "eq")
    .map((c) => [String(c.args[0]), c.args[1]] as [string, unknown]);
}

function productRow(id: string) {
  return {
    id,
    name: `Product ${id}`,
    slug: `product-${id}`,
    gender: "unisex",
    concentration: "EDP",
    decant_stock_ml: 0,
    brands: { name: "KROV" },
    featured_variant: {
      id: `v-${id}`,
      price: 20000,
      offer_price: null,
      is_on_offer: false,
      stock: 3,
      size_ml: 100,
      product_type: "full_size",
    },
    product_images: [{ url: "https://cdn/a.jpg", position: 0 }],
  };
}

describe("getRelatedProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    setResult({ data: [], error: null });
  });

  // ── Task 3: the 404 regression ───────────────────────────────────────────
  describe("only recommends products a visitor can actually open", () => {
    it("filters the featured variant to is_active = true", async () => {
      // THE FIX. Without this, a card can point at a product whose variants are
      // all deactivated — and app/products/[slug] calls notFound() for those.
      await getRelatedProducts("p-1", ["c-1"]);

      expect(eqFilters()).toContainEqual(["featured_variant.is_active", true]);
    });

    it("inner-joins the featured variant so the filter prunes the PARENT row", async () => {
      // Without `!inner`, PostgREST empties the embedded object and STILL
      // returns the product — the 404 would survive the filter.
      expect.assertions(1);

      await getRelatedProducts("p-1", ["c-1"]);

      expect(selectClause()).toContain(
        "featured_variant:product_variants!fk_featured_variant!inner"
      );
    });

    it("still requires the parent product to be active", async () => {
      await getRelatedProducts("p-1", ["c-1"]);

      expect(eqFilters()).toContainEqual(["is_active", true]);
    });

    it("returns nothing when every candidate was pruned as inactive", async () => {
      setResult({ data: [], error: null });

      await expect(getRelatedProducts("p-1", ["c-1"])).resolves.toEqual([]);
    });
  });

  // ── Existing behaviour that must not regress ─────────────────────────────
  it("excludes the product being viewed", async () => {
    await getRelatedProducts("p-1", ["c-1"]);

    expect(calls).toContainEqual({ method: "neq", args: ["id", "p-1"] });
  });

  it("matches on the given categories", async () => {
    await getRelatedProducts("p-1", ["c-1", "c-2"]);

    expect(calls).toContainEqual({
      method: "in",
      args: ["categories.id", ["c-1", "c-2"]],
    });
  });

  it("short-circuits without a round-trip when the product has no categories", async () => {
    const result = await getRelatedProducts("p-1", []);

    expect(result).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("deduplicates products the multi-category join returned twice", async () => {
    setResult({
      data: [productRow("a"), productRow("a"), productRow("b")],
      error: null,
    });

    const result = await getRelatedProducts("p-1", ["c-1", "c-2"]);

    expect(result.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("clamps to the requested limit", async () => {
    setResult({
      data: [productRow("a"), productRow("b"), productRow("c")],
      error: null,
    });

    const result = await getRelatedProducts("p-1", ["c-1"], 2);

    expect(result).toHaveLength(2);
    expect(calls).toContainEqual({ method: "limit", args: [2] });
  });

  it("degrades to no recommendations on a query error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    setResult({ data: null, error: { message: "boom" } });

    await expect(getRelatedProducts("p-1", ["c-1"])).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("treats a null payload as no recommendations", async () => {
    setResult({ data: null, error: null });

    await expect(getRelatedProducts("p-1", ["c-1"])).resolves.toEqual([]);
  });
});
