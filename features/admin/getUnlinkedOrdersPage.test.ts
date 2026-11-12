import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: rpcMock }),
}));

import { getUnlinkedOrdersPage } from "./getUnlinkedOrdersPage";

const row = (n: number, total = 45) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  order_number: 1000 + n,
  customer_name: `Cliente ${n}`,
  customer_email: null,
  customer_phone: "8888-1234",
  subtotal: "10000.00",
  discount: "0.00",
  shipping_cost: "0.00",
  total: "10000.00",
  order_status: "shipped",
  payment_status: "paid",
  payment_provider: null,
  source: "admin",
  created_at: "2026-01-01T00:00:00Z",
  total_count: total,
});

beforeEach(() => {
  rpcMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getUnlinkedOrdersPage", () => {
  it("asks the RPC for one page and passes filters, mapping 'all' to no filter", async () => {
    rpcMock.mockResolvedValue({ data: [row(1)], error: null });

    await getUnlinkedOrdersPage(3, { search: "  8888-1234 ", orderStatus: "shipped", paymentStatus: "all" });

    expect(rpcMock).toHaveBeenCalledWith("admin_list_unlinked_orders", {
      p_search: "8888-1234",
      p_order_status: "shipped",
      p_payment_status: null,
      p_limit: 20,
      p_offset: 40,
    });
  });

  it("reads the total from total_count and paginates from it", async () => {
    rpcMock.mockResolvedValue({ data: [row(1), row(2)], error: null });
    const page = await getUnlinkedOrdersPage(1);
    expect(page).toMatchObject({ total: 45, totalPages: 3, currentPage: 1, error: null });
    expect(page.rows[0].total).toBe(10_000);
  });

  it("detects a page past the end", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(await getUnlinkedOrdersPage(4)).toMatchObject({ outOfRange: true, rows: [] });
    expect(await getUnlinkedOrdersPage(1)).toMatchObject({ outOfRange: false, total: 0 });
  });

  it("never throws: an RPC failure becomes a readable error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function public.admin_list_unlinked_orders" },
    });
    const page = await getUnlinkedOrdersPage(1);
    expect(page.rows).toEqual([]);
    expect(page.error).toMatch(/20261110000200/);
  });
});
