import { describe, it, expect, vi, beforeEach } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Chainable PostgREST stub: records every builder call and resolves the final
 * `.range()` with whatever the test queued.
 */
const { state } = vi.hoisted(() => ({
  state: {
    calls: [] as { method: string; args: unknown[] }[],
    result: { data: [] as unknown[], error: null as any, count: 0 as number | null },
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const builder: any = {};
    for (const method of ["select", "in", "or", "order"]) {
      builder[method] = (...args: unknown[]) => {
        state.calls.push({ method, args });
        return builder;
      };
    }
    builder.range = async (...args: unknown[]) => {
      state.calls.push({ method: "range", args });
      return state.result;
    };
    return {
      from: (table: string) => {
        state.calls.push({ method: "from", args: [table] });
        return builder;
      },
    };
  },
}));

import { CUSTOMERS_PAGE_SIZE, getCustomersAdminPage } from "./getCustomersAdminPage";

const call = (method: string) => state.calls.find((c) => c.method === method);

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "u-1",
    full_name: "Aurora Vega",
    username: "aurora",
    avatar_url: null,
    phone: "8888-8888",
    role: "customer",
    experience_points: 0,
    created_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

describe("getCustomersAdminPage", () => {
  beforeEach(() => {
    state.calls = [];
    state.result = { data: [], error: null, count: 0 };
  });

  it("pages 16 customers at a time", () => {
    expect(CUSTOMERS_PAGE_SIZE).toBe(16);
  });

  it("fetches only the requested window from profiles", async () => {
    state.result = { data: [], error: null, count: 100 };

    await getCustomersAdminPage(3);

    expect(call("from")?.args).toEqual(["profiles"]);
    // Page 3 of 16 → rows 32..47 (inclusive range).
    expect(call("range")?.args).toEqual([32, 47]);
    expect(call("select")?.args[1]).toEqual({ count: "exact" });
  });

  it("lists customer and wholesale accounts, never admins", async () => {
    await getCustomersAdminPage(1);

    expect(call("in")?.args).toEqual(["role", ["customer", "wholesale"]]);
  });

  it("derives the rank from XP on the same row (no extra queries)", async () => {
    state.result = {
      data: [profile({ experience_points: 5_200 }), profile({ id: "u-2", experience_points: 0 })],
      error: null,
      count: 2,
    };

    const { rows } = await getCustomersAdminPage(1);

    expect(rows.map((r) => r.rank)).toEqual(["Conocedor", "Aficionado"]);
    expect(state.calls.filter((c) => c.method === "from")).toHaveLength(1);
  });

  it("returns the counters for the pager", async () => {
    state.result = { data: [profile()], error: null, count: 33 };

    const page = await getCustomersAdminPage(2);

    expect(page).toMatchObject({
      total: 33,
      currentPage: 2,
      totalPages: 3,
      pageSize: 16,
      error: false,
      outOfRange: false,
    });
  });

  it("treats a bad page number as page 1", async () => {
    await getCustomersAdminPage(Number.NaN);
    expect(call("range")?.args).toEqual([0, 15]);
  });

  it("searches name and username with PostgREST syntax stripped", async () => {
    await getCustomersAdminPage(1, " ana,(x)* ");

    expect(call("or")?.args).toEqual(["full_name.ilike.*anax*,username.ilike.*anax*"]);
  });

  it("skips the search filter for a blank term", async () => {
    await getCustomersAdminPage(1, "   ");
    expect(call("or")).toBeUndefined();
  });

  it("flags a failed query as an error, not an empty list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.result = { data: null as never, error: { message: "boom", code: "XX000" }, count: null };

    const page = await getCustomersAdminPage(1);

    expect(page).toMatchObject({ rows: [], error: true, outOfRange: false });
  });

  it("flags a page past the end so the route can redirect", async () => {
    state.result = {
      data: null as never,
      error: { message: "Requested range not satisfiable", code: "PGRST103" },
      count: null,
    };

    const page = await getCustomersAdminPage(99);

    expect(page).toMatchObject({ rows: [], error: false, outOfRange: true });
  });
});
