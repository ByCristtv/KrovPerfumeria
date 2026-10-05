import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyOrderToken } from "@/lib/orders/tokens";
import { formatPrice } from "@/lib/format";
import OrderStatusSection from "./OrderStatusSection";
import PaidCustomerNote from "./PaidCustomerNote";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Tu pedido",
  description: "Detalles de tu pedido.",
};

interface OrderPageProps {
  // Next.js 16: params + searchParams are both async and MUST be awaited.
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string; cancelled?: string }>;
}

/**
 * Order confirmation / detail page.
 *
 * AUTH MODEL (Phase 5):
 *   1. Try the cookies-aware client first. If RLS permits the fetch, the user
 *      is the order owner or an admin → allow.
 *   2. Otherwise verify the URL's ?token=... against an HMAC of the order_id.
 *      Valid token → allow (guest path, used right after checkout).
 *   3. Neither matches → 404.
 *
 * In either allow case, the actual data fetch goes through the admin client
 * to bypass RLS uniformly. We've already proved authorization.
 *
 * The ?cancelled=1 query param (set by Onvo's cancelUrl) renders a banner
 * above the order details inviting the customer to retry via WhatsApp.
 */
export default async function OrderPage({
  params,
  searchParams,
}: OrderPageProps) {
  const { id } = await params;
  const { token, cancelled } = await searchParams;

  // Quick UUID format check before any DB call.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  // ──────── 1. Try the RLS-gated path ────────
  // If the user is logged in AND owns the order (or is admin), this read
  // succeeds. If they don't own it OR aren't logged in, RLS returns null —
  // we'll fall through to token verification.
  const userClient = await createClient();
  const { data: ownedOrder } = await userClient
    .from("orders")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  let authorized = ownedOrder !== null;

  // ──────── 2. Token fallback for guests ────────
  if (!authorized && verifyOrderToken(id, token)) {
    authorized = true;
  }

  if (!authorized) {
    notFound();
  }

  // ──────── 3. Fetch the full order via admin (bypasses RLS) ────────
  const admin = createAdminClient();
  const { data: order, error: orderErr } = await admin
    .from("orders")
    .select(
      `
      id,
      order_number,
      customer_name,
      customer_email,
      customer_phone,
      shipping_address,
      shipping_canton,
      shipping_district,
      shipping_province,
      shipping_reference,
      subtotal,
      shipping_cost,
      discount,
      total,
      order_status,
      payment_status,
      payment_provider,
      notes,
      created_at,
      order_items (
        id,
        product_name,
        brand_name,
        size_ml,
        sku,
        quantity,
        unit_price,
        line_total
      )
      `
    )
    .eq("id", id)
    .maybeSingle();

  if (orderErr) {
    console.error("[orders/[id]] failed to fetch order", { id, orderErr });
    throw new Error("No pudimos cargar tu pedido.");
  }
  if (!order) {
    // Authorized but missing — race condition (order deleted) or a token
    // signed for an id that was later wiped. 404 is the right answer.
    notFound();
  }

  const isCancelled = cancelled === "1";

  // Status seed handed to the polling island so its first paint matches what
  // the server rendered (no flicker), then updates live via React Query.
  const statusSeed = {
    payment_status: order.payment_status,
    order_status: order.order_status,
    payment_provider: order.payment_provider,
  };

  return (
    <section className="pt-28 pb-16 px-4 bg-krov-void min-h-screen">
      <div className="max-w-3xl mx-auto">
        {/* ──────── Status header + cancelled banner (client island: polls
            for webhook confirmation so the customer never refreshes) ──────── */}
        <OrderStatusSection
          orderId={order.id}
          orderNumber={order.order_number}
          token={token}
          isCancelled={isCancelled}
          initial={statusSeed}
        />

        <div className="grid grid-cols-1 md:grid-cols-[1fr_300px] gap-5">
          {/* ──────── Items + delivery ──────── */}
          <div className="space-y-5">
            <Panel title="Productos">
              <ul className="divide-y divide-krov-smoke/70">
                {(order.order_items ?? []).map((item) => (
                  <li
                    key={item.id}
                    className="py-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-krov-bone truncate">
                        {item.brand_name} — {item.product_name}
                      </p>
                      <p className="text-xs text-krov-dust">
                        {item.size_ml} ml · cant. {item.quantity} ·{" "}
                        <span className="font-mono">{item.sku}</span>
                      </p>
                    </div>
                    <span className="text-sm text-krov-bone shrink-0 tabular-nums">
                      {formatPrice(item.line_total)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Entrega">
              <dl className="text-sm text-krov-ash space-y-1">
                <Row label="Nombre" value={order.customer_name} />
                <Row label="Teléfono" value={order.customer_phone} />
                <Row label="Correo" value={order.customer_email ?? "—"} />
                <Row
                  label="Provincia / Cantón"
                  value={`${order.shipping_province} / ${order.shipping_canton}`}
                />
                {order.shipping_district && (
                  <Row label="Distrito" value={order.shipping_district} />
                )}
                <Row label="Señas" value={order.shipping_address} />
                {order.shipping_reference && (
                  <Row label="Referencia" value={order.shipping_reference} />
                )}
                {order.notes && <Row label="Notas" value={order.notes} />}
              </dl>
            </Panel>

            <PaidCustomerNote
              orderId={order.id}
              token={token}
              customerEmail={order.customer_email}
              initial={statusSeed}
            />
          </div>

          {/* ──────── Totals ──────── */}
          <aside className="rounded-none border border-krov-smoke bg-krov-coal p-5 h-fit md:sticky md:top-28">
            <h2 className="text-base font-semibold text-krov-bone mb-3">
              Total
            </h2>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between text-krov-ash">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{formatPrice(order.subtotal)}</dd>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between text-krov-rose">
                  <dt>Descuento</dt>
                  <dd className="tabular-nums">−{formatPrice(order.discount)}</dd>
                </div>
              )}
              <div className="flex justify-between text-krov-ash">
                <dt>Envío</dt>
                <dd className="tabular-nums">
                  {order.shipping_cost > 0
                    ? formatPrice(order.shipping_cost)
                    : "Gratis"}
                </dd>
              </div>
              <div className="flex justify-between text-base font-semibold text-krov-bone pt-3 border-t border-krov-smoke">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPrice(order.total)}</dd>
              </div>
            </dl>

            <Link
              href="/"
              className="mt-5 block text-center text-sm text-krov-rose underline underline-offset-4 hover:text-krov-blush"
            >
              Seguir comprando
            </Link>
          </aside>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline UI helpers
// ─────────────────────────────────────────────────────────────────────────────

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-none border border-krov-smoke bg-krov-coal p-5">
      <h2 className="text-base font-semibold text-krov-bone mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <dt className="text-krov-dust sm:w-32 shrink-0">{label}</dt>
      <dd className="text-krov-bone break-words">{value}</dd>
    </div>
  );
}

