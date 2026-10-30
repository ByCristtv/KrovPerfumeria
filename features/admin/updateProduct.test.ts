import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The product edit form saves a FULL variant row. These tests pin that a normal
 * edit never writes the supplier columns: supplier availability is recorded only
 * by the dedicated action (app/admin/products/actions.ts), so saving the form can
 * neither flip nor un-verify it - the same reason the form is not where it lives.
 */
const { fromMock, writes } = vi.hoisted(() => {
  const writes: Array<{ table: string; op: string; row?: Record<string, unknown> }> = [];
  return {
    writes,
    fromMock: vi.fn((table: string) => ({
      update: (row: Record<string, unknown>) => {
        writes.push({ table, op: "update", row });
        return { eq: async () => ({ error: null }) };
      },
      delete: () => {
        writes.push({ table, op: "delete" });
        return { eq: async () => ({ error: null }) };
      },
      insert: async (row: unknown) => {
        writes.push({ table, op: "insert", row: row as Record<string, unknown> });
        return { error: null };
      },
    })),
  };
});
vi.mock("@/lib/supabase/client", () => ({ supabase: { from: fromMock } }));

import { updateProduct, type UpdateProductPayload } from "./updateProduct";

const payload: UpdateProductPayload = {
  product_id: "p-1",
  variant_id: "v-1",
  name: "Lion",
  brand_id: "b-1",
  description: "d",
  notes_top: "",
  notes_middle: "",
  notes_base: "",
  gender: "masculine",
  concentration: "EDP",
  category_ids: ["c-1"],
  sku: "KRV-1",
  price: 21_000,
  stock: 4,
  size_ml: 100,
  product_type: "full_size",
  is_on_offer: false,
  offer_price: null,
  is_active: true,
  wholesale_price: null,
  min_wholesale_quantity: null,
};

const variantUpdate = () =>
  writes.find((w) => w.table === "product_variants" && w.op === "update")!;

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
});

describe("updateProduct and supplier availability", () => {
  it("does not write supplier_available or supplier_checked_at", async () => {
    await updateProduct(payload);

    const columns = Object.keys(variantUpdate().row!);
    expect(columns).not.toContain("supplier_available");
    expect(columns).not.toContain("supplier_checked_at");
  });

  it("still ignores them if a caller spreads extra fields in (e.g. a hydrated form)", async () => {
    // The edit form builds its payload with `...form`; a future field named like
    // a supplier column must not leak through into the UPDATE.
    await updateProduct({
      ...payload,
      supplier_available: true,
      supplier_checked_at: "2020-01-01T00:00:00Z",
    } as UpdateProductPayload);

    const columns = Object.keys(variantUpdate().row!);
    expect(columns).not.toContain("supplier_available");
    expect(columns).not.toContain("supplier_checked_at");
  });

  it("keeps saving the commercial fields it always saved", async () => {
    await updateProduct(payload);

    expect(variantUpdate().row).toMatchObject({
      sku: "KRV-1",
      price: 21_000,
      stock: 4,
      size_ml: 100,
      product_type: "full_size",
      is_active: true,
    });
  });
});
