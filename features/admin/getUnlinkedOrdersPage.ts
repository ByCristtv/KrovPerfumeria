import { createClient } from "@/lib/supabase/server";
import { ADMIN_PAGE_SIZE, paginate, type Paginated } from "@/lib/pagination";
import { linkErrorMessage, linkRpc, mapUnlinkedOrderRow } from "@/lib/orders/orderLinking";
import type { UnlinkedOrderRow } from "@/types/orderLinking";
import type {
  OrderStatusFilter,
  PaymentStatusFilter,
} from "@/features/admin/getOrdersAdminPage";

export interface UnlinkedOrdersQuery {
  search?: string;
  orderStatus?: OrderStatusFilter;
  paymentStatus?: PaymentStatusFilter;
}

export interface UnlinkedOrdersPage extends Paginated<UnlinkedOrderRow> {
  /** Spanish, admin-facing; null when the list loaded. */
  error: string | null;
  /** The requested page is past the end (e.g. the last row on it was linked). */
  outOfRange: boolean;
}

/**
 * One page of orders with no owner (user_id IS NULL) for Admin → Ligar Pedidos.
 *
 * Goes through admin_list_unlinked_orders rather than plain PostgREST so phone
 * search can ignore formatting ("8888-8888" finds "+506 8888 8888") — the
 * single most common way these customers are identified. The RPC runs is_admin()
 * itself; the request-bound client carries the admin's session.
 *
 * Never throws: a failure returns an empty page with a readable `error`, so the
 * panel can say "couldn't load" instead of pretending there is nothing to link.
 */
export async function getUnlinkedOrdersPage(
  page: number,
  filters: UnlinkedOrdersQuery = {},
  pageSize: number = ADMIN_PAGE_SIZE
): Promise<UnlinkedOrdersPage> {
  const supabase = await createClient();
  const requested = Math.max(1, Math.floor(page) || 1);

  const { data, error } = await linkRpc(supabase, "admin_list_unlinked_orders", {
    p_search: filters.search?.trim() || null,
    p_order_status:
      filters.orderStatus && filters.orderStatus !== "all" ? filters.orderStatus : null,
    p_payment_status:
      filters.paymentStatus && filters.paymentStatus !== "all" ? filters.paymentStatus : null,
    p_limit: pageSize,
    p_offset: (requested - 1) * pageSize,
  });

  const empty = { rows: [], total: 0, currentPage: 1, totalPages: 1, pageSize };

  if (error) {
    return { ...empty, error: linkErrorMessage(error.message), outOfRange: false };
  }

  const rows = data ?? [];
  // total_count rides on every row; an empty page past the end has none, which
  // is how "page 3 of a list that now has 2" is detected.
  if (rows.length === 0) {
    return { ...empty, error: null, outOfRange: requested > 1 };
  }

  const total = Number(rows[0].total_count) || rows.length;
  const { currentPage, totalPages } = paginate(total, requested, pageSize);

  return {
    rows: rows.map((r) => mapUnlinkedOrderRow(r as Record<string, unknown>)),
    total,
    currentPage,
    totalPages,
    pageSize,
    error: null,
    outOfRange: false,
  };
}
