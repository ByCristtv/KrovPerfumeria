"use client";

import { useMemo, useState } from "react";
import BestSellersTable from "./BestSellersTable";
import DateRangePicker from "./DateRangePicker";
import KpiCards from "./KpiCards";
import LowStockTable from "./LowStockTable";
import AdminContainer from "@/components/admin/ui/AdminContainer";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import {
  DEFAULT_SALES_RANGE,
  describeSalesRange,
  resolveSalesRange,
  type SalesRange,
} from "@/lib/analytics/dateRange";

/**
 * Client orchestrator for the analytics dashboard. Owns the APPLIED sales
 * range and resolves it ONCE into the instants every sales widget uses, so the
 * KPI cards and the best-sellers table always describe the same period.
 *
 * LowStockTable is independent — stock state is "now," not a date range.
 *
 * useMemo keyed on the range object: presets resolve relative to the moment
 * they were selected, so re-resolving on every render would mint a new
 * `from` instant → new query key → constant refetching.
 */
export default function AnalyticsDashboard() {
  const [range, setRange] = useState<SalesRange>(DEFAULT_SALES_RANGE);
  const resolved = useMemo(() => resolveSalesRange(range), [range]);

  return (
    <AdminContainer>
      <AdminPageHeader
        eyebrow="Analítica"
        title="Mis Ventas"
        description="Ingresos, productos más vendidos y alertas de inventario."
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />

      <div className="space-y-5">
        <p className="text-xs text-krov-ash" aria-live="polite">
          Período:{" "}
          <span className="font-medium text-krov-bone" data-testid="sales-period">
            {describeSalesRange(range)}
          </span>
        </p>
        <KpiCards range={resolved} />
        <BestSellersTable range={resolved} />
        <LowStockTable />
      </div>
    </AdminContainer>
  );
}
