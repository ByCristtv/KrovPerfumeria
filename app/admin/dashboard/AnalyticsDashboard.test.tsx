import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { formatPrice } from "@/lib/format";

/**
 * Sales section, end to end in the browser layer: picker → resolved range →
 * both RPCs → KPI cards + best sellers. The Supabase client is replaced by a
 * FAKE SERVER that applies the same rules as analytics_countable_orders
 * (non-denied, created_at in [p_from, p_to), null = unbounded) to a fixture
 * spread over several months and statuses.
 *
 * The fake deliberately reproduces the OLD SQL behaviour for an omitted bound
 * (p_from missing → now() - 30 days). Any regression where the client stops
 * sending explicit nulls for "Todo" shows up here as the original bug.
 */

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc: rpcMock } }));
// Stock alerts are "now", independent of the period, and have their own data.
vi.mock("./LowStockTable", () => ({ default: () => null }));

import AnalyticsDashboard from "./AnalyticsDashboard";

const NOW = new Date("2026-11-14T18:00:00.000Z"); // 12:00 Costa Rica
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

interface FixtureOrder {
  sku: string;
  at: string;
  status: "pending" | "received" | "shipped" | "denied";
  total: number;
  units: number;
}

// Totals by period (non-denied only):
//   7d   o1                 → 1 order,       ₡10 000
//   30d  o1 o2              → 2 orders,      ₡30 000
//   90d  o1–o6              → 6 orders,     ₡630 000
//   all  o1–o7              → 7 orders,   ₡1 270 000
//   Sep 1 → Oct 1 (custom)  o3 o4 → 2 orders, ₡120 000, 4 units
const FIXTURE: FixtureOrder[] = [
  { sku: "SKU-1", at: ago(2), status: "shipped", total: 10000, units: 1 },
  { sku: "SKU-2", at: ago(15), status: "received", total: 20000, units: 2 },
  { sku: "SKU-3", at: "2026-09-01T00:00:00.000-06:00", status: "shipped", total: 40000, units: 1 }, // custom start
  { sku: "SKU-4", at: "2026-10-01T23:59:59.999-06:00", status: "pending", total: 80000, units: 3 }, // custom end, late
  { sku: "SKU-5", at: "2026-08-31T23:59:59.999-06:00", status: "shipped", total: 160000, units: 1 }, // just before
  { sku: "SKU-6", at: "2026-10-02T00:00:00.000-06:00", status: "shipped", total: 320000, units: 1 }, // just after
  { sku: "SKU-7", at: ago(166), status: "shipped", total: 640000, units: 4 }, // > 90 days
  { sku: "SKU-8", at: ago(25), status: "denied", total: 1280000, units: 5 }, // never counts
];

type Args = { p_from?: string | null; p_to?: string | null; p_limit?: number };

function countable(orders: FixtureOrder[], args: Args): FixtureOrder[] {
  // OLD SQL default for an omitted bound — the production bug.
  const from = "p_from" in args ? args.p_from : ago(30);
  const to = args.p_to ?? null;
  return orders.filter((o) => {
    if (o.status === "denied") return false;
    const t = new Date(o.at).getTime();
    return (!from || t >= new Date(from).getTime()) && (!to || t < new Date(to).getTime());
  });
}

function fakeServer(orders: FixtureOrder[]) {
  return async (fn: string, args: Args) => {
    const rows = countable(orders, args);
    if (fn === "analytics_sales_summary") {
      const revenue = rows.reduce((s, o) => s + o.total, 0);
      return {
        data: [
          {
            total_orders: rows.length,
            gross_revenue: revenue,
            total_units: rows.reduce((s, o) => s + o.units, 0),
            avg_order_value: rows.length ? revenue / rows.length : 0,
          },
        ],
        error: null,
      };
    }
    if (fn === "analytics_sales_best_sellers") {
      const bySku = new Map<string, { units: number; revenue: number }>();
      for (const o of rows) {
        const cur = bySku.get(o.sku) ?? { units: 0, revenue: 0 };
        bySku.set(o.sku, { units: cur.units + o.units, revenue: cur.revenue + o.total });
      }
      const data = [...bySku.entries()]
        .map(([sku, v]) => ({
          variant_id: sku,
          product_name: `Perfume ${sku}`,
          brand_name: "Krov",
          product_type: "full_size" as const,
          size_ml: 100,
          sku,
          total_units: v.units,
          total_revenue: v.revenue,
        }))
        .sort((a, b) => b.total_units - a.total_units || b.total_revenue - a.total_revenue)
        .slice(0, args.p_limit ?? 10);
      return { data, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsDashboard />
    </QueryClientProvider>
  );
}

function kpi(label: string): string {
  const card = screen.getByText(label, { selector: "p" }).parentElement!;
  return card.querySelectorAll("p")[1]?.textContent ?? "";
}

async function expectKpis(revenue: number, orders: number) {
  await waitFor(() => {
    expect(kpi("Ingresos")).toBe(formatPrice(revenue));
    expect(kpi("Pedidos")).toBe(orders.toLocaleString("es-CR"));
  });
}

function bestSellerSkus(): string[] {
  const table = screen.queryByRole("table");
  if (!table) return [];
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent?.match(/SKU-\d+/)?.[0] ?? "");
}

function salesCalls() {
  return rpcMock.mock.calls.filter(([fn]) => String(fn).startsWith("analytics_sales_"));
}

function openCustom() {
  fireEvent.click(screen.getByRole("button", { name: "Rango personalizado" }));
  return {
    start: screen.getByLabelText("Desde") as HTMLInputElement,
    end: screen.getByLabelText("Hasta (incluido)") as HTMLInputElement,
    apply: screen.getByRole("button", { name: "Aplicar" }),
  };
}

describe("Sales dashboard date ranges", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    rpcMock.mockReset();
    rpcMock.mockImplementation(fakeServer(FIXTURE));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the last 30 days", async () => {
    renderDashboard();
    await expectKpis(30000, 2);
    expect(screen.getByTestId("sales-period").textContent).toBe("Últimos 30 días");
  });

  it("'Todo' includes orders older than 90 days and is never below 90 días", async () => {
    renderDashboard();
    await expectKpis(30000, 2);

    fireEvent.click(screen.getByRole("button", { name: "90 días" }));
    await expectKpis(630000, 6);

    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    await expectKpis(1270000, 7); // + SKU-7 (166 days old); denied SKU-8 excluded
    await waitFor(() => expect(bestSellerSkus()).toContain("SKU-7"));
    expect(bestSellerSkus()).not.toContain("SKU-8");

    // Both RPCs were asked for the whole history EXPLICITLY.
    const last = salesCalls().slice(-2).map(([, args]) => args);
    for (const args of last) {
      expect(args).toHaveProperty("p_from", null);
      expect(args).toHaveProperty("p_to", null);
    }
  });

  it.each([
    ["7 días", 10000, 1, ["SKU-1"]],
    ["30 días", 30000, 2, ["SKU-2", "SKU-1"]],
    ["90 días", 630000, 6, ["SKU-4", "SKU-2", "SKU-6", "SKU-5", "SKU-3", "SKU-1"]],
  ])("%s shows only that window", async (label, revenue, orders, skus) => {
    renderDashboard();
    if (label !== "30 días") {
      await expectKpis(30000, 2);
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    await expectKpis(revenue, orders);
    await waitFor(() => expect(bestSellerSkus()).toEqual(skus));
  });

  it("custom range includes both boundary dates (late end-day order too) and nothing outside", async () => {
    renderDashboard();
    await expectKpis(30000, 2);

    const { start, end, apply } = openCustom();
    fireEvent.change(start, { target: { value: "2026-09-01" } });
    fireEvent.change(end, { target: { value: "2026-10-01" } });
    fireEvent.click(apply);

    await expectKpis(120000, 2); // SKU-3 (Sep 1 00:00) + SKU-4 (Oct 1 23:59:59.999)
    expect(kpi("Unidades")).toBe("4");
    await waitFor(() => expect(bestSellerSkus()).toEqual(["SKU-4", "SKU-3"]));
    expect(screen.getByTestId("sales-period").textContent).toMatch(/\(31 días\)$/);

    const [, args] = salesCalls().at(-1)!;
    expect(args).toMatchObject({
      p_from: "2026-09-01T06:00:00.000Z",
      p_to: "2026-10-02T06:00:00.000Z",
    });
  });

  it("does not query while dates are being picked, only on Aplicar", async () => {
    renderDashboard();
    await expectKpis(30000, 2);
    const before = rpcMock.mock.calls.length;

    const { start, end, apply } = openCustom();
    fireEvent.change(start, { target: { value: "2026-09-01" } });
    fireEvent.change(end, { target: { value: "2026-09-15" } });
    fireEvent.change(end, { target: { value: "2026-10-01" } });
    expect(rpcMock.mock.calls.length).toBe(before);

    fireEvent.click(apply);
    await expectKpis(120000, 2);
    expect(rpcMock.mock.calls.length).toBe(before + 2); // one summary + one best sellers
  });

  it("rejects an end date before the start date and keeps the applied period", async () => {
    renderDashboard();
    await expectKpis(30000, 2);
    const before = rpcMock.mock.calls.length;

    const { start, end, apply } = openCustom();
    fireEvent.change(start, { target: { value: "2026-10-01" } });
    fireEvent.change(end, { target: { value: "2026-09-01" } });
    expect(screen.getByRole("alert").textContent).toBe(
      "La fecha de fin no puede ser anterior a la de inicio."
    );
    fireEvent.click(apply);

    expect(rpcMock.mock.calls.length).toBe(before);
    expect(screen.getByTestId("sales-period").textContent).toBe("Últimos 30 días");
    expect(kpi("Ingresos")).toBe(formatPrice(30000));
  });

  it("asks for a missing start date instead of applying", async () => {
    renderDashboard();
    await expectKpis(30000, 2);
    const before = rpcMock.mock.calls.length;

    const { apply } = openCustom(); // end is prefilled with today, start empty
    fireEvent.click(apply);
    expect(screen.getByRole("alert").textContent).toBe("Selecciona la fecha de inicio.");
    expect(rpcMock.mock.calls.length).toBe(before);
  });

  it("switching preset ↔ custom keeps every metric on the same period", async () => {
    renderDashboard();
    await expectKpis(30000, 2);

    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    await expectKpis(1270000, 7);

    const { start, end, apply } = openCustom();
    fireEvent.change(start, { target: { value: "2026-10-01" } });
    fireEvent.change(end, { target: { value: "2026-10-01" } });
    fireEvent.click(apply);
    await expectKpis(80000, 1); // one-day range: only the late-night SKU-4
    await waitFor(() => expect(bestSellerSkus()).toEqual(["SKU-4"]));
    expect(screen.getByRole("button", { name: "Rango personalizado" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.click(screen.getByRole("button", { name: "7 días" }));
    await expectKpis(10000, 1);
    await waitFor(() => expect(bestSellerSkus()).toEqual(["SKU-1"]));
    expect(screen.getByTestId("sales-period").textContent).toBe("Últimos 7 días");

    // Every summary request had a best-sellers twin with identical bounds.
    const calls = salesCalls().map(([fn, args]) => ({ fn, from: args.p_from, to: args.p_to }));
    const summaries = calls.filter((c) => c.fn === "analytics_sales_summary");
    const sellers = calls.filter((c) => c.fn === "analytics_sales_best_sellers");
    expect(summaries.map(({ from, to }) => [from, to])).toEqual(
      sellers.map(({ from, to }) => [from, to])
    );
  });

  it("'Limpiar' on an applied custom range returns to the default period", async () => {
    renderDashboard();
    await expectKpis(30000, 2);
    const { start, end, apply } = openCustom();
    fireEvent.change(start, { target: { value: "2026-09-01" } });
    fireEvent.change(end, { target: { value: "2026-10-01" } });
    fireEvent.click(apply);
    await expectKpis(120000, 2);

    openCustom();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    await expectKpis(30000, 2);
    expect(screen.getByTestId("sales-period").textContent).toBe("Últimos 30 días");
  });

  it("never shows the previous period's numbers (or ₡0) while a new period loads", async () => {
    renderDashboard();
    await expectKpis(30000, 2);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const server = fakeServer(FIXTURE);
    rpcMock.mockImplementation(async (fn: string, args: Args) => {
      await gate;
      return server(fn, args);
    });

    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    await waitFor(() => expect(kpi("Ingresos")).toBe("")); // skeleton, no value
    expect(screen.queryByText(formatPrice(30000))).toBeNull();
    expect(screen.queryByText(formatPrice(0))).toBeNull();

    release();
    await expectKpis(1270000, 7);
  });

  it("aggregates a history far beyond 1,000 orders completely", async () => {
    // PostgREST caps RETURNED rows (1,000 by default). The RPC returns one
    // aggregated row, so the cap can't truncate the sum — simulated here by
    // capping the fake server's returned rows only.
    const big: FixtureOrder[] = Array.from({ length: 5000 }, (_, i) => ({
      sku: `SKU-${i % 7}`,
      at: ago(i % 700), // spread over ~2 years
      status: "shipped",
      total: 1000,
      units: 1,
    }));
    const server = fakeServer(big);
    rpcMock.mockImplementation(async (fn: string, args: Args) => {
      const res = await server(fn, args);
      return { ...res, data: res.data?.slice(0, 1000) ?? null };
    });

    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Todo" }));
    await expectKpis(5_000_000, 5000);
    expect(kpi("Unidades")).toBe((5000).toLocaleString("es-CR"));
  });

  it("surfaces an RPC error instead of zeros", async () => {
    rpcMock.mockImplementation(async () => ({ data: null, error: new Error("permission denied") }));
    renderDashboard();
    expect(await screen.findByText(/No pudimos cargar los KPIs/)).toBeInTheDocument();
    expect(screen.queryByText(formatPrice(0))).toBeNull();
  });
});
