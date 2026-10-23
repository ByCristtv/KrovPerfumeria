import type { Metadata } from "next";
import { redirect } from "next/navigation";
import CustomersSearch from "./CustomersSearch";
import CustomersTable from "./CustomersTable";
import AdminContainer from "@/components/admin/ui/AdminContainer";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import Pagination from "@/components/admin/ui/Pagination";
import { getCustomersAdminPage } from "@/features/admin/getCustomersAdminPage";
import {
  SEARCH_PARAM,
  paginate,
  parsePage,
  parseSearch,
  type RawSearchParams,
} from "@/lib/pagination";

export const metadata: Metadata = {
  title: "Clientes — Admin",
  description: "Clientes registrados, su XP y su historial de pedidos.",
};

export const dynamic = "force-dynamic";

interface AdminCustomersPageProps {
  searchParams: Promise<RawSearchParams>;
}

/**
 * Admin → Clientes. Auth is enforced by proxy.ts before this renders; RLS lets
 * admins read every profile. Server-paginated, 16/page, URL-driven (`?q=`,
 * `?page=`). Next.js 16: `searchParams` is async and MUST be awaited.
 */
export default async function AdminCustomersPage({ searchParams }: AdminCustomersPageProps) {
  const sp = await searchParams;
  const search = parseSearch(sp);
  const page = parsePage(sp);

  const result = await getCustomersAdminPage(page, search);

  // A stale/hand-typed ?page= past the end: back to the first page, keeping q.
  if (result.outOfRange) {
    redirect(
      `/admin/clientes${search ? `?${SEARCH_PARAM}=${encodeURIComponent(search)}` : ""}`
    );
  }

  const { rows, total, currentPage, totalPages, pageSize } = result;
  const { from, to } = paginate(total, currentPage, pageSize);

  return (
    <AdminContainer>
      <AdminPageHeader
        eyebrow="Clientes"
        title="Clientes"
        description="Consulta a tus clientes registrados, su XP, su rango y su historial de pedidos."
      />

      <CustomersSearch search={search ?? ""} />

      {result.error ? (
        <div
          role="alert"
          className="mt-6 rounded-none border border-red-500/40 bg-red-500/10 p-8 text-center text-sm text-red-200"
        >
          No pudimos cargar los clientes. Recarga la página para intentarlo de nuevo.
        </div>
      ) : (
        <>
          <p className="mb-4 mt-6 text-xs uppercase tracking-[0.2em] text-krov-ash">
            {total === 0 ? "Sin clientes" : `Mostrando ${from}–${to} de ${total}`}
          </p>

          <CustomersTable customers={rows} searching={Boolean(search)} />

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            label="Paginación de clientes"
          />
        </>
      )}
    </AdminContainer>
  );
}
