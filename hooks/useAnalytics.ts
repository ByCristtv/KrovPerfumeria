"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import {
  salesRangeKey,
  toRpcBounds,
  type ResolvedSalesRange,
} from "@/lib/analytics/dateRange";
import type { Database } from "@/types/database";

/**
 * Hooks around the admin analytics RPCs.
 *
 * Sales (summary + best sellers) go through analytics_sales_summary /
 * analytics_sales_best_sellers (migration 20261114000100): admin-only,
 * aggregated in SQL, bounded by [from, to) where null = unbounded. Both hooks
 * take the SAME ResolvedSalesRange from lib/analytics/dateRange, so the KPI
 * cards and the best-sellers table can never show different periods.
 *
 * Why no row-limit concern: each RPC aggregates server-side and returns one
 * row (summary) or at most `limit` rows (best sellers). PostgREST's max-rows
 * cap applies to returned rows, never to the rows the SQL aggregates over —
 * so "Todo" sums the complete history no matter how many orders exist.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types from generated DB
// ─────────────────────────────────────────────────────────────────────────────

export type RevenueSummary =
  Database["public"]["Functions"]["analytics_sales_summary"]["Returns"][number];

export type BestSellerRow =
  Database["public"]["Functions"]["analytics_sales_best_sellers"]["Returns"][number];

export type LowStockRow =
  Database["public"]["Functions"]["analytics_low_stock"]["Returns"][number];

type SummaryArgs = Database["public"]["Functions"]["analytics_sales_summary"]["Args"];
type BestSellersArgs = Database["public"]["Functions"]["analytics_sales_best_sellers"]["Args"];

/**
 * The generated Args type marks defaulted params optional (`p_from?: string`),
 * but we deliberately send explicit nulls: an OMITTED bound falls back to the
 * SQL default, and a default of "now() - 30 days" is precisely what broke
 * "Todo" before. The SQL defaults are now NULL too — this is belt and braces.
 */
function boundsArgs(range: ResolvedSalesRange): SummaryArgs {
  return toRpcBounds(range) as SummaryArgs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue summary
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchRevenueSummary(
  range: ResolvedSalesRange
): Promise<RevenueSummary | null> {
  const { data, error } = await supabase.rpc("analytics_sales_summary", boundsArgs(range));
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

export function useRevenueSummary({ range }: { range: ResolvedSalesRange }) {
  return useQuery({
    queryKey: ["analytics", "sales-summary", ...salesRangeKey(range)],
    queryFn: () => fetchRevenueSummary(range),
    staleTime: 60_000,
    // Keeps the layout steady while a new period loads; consumers MUST check
    // `isPlaceholderData` so the previous period's numbers are never shown as
    // if they belonged to the new one.
    placeholderData: (prev) => prev,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Best sellers
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchBestSellers(
  range: ResolvedSalesRange,
  limit: number
): Promise<BestSellerRow[]> {
  const args = { ...boundsArgs(range), p_limit: limit } as BestSellersArgs;
  const { data, error } = await supabase.rpc("analytics_sales_best_sellers", args);
  if (error) throw error;
  return data ?? [];
}

export function useBestSellers({
  range,
  limit = 10,
}: {
  range: ResolvedSalesRange;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["analytics", "sales-best-sellers", ...salesRangeKey(range), limit],
    queryFn: () => fetchBestSellers(range, limit),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// useLowStock
// ─────────────────────────────────────────────────────────────────────────────
// Stock state is "now" — no date filter. Threshold is configurable but
// defaults to 5 (matches the RPC's own default).

interface UseLowStockArgs {
  threshold?: number;
}

async function fetchLowStock(threshold: number): Promise<LowStockRow[]> {
  const { data, error } = await supabase.rpc("analytics_low_stock", {
    p_threshold: threshold,
  });
  if (error) throw error;
  return data ?? [];
}

export function useLowStock({ threshold = 5 }: UseLowStockArgs = {}) {
  return useQuery({
    queryKey: ["analytics", "low-stock", threshold],
    queryFn: () => fetchLowStock(threshold),
    staleTime: 30_000,
  });
}
