"use client";

import { useRevenueSummary } from "@/hooks/useAnalytics";
import type { ResolvedSalesRange } from "@/lib/analytics/dateRange";
import { formatPrice } from "@/lib/format";

interface Props {
  range: ResolvedSalesRange;
}

/**
 * Four KPI cards driven by analytics_sales_summary.
 *
 * The RPC always returns one aggregated row, so zeros are real zeros once the
 * period has loaded. While a period is loading — first load OR a switch, where
 * react-query hands back the previous period as placeholder data — the cards
 * show skeletons: neither a fake ₡0 nor the previous period's numbers is ever
 * presented as the new period. Error shows a compact red strip.
 */
export default function KpiCards({ range }: Props) {
  const { data, isLoading, isPlaceholderData, isError, error } = useRevenueSummary({ range });
  const loading = isLoading || isPlaceholderData;

  if (isError) {
    return (
      <div className="rounded-none border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        No pudimos cargar los KPIs:{" "}
        {error instanceof Error ? error.message : "error desconocido"}
      </div>
    );
  }

  // PostgREST serialises NUMERIC/BIGINT as JSON numbers; Number() keeps the
  // formatting safe should a driver ever hand back strings.
  const revenue = Number(data?.gross_revenue ?? 0);
  const orders = Number(data?.total_orders ?? 0);
  const units = Number(data?.total_units ?? 0);
  const aov = Number(data?.avg_order_value ?? 0);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4" aria-busy={loading}>
      <Card label="Ingresos" value={formatPrice(revenue)} loading={loading} />
      <Card label="Pedidos" value={orders.toLocaleString("es-CR")} loading={loading} />
      <Card label="Unidades" value={units.toLocaleString("es-CR")} loading={loading} />
      <Card label="Promedio" value={formatPrice(aov)} loading={loading} />
    </div>
  );
}

function Card({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-none border border-krov-smoke bg-krov-graphite p-4 sm:p-5">
      <p className="text-[11px] uppercase tracking-wider text-krov-ash">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-2/3 bg-krov-blood/10 rounded-none animate-pulse" />
      ) : (
        <p className="mt-1 text-2xl font-bold text-krov-bone tabular-nums">
          {value}
        </p>
      )}
    </div>
  );
}
