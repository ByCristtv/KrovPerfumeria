import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { PaymentBadge, StatusBadge } from "@/app/admin/orders/OrdersTable";
import { formatPrice, formatXp } from "@/lib/format";
import type { CustomerOrder } from "@/features/admin/getCustomerAdminDetail";

interface Props {
  orders: CustomerOrder[];
  /** All of the customer's orders (the list may be capped). */
  total: number;
  /** False when the orders query failed. */
  loaded?: boolean;
}

/**
 * A customer's order history on Admin → Clientes → [id].
 *
 * Each order is a native <details>: the summary row carries number, date,
 * status, payment and total (badges shared with the orders list), and expands
 * to its lines without any client JS. The full order — actions included —
 * stays one click away at /admin/orders/[id].
 */
export default function CustomerOrderHistory({ orders, total, loaded = true }: Props) {
  if (!loaded) {
    return (
      <div
        role="alert"
        className="rounded-none border border-red-500/40 bg-red-500/10 p-8 text-center text-sm text-red-200"
      >
        No pudimos cargar el historial de pedidos.
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-none border border-krov-smoke bg-krov-graphite p-10 text-center text-sm text-krov-ash">
        Este cliente todavía no tiene pedidos.
      </div>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-krov-smoke/70 border border-krov-smoke bg-krov-graphite">
        {orders.map((o) => (
          <li key={o.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm text-krov-bone transition hover:bg-krov-blood/5 [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  size={16}
                  aria-hidden
                  className="shrink-0 text-krov-ash transition-transform group-open:rotate-180"
                />
                <span className="font-mono text-krov-rose">#{o.order_number}</span>
                <span className="text-xs text-krov-ash">{formatOrderDate(o.created_at)}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={o.order_status} />
                  <PaymentBadge status={o.payment_status} />
                </span>
                <span className="ml-auto flex items-center gap-4">
                  {o.xp_earned !== null && (
                    <span className="text-xs text-krov-ash tabular-nums">
                      +{formatXp(o.xp_earned)} XP
                    </span>
                  )}
                  <span className="font-medium tabular-nums">{formatPrice(o.total)}</span>
                </span>
              </summary>

              <div className="border-t border-krov-smoke/70 bg-krov-void/40 px-4 py-4">
                {o.items.length === 0 ? (
                  <p className="text-xs text-krov-ash">Sin líneas registradas.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left uppercase tracking-wider text-krov-ash">
                          <th className="py-1.5 pr-3 font-normal">Producto</th>
                          <th className="py-1.5 pr-3 text-right font-normal">Cant.</th>
                          <th className="py-1.5 pr-3 text-right font-normal">Precio</th>
                          <th className="py-1.5 text-right font-normal">Total</th>
                        </tr>
                      </thead>
                      <tbody className="text-krov-bone">
                        {o.items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-1.5 pr-3">
                              {item.product_name}
                              <span className="text-krov-ash">
                                {" "}
                                · {item.brand_name} · {item.size_ml} ml
                              </span>
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">{item.quantity}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {formatPrice(item.unit_price)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">
                              {formatPrice(item.line_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:w-72 sm:ml-auto">
                  <dt className="text-krov-ash">Subtotal</dt>
                  <dd className="text-right tabular-nums">{formatPrice(o.subtotal)}</dd>
                  {o.discount > 0 && (
                    <>
                      <dt className="text-krov-ash">Descuento</dt>
                      <dd className="text-right tabular-nums">−{formatPrice(o.discount)}</dd>
                    </>
                  )}
                  <dt className="text-krov-ash">Envío</dt>
                  <dd className="text-right tabular-nums">{formatPrice(o.shipping_cost)}</dd>
                  <dt className="font-semibold text-krov-bone">Total</dt>
                  <dd className="text-right font-semibold tabular-nums">{formatPrice(o.total)}</dd>
                </dl>

                <div className="mt-3 text-right">
                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="text-[11px] uppercase tracking-[0.2em] text-krov-rose hover:underline"
                  >
                    Ver pedido completo →
                  </Link>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>

      {total > orders.length && (
        <p className="mt-3 text-xs text-krov-ash">
          Mostrando los {orders.length} pedidos más recientes de {total}.
        </p>
      )}
    </div>
  );
}

function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
