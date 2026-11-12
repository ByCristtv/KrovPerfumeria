import type { Metadata } from "next";
import { redirect } from "next/navigation";
import OrdersFilters from "../OrdersFilters";
import {
  STATUS_PARAM,
  PAYMENT_PARAM,
  ORDER_STATUS_FILTERS,
  PAYMENT_STATUS_FILTERS,
  coerceFilter,
} from "../params";
import UnlinkedOrdersTable from "./UnlinkedOrdersTable";
import AdminContainer from "@/components/admin/ui/AdminContainer";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import Pagination from "@/components/admin/ui/Pagination";
import { getUnlinkedOrdersPage } from "@/features/admin/getUnlinkedOrdersPage";
import {
  PAGE_PARAM,
  buildQuery,
  parsePage,
  parseParam,
  parseSearch,
  paginate,
  type RawSearchParams,
} from "@/lib/pagination";

export const metadata: Metadata = {
  title: "Ligar pedidos — Admin",
  description: "Asocia pedidos sin cuenta a clientes registrados.",
};

export const dynamic = "force-dynamic";

interface LinkOrdersPageProps {
  searchParams: Promise<RawSearchParams>;
}

/**
 * Admin → Orders → Ligar Pedidos.
 *
 * Every order whose user_id IS NULL, server-paginated (20/page) and URL-driven
 * like the orders list (`?q=` / `?status=` / `?payment=` / `?page=`); the same
 * filter island is reused. Linking happens in a client dialog per row, then
 * `router.refresh()` re-runs this page so the linked order drops out.
 *
 * Auth: proxy.ts redirects non-admins before this renders; the list RPC checks
 * is_admin() again. Next.js 16: `searchParams` is async and must be awaited.
 */
export default async function LinkOrdersPage({ searchParams }: LinkOrdersPageProps) {
  const sp = await searchParams;
  const search = parseSearch(sp);
  const page = parsePage(sp);
  const orderStatus = coerceFilter(
    parseParam(sp, STATUS_PARAM, "all"),
    ORDER_STATUS_FILTERS,
    "all"
  );
  const paymentStatus = coerceFilter(
    parseParam(sp, PAYMENT_PARAM, "all"),
    PAYMENT_STATUS_FILTERS,
    "all"
  );

  const result = await getUnlinkedOrdersPage(page, { search, orderStatus, paymentStatus });

  // Past the end (typically: the last order on that page was just linked).
  // Back to page 1 with the same filters.
  if (result.outOfRange) {
    const current = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      if (typeof value === "string") current.set(key, value);
    }
    redirect(`/admin/orders/link${buildQuery(current, { [PAGE_PARAM]: undefined })}`);
  }

  const { rows, total, currentPage, totalPages, pageSize, error } = result;
  const { from, to } = paginate(total, currentPage, pageSize);
  const filtered = Boolean(search) || orderStatus !== "all" || paymentStatus !== "all";

  return (
    <AdminContainer>
      <AdminPageHeader
        eyebrow="Pedidos"
        title="Ligar pedidos"
        description="Pedidos hechos sin cuenta. Asócialos al cliente registrado que los hizo para que aparezcan en su historial y sumen sus XP."
        backHref="/admin/orders"
        backLabel="Volver a órdenes"
      />

      <OrdersFilters
        search={search ?? ""}
        orderStatus={orderStatus}
        paymentStatus={paymentStatus}
      />

      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-none border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
        >
          No pudimos cargar los pedidos sin cuenta. {error}
        </div>
      ) : (
        <>
          <p className="mb-4 mt-6 text-xs uppercase tracking-[0.2em] text-krov-ash">
            {total === 0
              ? "Sin pedidos por ligar"
              : `Mostrando ${from}–${to} de ${total} sin cuenta`}
          </p>

          <UnlinkedOrdersTable orders={rows} filtered={filtered} />

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            label="Paginación de pedidos sin cuenta"
          />
        </>
      )}
    </AdminContainer>
  );
}
