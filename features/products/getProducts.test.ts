import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A tiny in-memory PostgREST fake, just big enough for the catalog query.
 *
 * It evaluates the filters the production code builds against fixture rows:
 *   · eq/in on a top-level column            → compared on the row
 *   · in("categories.id", …)                  → the embedded categories (the
 *                                               `categories!inner` semantics)
 *   · dotted eq (variants.is_active, …)       → ignored (embedded pruning only)
 *   · range(from, to) + { count: "exact" }    → slice + total
 * so these tests assert what a visitor would SEE, not just which methods ran.
 * Every call is also recorded for the structural assertions.
 */
type Row = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as { table: string; method: string; args: unknown[] }[],
  failTable: null as string | null,
}));

vi.mock("@/lib/supabase/client", () => {
  function query(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let window: [number, number] | null = null;
    let limit: number | null = null;
    const record = (method: string, args: unknown[]) => db.calls.push({ table, method, args });

    const builder: Record<string, unknown> = {
      select: (...args: unknown[]) => (record("select", args), builder),
      order: (...args: unknown[]) => (record("order", args), builder),
      eq: (col: string, value: unknown) => {
        record("eq", [col, value]);
        if (!col.includes(".")) filters.push((row) => row[col] === value);
        return builder;
      },
      in: (col: string, values: unknown[]) => {
        record("in", [col, values]);
        if (col === "categories.id") {
          filters.push((row) =>
            ((row.categories as { id: string }[]) ?? []).some((c) => values.includes(c.id))
          );
        } else if (!col.includes(".")) {
          filters.push((row) => values.includes(row[col]));
        }
        return builder;
      },
      range: (from: number, to: number) => {
        record("range", [from, to]);
        window = [from, to];
        return builder;
      },
      limit: (n: number) => {
        record("limit", [n]);
        limit = n;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown) => {
        if (db.failTable === table) {
          return resolve({ data: null, error: { message: `${table} down` }, count: null });
        }
        const rows = (db.tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        let data = rows;
        if (window) data = rows.slice(window[0], window[1] + 1);
        if (limit !== null) data = data.slice(0, limit);
        return resolve({ data, error: null, count: rows.length });
      },
    };
    return builder;
  }

  return {
    supabase: {
      from: (table: string) => {
        db.calls.push({ table, method: "from", args: [] });
        return query(table);
      },
      rpc: vi.fn(async () => ({ data: [], error: null })),
    },
  };
});

import { getCatalogPage, getProductsPage } from "./getProducts";
import { PRODUCTS_PAGE_SIZE } from "@/types/productFilter";

const CAT = {
  hombre: "cat-hombre",
  mujer: "cat-mujer",
  unisex: "cat-unisex",
  arabe: "cat-arabe",
  nicho: "cat-nicho",
};

function product(
  id: string,
  gender: "masculine" | "feminine" | "unisex",
  categoryIds: string[] = []
): Row {
  return {
    id,
    name: id,
    slug: id,
    gender,
    is_active: true,
    categories: categoryIds.map((cid) => ({ id: cid, name: cid })),
  };
}

/**
 * Fixtures mirror the production audit: rows whose legacy gender category
 * DISAGREES with products.gender must be filtered by gender, not by the row.
 */
const FIXTURE: Row[] = [
  product("dunscape", "masculine", [CAT.unisex]), // stale Unisex row
  product("arabian-sky", "masculine", [CAT.unisex, CAT.arabe]), // stale Unisex row
  product("hawas-diva", "feminine", [CAT.hombre, CAT.arabe]), // stale Hombre row
  product("black-opium", "unisex", [CAT.mujer]), // stale Mujer row
  product("sauvage", "masculine"),
  product("yara", "feminine", [CAT.arabe]),
  product("khamrah", "unisex", [CAT.arabe, CAT.nicho]),
];

function seed(products: Row[] = FIXTURE) {
  db.tables = {
    products,
    categories: [
      { id: CAT.hombre, slug: "hombre" },
      { id: CAT.mujer, slug: "mujer" },
      { id: CAT.unisex, slug: "unisex" },
      { id: CAT.arabe, slug: "arabe" },
      { id: CAT.nicho, slug: "nicho" },
    ],
    product_variants: [],
  };
}

async function slugs(category: string, page = 1) {
  const result = await getCatalogPage(page, { category });
  return result.products.map((p) => p.slug).sort();
}

function productCalls() {
  return db.calls.filter((c) => c.table === "products");
}

beforeEach(() => {
  db.calls.length = 0;
  db.failTable = null;
  seed();
});

describe("catalog gender filters (products.gender is the source of truth)", () => {
  it("Mujer shows feminine + unisex and never a masculine product", async () => {
    expect(await slugs(CAT.mujer)).toEqual(["black-opium", "hawas-diva", "khamrah", "yara"]);
  });

  it("Hombre shows masculine + unisex and never a feminine product", async () => {
    expect(await slugs(CAT.hombre)).toEqual([
      "arabian-sky",
      "black-opium",
      "dunscape",
      "khamrah",
      "sauvage",
    ]);
  });

  it("Unisex shows unisex products only", async () => {
    expect(await slugs(CAT.unisex)).toEqual(["black-opium", "khamrah"]);
  });

  it("a stale gender category row no longer leaks a product into the wrong filter", async () => {
    // The reported bug: masculine products with a leftover Unisex row.
    const mujer = await slugs(CAT.mujer);
    expect(mujer).not.toContain("dunscape");
    expect(mujer).not.toContain("arabian-sky");
    // …and the reverse: a feminine product with a leftover Hombre row.
    expect(await slugs(CAT.hombre)).not.toContain("hawas-diva");
  });

  it("filters the gender column directly, without joining categories", async () => {
    await getCatalogPage(1, { category: CAT.mujer });

    const calls = productCalls();
    expect(calls).toContainEqual({
      table: "products",
      method: "in",
      args: ["gender", ["feminine", "unisex"]],
    });
    expect(calls.some((c) => c.method === "in" && c.args[0] === "categories.id")).toBe(false);
    const select = String(calls.find((c) => c.method === "select")?.args[0]);
    expect(select).not.toContain("categories!inner");
  });

  it("resolves the gender ids by slug at request time (old UUID links keep working)", async () => {
    await getCatalogPage(1, { category: CAT.hombre });

    expect(db.calls).toContainEqual({
      table: "categories",
      method: "in",
      args: ["slug", ["hombre", "mujer", "unisex"]],
    });
  });

  it("skips the gender lookup entirely when no category is selected", async () => {
    await getCatalogPage(1, {});

    expect(db.calls.some((c) => c.table === "categories")).toBe(false);
    expect(productCalls().some((c) => c.method === "in" && c.args[0] === "gender")).toBe(false);
  });

  it("a failed gender lookup shows nothing rather than the wrong gender", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    db.failTable = "categories";

    // Falls back to an association filter on the gender id; with gender rows
    // gone (or stale) that can only under-match.
    const result = await getCatalogPage(1, { category: CAT.mujer });
    expect(result.products.map((p) => p.slug)).toEqual(["black-opium"]);
    expect(productCalls().some((c) => c.method === "in" && c.args[0] === "gender")).toBe(false);
    consoleError.mockRestore();
  });
});

describe("commercial category filters are unchanged", () => {
  it("Árabe filters by its association rows, inner-joined", async () => {
    expect(await slugs(CAT.arabe)).toEqual(["arabian-sky", "hawas-diva", "khamrah", "yara"]);

    const select = String(productCalls().find((c) => c.method === "select")?.args[0]);
    expect(select).toContain("categories!inner");
    expect(productCalls().some((c) => c.method === "in" && c.args[0] === "gender")).toBe(false);
  });

  it("Nicho returns only its own products", async () => {
    expect(await slugs(CAT.nicho)).toEqual(["khamrah"]);
  });
});

describe("pagination and combined filters", () => {
  it("paginates a gender filter with an exact total", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      product(`f${String(i).padStart(2, "0")}`, i % 5 === 0 ? "masculine" : "feminine")
    );
    seed(many);

    // 20 feminine (every 5th of the 25 is masculine) + 10 unisex = 30 matches.
    seed([...many, ...Array.from({ length: 10 }, (_, i) => product(`u${i}`, "unisex"))]);
    const size = PRODUCTS_PAGE_SIZE;

    const first = await getCatalogPage(1, { category: CAT.mujer });
    expect(first.totalProducts).toBe(30);
    expect(first.totalPages).toBe(Math.ceil(30 / size));
    expect(first.products).toHaveLength(size);

    const second = await getCatalogPage(2, { category: CAT.mujer });
    expect(second.currentPage).toBe(2);
    expect(second.products).toHaveLength(Math.min(size, 30 - size));
    expect(productCalls()).toContainEqual({
      table: "products",
      method: "range",
      args: [size, 2 * size - 1],
    });
    // No page repeats a product, and no masculine product appears on any page.
    const all = [...first.products, ...second.products];
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    expect(all.every((p) => p.gender !== "masculine")).toBe(true);
  });

  it("ANDs a gender filter with the offer filter", async () => {
    db.tables.product_variants = [
      { product_id: "dunscape", is_on_offer: true, is_active: true },
      { product_id: "yara", is_on_offer: true, is_active: true },
    ];

    const result = await getCatalogPage(1, { category: CAT.mujer, onOffer: true });

    expect(result.products.map((p) => p.slug)).toEqual(["yara"]);
  });

  it("ANDs a gender filter with the search hits", async () => {
    const { supabase } = await import("@/lib/supabase/client");
    vi.mocked(supabase.rpc).mockResolvedValueOnce({
      data: [{ id: "khamrah" }, { id: "sauvage" }],
      error: null,
    } as never);

    const result = await getCatalogPage(1, { category: CAT.mujer, query: "a" });

    expect(result.products.map((p) => p.slug)).toEqual(["khamrah"]);
  });

  it("the homepage teaser (getProductsPage) is unaffected by gender rules", async () => {
    const page = await getProductsPage(0, 3);

    expect(page.items).toHaveLength(3);
    expect(page.total).toBe(FIXTURE.length);
    expect(page.nextPage).toBe(1);
  });
});
