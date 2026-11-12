"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { PaymentBadge, StatusBadge, formatDate } from "../OrdersTable";
import LinkOrderDialog from "./LinkOrderDialog";
import type { UnlinkedOrderRow } from "@/types/orderLinking";

interface Props {
  orders: UnlinkedOrderRow[];
  /** A search or filter is active — changes the empty-state copy. */
  filtered: boolean;
}

const PROVIDER_LABEL: Record<string, string> = {
  onvo: "Tarjeta",
  manual_sinpe: "SINPE Móvil",
};

/** Payment channel in a word. Manual (admin) orders have no provider. */
export function paymentChannel(order: Pick<UnlinkedOrderRow, "payment_provider" | "source">): string {
  if (order.payment_provider) return PROVIDER_LABEL[order.payment_provider] ?? order.payment_provider;
  return order.source === "admin" ? "Pedido manual" : "—";
}

/**
 * The unlinked-orders table. Presentational over the server-fetched page,
 * plus the one piece of client state the page needs: which order's "Ligar a
 * cliente" dialog is open. After a link, `router.refresh()` re-runs the server
 * page, so the order leaves the list because the DATABASE says it is linked —
 * not because this component hid it.
 */
export default function UnlinkedOrdersTable({ orders, filtered }: Props) {
  const router = useRouter();
  const [linking, setLinking] = useState<UnlinkedOrderRow | null>(null);

  if (orders.length === 0) {
    return (
      <div className="rounded-none border border-krov-smoke bg-krov-graphite p-12 text-center text-krov-ash">
        {filtered
          ? "Ningún pedido sin cuenta coincide con la búsqueda."
          : "No hay pedidos sin cuenta: todos están ligados a un cliente."}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-none border border-krov-smoke bg-krov-graphite">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-krov-smoke text-left text-[11px] uppercase tracking-wider text-krov-ash">
              <th className="px-4 py-3">#Pedido</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Fecha</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Pago</th>
              <th className="px-4 py-3 text-right">
                <span className="sr-only">Acción</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-krov-smoke/70">
            {orders.map((o) => (
              <tr key={o.id} className="text-krov-bone">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="rounded-none font-mono text-krov-rose hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-krov-blood/70"
                  >
                    #{o.order_number}
                  </Link>
                </td>
                <td className="px-4 py-3 min-w-[12rem]">
                  <div className="font-medium">{o.customer_name}</div>
                  <div className="text-xs text-krov-ash">
                    {[o.customer_phone, o.customer_email].filter(Boolean).join(" · ") || "Sin contacto"}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-krov-ash whitespace-nowrap">
                  {formatDate(o.created_at)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium whitespace-nowrap">
                  {formatPrice(o.total)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={o.order_status} />
                </td>
                <td className="px-4 py-3">
                  <PaymentBadge status={o.payment_status} />
                  <div className="mt-1 text-[11px] text-krov-ash">{paymentChannel(o)}</div>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setLinking(o)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-none border border-krov-blood/50 px-3 py-1.5 text-xs font-semibold text-krov-rose transition hover:border-krov-blood hover:bg-krov-blood/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-krov-blood/70"
                  >
                    <Link2 size={14} strokeWidth={2} aria-hidden />
                    Ligar a cliente
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {linking && (
        <LinkOrderDialog
          // Remount per order: no search term or selection can leak from one
          // order's dialog into another's.
          key={linking.id}
          order={linking}
          onClose={() => setLinking(null)}
          onDone={() => {
            setLinking(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
