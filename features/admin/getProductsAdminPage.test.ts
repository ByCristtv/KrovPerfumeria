import { describe, it, expect, vi, beforeEach } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

// `createClient` is the request-bound SERVER client (it reads cookies), so the
// module is replaced wholesale rather than stubbing a transport underneath it.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: rpcMock }),
}));

import { getProductsAdminPage } from "./getProductsAdminPage";
import { ADMIN_PAGE_SIZE } from "@/lib/pagination";

/** One raw row as `admin_list_product_variants` returns it. */
function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    variant_id: "v-1",
    product_id: "p-1",
    sku: "SKU-1",
    size_ml: 100,
    product_type: "full_size",
    price: 25000,
    stock: 4,
    is_on_offer: false,
    offer_price: null,
    is_active: true,
    wholesale_price: null,
    min_wholesale_quantity: null,
    name: "Sauvage",
    description: "desc",
    brand: "Dior",
    categories: [{ id: "c-1", name: "Hombre" }],
    image_url: "https://cdn/sauvage.jpg",
    total_count: 1,
    ...overrides,
  };
}

describe("getProductsAdminPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks the RPC for the requested window", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await getProductsAdminPage(3, "dior");

    expect(rpcMock).toHaveBeenCalledWith("admin_list_product_variants", {
      p_search: "dior",
      p_limit: ADMIN_PAGE_SIZE,
      p_offset: 2 * ADMIN_PAGE_SIZE,
    });
  });

  it("drops a blank search rather than sending an empty filter", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    await getProductsAdminPage(1, "   ");

    expect(rpcMock).toHaveBeenCalledWith(
      "admin_list_product_variants",
      expect.objectContaining({ p_search: undefined })
    );
  });

  // ── Task 2: thumbnail ────────────────────────────────────────────────────
  describe("thumbnail", () => {
    it("maps the RPC's image_url onto the row", async () => {
      rpcMock.mockResolvedValue({ data: [rawRow()], error: null });

      const { rows } = await getProductsAdminPage(1);

      expect(rows[0].image_url).toBe("https://cdn/sauvage.jpg");
    });

    it("maps a product with no images to null", async () => {
      rpcMock.mockResolvedValue({
        data: [rawRow({ image_url: null })],
        error: null,
      });

      const { rows } = await getProductsAdminPage(1);

      expect(rows[0].image_url).toBeNull();
    });

    it("degrades to null when the RPC predates the migration", async () => {
      // Migrations are applied by hand here, so the deployed app can run ahead
      // of the database. A missing column must render a placeholder, not crash.
      const withoutColumn: Record<string, unknown> = rawRow();
      delete withoutColumn.image_url;
      rpcMock.mockResolvedValue({ data: [withoutColumn], error: null });

      const { rows } = await getProductsAdminPage(1);

      expect(rows[0].image_url).toBeNull();
      expect(rows[0].sku).toBe("SKU-1");
    });
  });

  // ── Task 2: ordering ─────────────────────────────────────────────────────
  describe("ordering", () => {
    it("returns active variants before inactive ones", async () => {
      rpcMock.mockResolvedValue({
        data: [
          rawRow({ variant_id: "off-1", sku: "OFF-1", is_active: false, total_count: 4 }),
          rawRow({ variant_id: "on-1", sku: "ON-1", is_active: true, total_count: 4 }),
          rawRow({ variant_id: "off-2", sku: "OFF-2", is_active: false, total_count: 4 }),
          rawRow({ variant_id: "on-2", sku: "ON-2", is_active: true, total_count: 4 }),
        ],
        error: null,
      });

      const { rows } = await getProductsAdminPage(1);

      expect(rows.map((r) => r.sku)).toEqual(["ON-1", "ON-2", "OFF-1", "OFF-2"]);
    });

    it("keeps the RPC's own ordering inside each status group", async () => {
      rpcMock.mockResolvedValue({
        data: [
          rawRow({ variant_id: "a", sku: "NEWEST", is_active: true, total_count: 3 }),
          rawRow({ variant_id: "b", sku: "OLDER", is_active: true, total_count: 3 }),
          rawRow({ variant_id: "c", sku: "OLDEST", is_active: true, total_count: 3 }),
        ],
        error: null,
      });

      const { rows } = await getProductsAdminPage(1);

      expect(rows.map((r) => r.sku)).toEqual(["NEWEST", "OLDER", "OLDEST"]);
    });
  });

  it("reads the exact total from the window function column", async () => {
    rpcMock.mockResolvedValue({
      data: [rawRow({ total_count: 57 })],
      error: null,
    });

    const { total, totalPages } = await getProductsAdminPage(1);

    expect(total).toBe(57);
    expect(totalPages).toBe(Math.ceil(57 / ADMIN_PAGE_SIZE));
  });

  it("coerces the nullable RPC columns to safe defaults", async () => {
    rpcMock.mockResolvedValue({
      data: [
        rawRow({
          price: null,
          stock: null,
          is_on_offer: null,
          is_active: null,
          name: null,
          brand: null,
          categories: null,
        }),
      ],
      error: null,
    });

    const { rows } = await getProductsAdminPage(1);

    expect(rows[0]).toMatchObject({
      price: 0,
      stock: 0,
      is_on_offer: false,
      is_active: false,
      name: "Sin nombre",
      brand: "Sin marca",
      categories: [],
    });
  });

  it("returns an empty first page when the RPC errors, without throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Insufficient privilege: admin only." },
    });

    const result = await getProductsAdminPage(2, "dior");

    expect(result).toEqual({
      rows: [],
      total: 0,
      currentPage: 1,
      totalPages: 1,
      pageSize: ADMIN_PAGE_SIZE,
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("treats a null payload as an empty page", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const { rows, total } = await getProductsAdminPage(1);

    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });
});
