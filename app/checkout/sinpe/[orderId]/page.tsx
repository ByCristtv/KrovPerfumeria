import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { verifyOrderToken } from "@/lib/orders/tokens";
import { getSinpeEnv } from "@/lib/sinpe/env";
import { formatPrice } from "@/lib/format";
import { CONTACT } from "@/components/contact/contactData";
import { NOINDEX_NOFOLLOW } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  // Per-order payment instructions: private, never for a crawler.
  robots: NOINDEX_NOFOLLOW,
  title: "Paga con SINPE Móvil",
  description: "Instrucciones para completar tu pedido con SINPE Móvil.",
};

interface SinpePageProps {
  // Next.js 16: params + searchParams are both async and MUST be awaited.
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ token?: string }>;
}

/**
 * SINPE Móvil payment instructions.
 *
 * Reached right after placing a SINPE order — stock is already reserved and the
 * order sits at payment_status='pending' until an admin validates the transfer.
 * No Onvo involvement of any kind.
 *
 * AUTH MODEL — identical to /orders/[id]:
 *   1. Try the cookies-aware client; RLS permitting the read proves ownership.
 *   2. Otherwise verify ?token=… against an HMAC of the order id (guest path).
 *   3. Neither → 404 (never confirm the order exists).
 *
 * Totals are read live rather than passed through the URL, so an order edited
 * before the transfer always shows the amount we'll actually expect.
 */
export default async function SinpeInstructionsPage({
  params,
  searchParams,
}: SinpePageProps) {
  const { orderId } = await params;
  const { token } = await searchParams;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    notFound();
  }

  const userClient = await createClient();
  const { data: ownedOrder } = await userClient
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .maybeSingle();

  let authorized = ownedOrder !== null;
  if (!authorized && verifyOrderToken(orderId, token)) {
    authorized = true;
  }
  if (!authorized) notFound();

  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id, order_number, total, payment_status, payment_provider, customer_name"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error("[checkout/sinpe] failed to fetch order", { orderId, error });
    throw new Error("No pudimos cargar tu pedido.");
  }
  if (!order) notFound();

  // This page only makes sense for a SINPE order. A card order landing here (a
  // shared/stale link) belongs on its own confirmation page.
  if (order.payment_provider !== "manual_sinpe") notFound();

  const sinpe = getSinpeEnv();
  const isPaid = order.payment_status === "paid";
  const reference = `#${order.order_number}`;
  const whatsappUrl = buildWhatsappUrl(order.order_number, order.total);

  return (
    <section className="pt-28 pb-16 px-4 bg-krov-void min-h-screen">
      <div className="max-w-2xl mx-auto">
        <header className="text-center mb-8">
          <div
            className={`inline-flex items-center justify-center w-14 h-14 rounded-full mb-4 ${
              isPaid ? "bg-emerald-500/15" : "bg-amber-500/15"
            }`}
          >
            {isPaid ? (
              <CheckIcon className="w-7 h-7 text-emerald-300" />
            ) : (
              <PhoneIcon className="w-7 h-7 text-amber-300" />
            )}
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-krov-bone">
            {isPaid ? "¡Pago confirmado!" : "Completa tu pago con SINPE Móvil"}
          </h1>
          <p className="text-sm text-krov-ash mt-2">
            Pedido <span className="font-mono">{reference}</span> · Reservamos tus
            productos mientras confirmamos el pago.
          </p>
        </header>

        {isPaid ? (
          <Panel>
            <p className="text-sm text-krov-ash leading-relaxed">
              Ya validamos tu transferencia. Te contactaremos por WhatsApp con las
              novedades de tu entrega.
            </p>
          </Panel>
        ) : (
          <div className="space-y-5">
            {/* ──────── The three things they must get right ──────── */}
            <Panel>
              <dl className="divide-y divide-krov-smoke/70">
                <DataRow label="Monto exacto" value={formatPrice(order.total)} emphasis />
                <DataRow label="Número SINPE" value={sinpe.phone} emphasis />
                <DataRow label="A nombre de" value={sinpe.accountHolder} />
                <DataRow
                  label="Detalle / referencia"
                  value={reference}
                  emphasis
                  hint="Escribe este número en el detalle de la transferencia."
                />
              </dl>
            </Panel>

            {/* ──────── Steps ──────── */}
            <Panel title="Cómo pagar">
              <ol className="space-y-3">
                <Step n={1}>
                  Desde tu app bancaria, envía un SINPE Móvil de{" "}
                  <strong>{formatPrice(order.total)}</strong> al número{" "}
                  <strong className="font-mono">{sinpe.phone}</strong>.
                </Step>
                <Step n={2}>
                  Incluye <strong className="font-mono">{reference}</strong> en el
                  detalle para que podamos identificar tu pedido.
                </Step>
                <Step n={3}>
                  Envíanos el comprobante por WhatsApp con el botón de abajo.
                </Step>
                <Step n={4}>
                  Validamos el pago manualmente y te confirmamos. Tus productos
                  quedan apartados mientras tanto.
                </Step>
              </ol>
            </Panel>

            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-none bg-krov-blood text-krov-void py-3 text-sm font-medium hover:opacity-90 transition"
            >
              <WhatsappIcon className="w-4 h-4" />
              Enviar comprobante por WhatsApp
            </a>

            <p className="text-xs text-krov-dust text-center leading-relaxed">
              Guarda esta página: el número de pedido{" "}
              <span className="font-mono">{reference}</span> es tu referencia.
            </p>
          </div>
        )}

        <Link
          href="/"
          className="mt-6 block text-center text-sm text-krov-rose underline underline-offset-4 hover:text-krov-blush"
        >
          Seguir comprando
        </Link>
      </div>
    </section>
  );
}

/**
 * Prefill the WhatsApp message so the customer only has to attach their receipt —
 * and so we receive the order number even if they forget the transfer detail.
 */
function buildWhatsappUrl(orderNumber: number, total: number): string {
  const message = `Hola, acabo de pagar el pedido #${orderNumber} por ${formatPrice(
    total
  )} vía SINPE Móvil. Adjunto el comprobante.`;
  return `${CONTACT.whatsapp}?text=${encodeURIComponent(message)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline UI helpers
// ─────────────────────────────────────────────────────────────────────────────

function Panel({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-none border border-krov-smoke bg-krov-coal p-5">
      {title && (
        <h2 className="text-base font-semibold text-krov-bone mb-3">{title}</h2>
      )}
      {children}
    </section>
  );
}

function DataRow({
  label,
  value,
  emphasis,
  hint,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: string;
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm text-krov-dust shrink-0">{label}</dt>
        <dd
          className={`text-right break-all ${
            emphasis
              ? "text-base font-semibold text-krov-bone tabular-nums"
              : "text-sm text-krov-bone"
          }`}
        >
          {value}
        </dd>
      </div>
      {hint && <p className="text-xs text-krov-dust mt-1">{hint}</p>}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-krov-graphite text-xs font-semibold text-krov-ash">
        {n}
      </span>
      <span className="text-sm text-krov-ash leading-relaxed">{children}</span>
    </li>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 4h10a1 1 0 011 1v14a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1zm4 13h2"
      />
    </svg>
  );
}

function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
