import { describe, it, expect, vi, beforeEach } from "vitest";

const { createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

import { revalidateHomepageOffersAction } from "./actions";

const PRODUCT = "44444444-4444-4444-8444-444444444444";
const ADMIN = "22222222-2222-4222-8222-222222222222";

interface MockOptions {
  user?: { id: string } | null;
  role?: string | null;
  /** What the on-offer variant check resolves to. */
  offers?: { data: unknown; error: { message: string } | null };
}

/** Request-bound server client stand-in; records the offer check's filters. */
function arrange(options: MockOptions = {}) {
  const filters: [string, unknown][] = [];
  const tables: string[] = [];

  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.user === undefined ? { id: ADMIN } : options.user },
      }),
    },
    from: vi.fn((table: string) => {
      tables.push(table);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      if (table === "profiles") {
        b.eq = () => b;
        b.single = async () => ({
          data: options.role === null ? null : { role: options.role ?? "admin" },
          error: null,
        });
        return b;
      }
      b.eq = (column: string, value: unknown) => {
        filters.push([column, value]);
        return b;
      };
      b.limit = async () => options.offers ?? { data: [{ id: "v-1" }], error: null };
      return b;
    }),
  };

  createClientMock.mockResolvedValue(client);
  return { filters, tables };
}

describe("revalidateHomepageOffersAction", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("untrusted input (a server action can be POSTed directly)", () => {
    it.each([
      [null],
      ["offers"],
      [{ scope: "everything" }],
      [{ scope: "product" }],
      [{ scope: "product", productId: "'; drop table x;--" }],
    ])("rejects %j before touching the database or the cache", async (change) => {
      const res = await revalidateHomepageOffersAction(change as never);

      expect(res.ok).toBe(false);
      expect(createClientMock).not.toHaveBeenCalled();
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });

  describe("authorization", () => {
    it("refuses an anonymous caller", async () => {
      arrange({ user: null });

      const res = await revalidateHomepageOffersAction({ scope: "offers" });

      expect(res.ok).toBe(false);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });

    it("refuses a non-admin", async () => {
      arrange({ role: "customer" });

      const res = await revalidateHomepageOffersAction({ scope: "offers" });

      expect(res.ok).toBe(false);
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });

  it("an eligibility change revalidates the homepage — and only the homepage", async () => {
    const { tables } = arrange();

    const res = await revalidateHomepageOffersAction({ scope: "offers" });

    expect(res).toMatchObject({ ok: true, data: { revalidated: true } });
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    // Unconditional: no offer lookup (the write may have removed the slide).
    expect(tables).not.toContain("product_variants");
  });

  it("a display change on a product with an active offer revalidates", async () => {
    const { filters } = arrange({ offers: { data: [{ id: "v-1" }], error: null } });

    const res = await revalidateHomepageOffersAction({ scope: "product", productId: PRODUCT });

    expect(res.data?.revalidated).toBe(true);
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(filters).toEqual([
      ["product_id", PRODUCT],
      ["is_on_offer", true],
      ["is_active", true],
    ]);
  });

  it("a display change on a product with no offer does NOT regenerate the homepage", async () => {
    arrange({ offers: { data: [], error: null } });

    const res = await revalidateHomepageOffersAction({ scope: "product", productId: PRODUCT });

    expect(res).toMatchObject({ ok: true, data: { revalidated: false } });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("revalidates anyway when the offer check fails (stale hero is the worse outcome)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    arrange({ offers: { data: null, error: { message: "boom" } } });

    const res = await revalidateHomepageOffersAction({ scope: "product", productId: PRODUCT });

    expect(res.data?.revalidated).toBe(true);
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    consoleError.mockRestore();
  });
});
