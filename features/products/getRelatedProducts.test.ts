import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProductGender } from "@/types/product";

/**
 * A PostgREST builder recorder.
 *
 * Every chained call is captured (grouped per `from()` = per query), and the
 * builder itself is thenable so the production code can `await` whichever call
 * it ends on. This lets the test assert on the QUERY that was built — a filter
 * is invisible in the returned rows. Responses are served from a queue, one per
 * awaited query, falling back to the default.
 */
const { fromMock, queries, setResult, queueResults } = vi.hoisted(() => {
  type Result = { data: unknown; error: { message: string } | null };
  const queries: { method: string; args: unknown[] }[][] = [];
  let fallback: Result = { data: [], error: null };
  const queue: Result[] = [];

  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "in", "order", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      queries[queries.length - 1].push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve(queue.length > 0 ? queue.shift() : fallback);

  return {
    queries,
    fromMock: vi.fn((table: string) => {
      queries.push([{ method: "from", args: [table] }]);
      return builder;
    }),
    setResult: (next: Result) => {
      fallback = next;
    },
    queueResults: (...next: Result[]) => {
      queue.length = 0;
      queue.push(...next);
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ supabase: { from: fromMock } }));

import { getRelatedProducts, rankByGender } from "./getRelatedProducts";

/** The `select(...)` string query `n` was built with. */
function selectClause(n = 0): string {
  return String(queries[n]?.find((c) => c.method === "select")?.args[0] ?? "");
}

/** Every `.eq(column, value)` pair recorded on query `n`. */
function eqFilters(n = 0): [string, unknown][] {
  return (queries[n] ?? [])
    .filter((c) => c.method === "eq")
    .map((c) => [String(c.args[0]), c.args[1]] as [string, unknown]);
}

function productRow(id: string, gender: ProductGender = "unisex") {
  return {
    id,
    name: `Product ${id}`,
    slug: `product-${id}`,
    gender,
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

const ok = (data: unknown) => ({ data, error: null });

function source(
  overrides: Partial<{ id: string; gender: ProductGender | null; categoryIds: string[] }> = {}
) {
  return { id: "p-1", gender: "masculine" as ProductGender | null, categoryIds: ["c-1"], ...overrides };
}

describe("getRelatedProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queries.length = 0;
    setResult({ data: [], error: null });
    queueResults();
  });

  // ── The 404 regression ───────────────────────────────────────────────────
  describe("only recommends products a visitor can actually open", () => {
    it("filters the featured variant to is_active = true", async () => {
      await getRelatedProducts(source());

      expect(eqFilters()).toContainEqual(["featured_variant.is_active", true]);
    });

    it("inner-joins the featured variant so the filter prunes the PARENT row", async () => {
      await getRelatedProducts(source());

      expect(selectClause()).toContain(
        "featured_variant:product_variants!fk_featured_variant!inner"
      );
    });

    it("still requires the parent product to be active", async () => {
      await getRelatedProducts(source());

      expect(eqFilters()).toContainEqual(["is_active", true]);
    });

    it("applies the same visibility rules to the gender fallback query", async () => {
      await getRelatedProducts(source());

      expect(queries).toHaveLength(2);
      expect(eqFilters(1)).toContainEqual(["featured_variant.is_active", true]);
      expect(eqFilters(1)).toContainEqual(["is_active", true]);
      expect(selectClause(1)).toContain("product_variants!fk_featured_variant!inner");
    });
  });

  // ── Matching ────────────────────────────────────────────────────────────
  it("excludes the product being viewed", async () => {
    await getRelatedProducts(source());

    expect(queries[0]).toContainEqual({ method: "neq", args: ["id", "p-1"] });
  });

  it("matches on the given commercial categories, inner-joined", async () => {
    await getRelatedProducts(source({ categoryIds: ["c-1", "c-2"] }));

    expect(queries[0]).toContainEqual({ method: "in", args: ["categories.id", ["c-1", "c-2"]] });
    expect(selectClause()).toContain("categories!inner");
  });

  it("keeps gender relevance through products.gender (masculine → masculine + unisex)", async () => {
    await getRelatedProducts(source({ gender: "masculine" }));

    expect(queries[0]).toContainEqual({ method: "in", args: ["gender", ["masculine", "unisex"]] });
  });

  it("never recommends masculine perfumes next to a feminine one", async () => {
    await getRelatedProducts(source({ gender: "feminine" }));

    for (const query of queries) {
      expect(query).toContainEqual({ method: "in", args: ["gender", ["feminine", "unisex"]] });
    }
  });

  it("ranks the same gender before unisex", async () => {
    queueResults(ok([productRow("u", "unisex"), productRow("m", "masculine")]));

    const result = await getRelatedProducts(source({ gender: "masculine" }), 2);

    expect(result.map((p) => p.id)).toEqual(["m", "u"]);
  });

  it("does not run the fallback when the category query filled every slot", async () => {
    queueResults(ok([productRow("a", "masculine"), productRow("b", "masculine")]));

    await getRelatedProducts(source(), 2);

    expect(queries).toHaveLength(1);
  });

  it("fills empty slots from the gender fallback, without a category join", async () => {
    queueResults(ok([productRow("a", "masculine")]), ok([productRow("a", "masculine"), productRow("b", "unisex")]));

    const result = await getRelatedProducts(source(), 2);

    expect(result.map((p) => p.id)).toEqual(["a", "b"]);
    expect(selectClause(1)).not.toContain("categories!inner");
    expect(queries[1].some((c) => c.method === "in" && c.args[0] === "categories.id")).toBe(false);
    expect(queries[1]).toContainEqual({ method: "in", args: ["gender", ["masculine", "unisex"]] });
  });

  it("recommends by gender alone when the product has no commercial category", async () => {
    queueResults(ok([productRow("b", "masculine")]));

    const result = await getRelatedProducts(source({ categoryIds: [] }));

    expect(queries).toHaveLength(1);
    expect(selectClause()).not.toContain("categories!inner");
    expect(result.map((p) => p.id)).toEqual(["b"]);
  });

  it("matches on categories only when the gender is unknown", async () => {
    await getRelatedProducts(source({ gender: null }));

    expect(queries).toHaveLength(1);
    expect(queries[0].some((c) => c.method === "in" && c.args[0] === "gender")).toBe(false);
  });

  it("short-circuits without a round-trip with neither categories nor gender", async () => {
    const result = await getRelatedProducts(source({ gender: null, categoryIds: [] }));

    expect(result).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("deduplicates products the multi-category join returned twice", async () => {
    queueResults(ok([productRow("a"), productRow("a"), productRow("b")]));

    const result = await getRelatedProducts(source({ gender: "unisex" }), 2);

    expect(result.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("clamps to the requested limit (with slack in the candidate window)", async () => {
    queueResults(ok([productRow("a"), productRow("b"), productRow("c")]));

    const result = await getRelatedProducts(source({ gender: "unisex" }), 2);

    expect(result).toHaveLength(2);
    expect(queries[0]).toContainEqual({ method: "limit", args: [6] });
  });

  it("degrades to no recommendations on a query error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    setResult({ data: null, error: { message: "boom" } });

    await expect(getRelatedProducts(source())).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("treats a null payload as no recommendations", async () => {
    setResult({ data: null, error: null });

    await expect(getRelatedProducts(source())).resolves.toEqual([]);
  });
});

describe("rankByGender", () => {
  it("is stable within a rank and pushes unrelated genders last", () => {
    const rows = [
      productRow("f1", "feminine"),
      productRow("u1", "unisex"),
      productRow("m1", "masculine"),
      productRow("u2", "unisex"),
      productRow("m2", "masculine"),
    ] as never[];

    expect(rankByGender(rows, "masculine").map((r: { id: string }) => r.id)).toEqual([
      "m1",
      "m2",
      "u1",
      "u2",
      "f1",
    ]);
  });
});
