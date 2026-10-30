import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { setSupplierAvailabilityAction } from "./actions";

const VARIANT = "33333333-3333-4333-8333-333333333333";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "11111111-1111-4111-8111-111111111111";

interface MockOptions {
  user?: { id: string } | null;
  role?: string | null;
  /** What `.update(...).eq(...).select(...).maybeSingle()` resolves to. */
  update?: { data: unknown; error: { message: string; code?: string } | null };
}

/**
 * A recording stand-in for the request-bound server client. It only models the
 * exact call shapes the action uses, so an unexpected query (a second table, a
 * direct stock write) fails loudly instead of silently passing.
 */
function makeClient(options: MockOptions = {}) {
  const updates: Array<{ table: string; row: Record<string, unknown> }> = [];
  const filters: Array<[string, unknown]> = [];
  const tables: string[] = [];

  const result = options.update ?? {
    data: {
      id: VARIANT,
      supplier_available: true,
      supplier_checked_at: "2026-10-29T12:00:00.000Z",
    },
    error: null,
  };

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.user === undefined ? { id: ADMIN } : options.user },
      }),
    },
    from: vi.fn((table: string) => {
      tables.push(table);
      if (table === "profiles") {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.single = async () => ({
          data: options.role === null ? null : { role: options.role ?? "admin" },
          error: null,
        });
        return b;
      }
      return {
        update: (row: Record<string, unknown>) => {
          updates.push({ table, row });
          const b: Record<string, unknown> = {};
          b.eq = (column: string, value: unknown) => {
            filters.push([column, value]);
            return b;
          };
          b.select = () => b;
          b.maybeSingle = async () => result;
          return b;
        },
      };
    }),
  };

  return { client, updates, filters, tables };
}

function arrange(options?: MockOptions) {
  const mock = makeClient(options);
  createClientMock.mockResolvedValue(mock.client);
  return mock;
}

describe("setSupplierAvailabilityAction", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  // ── untrusted arguments ───────────────────────────────────────────────────
  describe("argument validation (a server action can be POSTed directly)", () => {
    it.each([["not-a-uuid"], [""], ["33333333-3333-4333-8333-33333333333"], ["'; drop table x;--"]])(
      "rejects the variant id %j before touching the database",
      async (id) => {
        const res = await setSupplierAvailabilityAction(id, true);

        expect(res.ok).toBe(false);
        expect(res.message).toMatch(/variante inválida/i);
        expect(createClientMock).not.toHaveBeenCalled();
      }
    );

    it.each([[undefined], [null], [{}]])(
      "rejects a non-string variant id (%j)",
      async (id) => {
        const res = await setSupplierAvailabilityAction(id as unknown as string, true);
        expect(res.ok).toBe(false);
        expect(createClientMock).not.toHaveBeenCalled();
      }
    );

    it.each([["true"], ["false"], [1], [0], [null], [undefined], [{}], [[]]])(
      "accepts only a real boolean, never %j",
      async (value) => {
        const res = await setSupplierAvailabilityAction(VARIANT, value as unknown as boolean);

        expect(res.ok).toBe(false);
        expect(res.message).toMatch(/inválido/i);
        expect(createClientMock).not.toHaveBeenCalled();
      }
    );
  });

  // ── authorization ─────────────────────────────────────────────────────────
  describe("authorization", () => {
    it("refuses an anonymous caller without writing", async () => {
      const mock = arrange({ user: null });

      const res = await setSupplierAvailabilityAction(VARIANT, true);

      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/sesión/i);
      expect(mock.updates).toEqual([]);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it.each(["customer", "wholesale", "", null])(
      "refuses a %j caller without writing - customers cannot change supplier availability",
      async (role) => {
        const mock = arrange({ user: { id: CUSTOMER }, role });

        const res = await setSupplierAvailabilityAction(VARIANT, true);

        expect(res.ok).toBe(false);
        expect(res.message).toMatch(/permiso/i);
        expect(mock.updates).toEqual([]);
        expect(mock.tables).not.toContain("product_variants");
        expect(revalidatePathMock).not.toHaveBeenCalled();
      }
    );

    it("treats a write that RLS filtered to zero rows as a FAILURE, not a success", async () => {
      // A caller who passes the role check here but is refused by the database
      // (is_admin() is the real gate) matches no rows - PostgREST returns no error.
      const mock = arrange({ update: { data: null, error: null } });

      const res = await setSupplierAvailabilityAction(VARIANT, true);

      expect(mock.updates).toHaveLength(1);
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/no se encontró|permiso/i);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });

  // ── what gets written ─────────────────────────────────────────────────────
  describe("the write", () => {
    it("sets the flag and stamps the check time on the right variant, and nothing else", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-29T15:30:00.000Z"));
      const mock = arrange();

      const res = await setSupplierAvailabilityAction(VARIANT, true);

      expect(res.ok).toBe(true);
      expect(mock.updates).toEqual([
        {
          table: "product_variants",
          row: {
            supplier_available: true,
            supplier_checked_at: "2026-10-29T15:30:00.000Z",
          },
        },
      ]);
      expect(mock.filters).toEqual([["id", VARIANT]]);
    });

    it("records 'sold out at the supplier' just as firmly as 'available'", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-29T15:30:00.000Z"));
      const mock = arrange({
        update: {
          data: { id: VARIANT, supplier_available: false, supplier_checked_at: "2026-10-29T15:30:00.000Z" },
          error: null,
        },
      });

      const res = await setSupplierAvailabilityAction(VARIANT, false);

      expect(res.ok).toBe(true);
      expect(mock.updates[0].row).toEqual({
        supplier_available: false,
        supplier_checked_at: "2026-10-29T15:30:00.000Z",
      });
      expect(res.message).toMatch(/agotado/i);
    });

    it.each([true, false])(
      "never writes KROV's physical stock (or any other column) - available=%s",
      async (available) => {
        const mock = arrange();

        await setSupplierAvailabilityAction(VARIANT, available);

        const written = Object.keys(mock.updates[0].row).sort();
        expect(written).toEqual(["supplier_available", "supplier_checked_at"]);
        for (const forbidden of ["stock", "price", "is_active", "product_type", "offer_price"]) {
          expect(written).not.toContain(forbidden);
        }
      }
    );

    it("touches only product_variants (after the role lookup), never stock_movements or orders", async () => {
      const mock = arrange();

      await setSupplierAvailabilityAction(VARIANT, true);

      expect(mock.tables).toEqual(["profiles", "product_variants"]);
    });

    it("re-sending the current value is allowed and re-stamps the time (Reconfirmar)", async () => {
      vi.useFakeTimers();
      const mock = arrange();

      vi.setSystemTime(new Date("2026-10-20T10:00:00.000Z"));
      await setSupplierAvailabilityAction(VARIANT, true);
      vi.setSystemTime(new Date("2026-10-29T10:00:00.000Z"));
      await setSupplierAvailabilityAction(VARIANT, true);

      expect(mock.updates.map((u) => u.row.supplier_checked_at)).toEqual([
        "2026-10-20T10:00:00.000Z",
        "2026-10-29T10:00:00.000Z",
      ]);
    });

    it("returns what the database stored, not what was asked for", async () => {
      arrange({
        update: {
          data: { id: VARIANT, supplier_available: false, supplier_checked_at: "2026-10-29T12:00:00.000Z" },
          error: null,
        },
      });

      const res = await setSupplierAvailabilityAction(VARIANT, true);

      expect(res.data).toEqual({
        variant_id: VARIANT,
        supplier_available: false,
        supplier_checked_at: "2026-10-29T12:00:00.000Z",
      });
    });
  });

  // ── cache invalidation ────────────────────────────────────────────────────
  describe("revalidation", () => {
    it("refreshes the admin table and the one cached public page (home)", async () => {
      arrange();

      await setSupplierAvailabilityAction(VARIANT, true);

      expect(revalidatePathMock).toHaveBeenCalledWith("/admin/products");
      expect(revalidatePathMock).toHaveBeenCalledWith("/");
      expect(revalidatePathMock).toHaveBeenCalledTimes(2);
    });
  });

  // ── database errors ───────────────────────────────────────────────────────
  describe("error mapping (nothing is revalidated on failure)", () => {
    const fail = (error: { message: string; code?: string }) =>
      arrange({ update: { data: null, error } });

    it("explains why a decant cannot be flagged (check_violation 23514)", async () => {
      fail({
        code: "23514",
        message:
          'new row for relation "product_variants" violates check constraint "chk_decant_not_supplier_available"',
      });

      const res = await setSupplierAvailabilityAction(VARIANT, true);

      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/decants/i);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("recognises the decant constraint by name even without a code", async () => {
      fail({ message: "violates check constraint chk_decant_not_supplier_available" });
      expect((await setSupplierAvailabilityAction(VARIANT, true)).message).toMatch(/decants/i);
    });

    it("maps insufficient_privilege to a permission message", async () => {
      fail({ code: "42501", message: "permission denied for table product_variants" });

      const res = await setSupplierAvailabilityAction(VARIANT, true);

      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/permiso/i);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it.each([
      [{ code: "42703", message: "column product_variants.supplier_available does not exist" }],
      [{ message: "Could not find the 'supplier_available' column of 'product_variants' in the schema cache" }],
    ])("tells the admin the migration is pending (%j)", async (error) => {
      fail(error);

      const res = await setSupplierAvailabilityAction(VARIANT, true);

      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/migración/i);
      expect(res.message).toContain("20261029000100");
    });

    it("hides an unexpected database error behind a generic message and logs it", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      fail({ code: "XX000", message: "internal: secret detail" });

      const res = await setSupplierAvailabilityAction(VARIANT, true);

      expect(res.ok).toBe(false);
      expect(res.message).not.toContain("secret detail");
      expect(log).toHaveBeenCalled();
      expect(revalidatePathMock).not.toHaveBeenCalled();
      log.mockRestore();
    });
  });
});
