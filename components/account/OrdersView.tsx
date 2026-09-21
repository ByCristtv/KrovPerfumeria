"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useAuthUser } from "@/hooks/useAuthUser";
import { Badge } from "@/components/account/profileUi";
import {
  Bone,
  LoadingAnnouncement,
  SkeletonRegion,
  TextBone,
} from "@/components/ui/Skeleton";
import { formatPrice } from "@/lib/format";
import {
  getAccountOrders,
  type AccountOrderRow,
} from "@/features/account/getAccountData";

const SERIF = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/** Lines listed per card before collapsing into "+N más". */
const ITEMS_PREVIEW = 3;

const PAGE_CLS =
  "min-h-screen px-4 pt-28 pb-16 bg-[radial-gradient(circle_at_12%_8%,#191420_0%,#111_45%,#000_100%)]";

/**
 * /profile/orders: the customer's full purchase history.
 *
 * Moved out of /profile so the account page stays a summary. Each order is one
 * card that is one link to its detail page (/orders/[id], which already exists
 * and handles both signed-in owners and guest tokens). A card shows what
 * someone scanning their history looks for: number, date, status, what was in
 * it and what it cost.
 *
 * Client-rendered like /profile, for the same reasons: the session lives in the
 * browser client, and every row depends on who is asking (RLS on `orders` and
 * `order_items`), so there is nothing a server render could cache.
 */
export default function OrdersView() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthUser();

  const ordersQuery = useQuery<AccountOrderRow[]>({
    queryKey: ["account", "orders", user?.id],
    queryFn: () => getAccountOrders(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const orders = ordersQuery.data ?? [];
  const loading = authLoading || !user || ordersQuery.isPending;

  return (
    <section className={PAGE_CLS}>
      <div className="mx-auto max-w-3xl">
        <BackToProfile />

        {/* Static, so rendered for real while the list loads. */}
        <header className="mt-8 mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-krov-smoke pb-7 sm:mb-10">
          <div>
            <p className="mb-3 text-[10px] uppercase tracking-[0.35em] text-krov-rose">
              Mi cuenta
            </p>
            <h1
              className="text-3xl font-light tracking-[0.04em] text-white sm:text-4xl"
              style={{ fontFamily: SERIF }}
            >
              Mis pedidos
            </h1>
          </div>
          {!loading && orders.length > 0 && (
            <p className="krov-enter text-xs text-white/45">
              {orders.length} pedido{orders.length === 1 ? "" : "s"}
            </p>
          )}
        </header>

        {loading ? (
          <OrdersSkeleton />
        ) : ordersQuery.isError ? (
          <StatePanel title="No pudimos cargar tus pedidos">
            <p>Revisa tu conexión e inténtalo de nuevo.</p>
            <button
              type="button"
              onClick={() => void ordersQuery.refetch()}
              className="mt-5 min-h-10 border border-krov-blood/50 px-6 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
            >
              Reintentar
            </button>
          </StatePanel>
        ) : orders.length === 0 ? (
          <StatePanel title="Todavía no tienes pedidos">
            <p>Cuando compres, aquí verás el estado y el detalle de cada pedido.</p>
            <Link
              href="/products"
              className="mt-5 inline-flex min-h-10 items-center border border-krov-blood/50 px-6 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
            >
              Explorar la colección
            </Link>
          </StatePanel>
        ) : (
          <ol className="krov-enter-stagger space-y-4" aria-label="Historial de pedidos">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The way back. A full pill with a 44px target at the very top, where the thumb
 * and the eye both expect it, not a small text link. It goes to /profile by
 * URL rather than `router.back()`, so it works the same when someone lands here
 * from a bookmark or a notification email.
 */
function BackToProfile() {
  return (
    <Link
      href="/profile"
      className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-black/40 px-5 text-[11px] uppercase tracking-[0.2em] text-white/75 transition-colors duration-300 hover:border-krov-blood/60 hover:text-krov-rose"
    >
      <ArrowLeft
        size={15}
        aria-hidden
        className="transition-transform duration-300 group-hover:-translate-x-1"
      />
      Volver a mi perfil
    </Link>
  );
}

function OrderCard({ order }: { order: AccountOrderRow }) {
  const items = order.order_items ?? [];
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  const hidden = items.length - ITEMS_PREVIEW;
  const cancelled = order.order_status === "denied";
  const status = ORDER_STATUS[order.order_status];

  return (
    <li>
      {/* No backdrop-blur (unlike the profile cards): the list staggers its
          <li>s, and a fading ancestor would blank the blur mid-animation. Over
          this smooth gradient the blur is invisible anyway. */}
      <Link
        href={`/orders/${order.id}`}
        className="group block rounded-2xl border border-krov-smoke bg-black/50 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.35)] transition-colors duration-300 hover:border-krov-blood/50 sm:p-6"
      >
        {/* Number + date | total */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-lg leading-snug text-white" style={{ fontFamily: SERIF }}>
              Pedido <span className="font-mono text-base text-krov-rose">#{order.order_number}</span>
            </p>
            <p className="mt-0.5 text-xs text-white/45">
              <time dateTime={order.created_at}>{formatOrderDate(order.created_at)}</time>
            </p>
          </div>
          <p
            className={`shrink-0 text-base tabular-nums ${
              cancelled ? "text-white/40 line-through" : "text-white"
            }`}
          >
            {formatPrice(order.total)}
          </p>
        </div>

        {/* Order status leads (it's what people check); payment is secondary. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-white/75">
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${status?.dot ?? "bg-white/40"}`} />
            {status?.label ?? order.order_status}
          </span>
          <Badge label={PAYMENT_STATUS[order.payment_status] ?? order.payment_status} />
        </div>

        {items.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-krov-smoke/70 pt-4">
            {items.slice(0, ITEMS_PREVIEW).map((item) => (
              <li key={item.id} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 tabular-nums text-white/45">{item.quantity}×</span>
                <span className="min-w-0 truncate text-white/85">
                  {item.product_name}
                  <span className="text-white/40">
                    {" "}· {item.brand_name} · {item.size_ml} ml
                  </span>
                </span>
              </li>
            ))}
            {hidden > 0 && (
              <li className="text-xs text-white/40">
                + {hidden} producto{hidden === 1 ? "" : "s"} más
              </li>
            )}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 text-xs">
          <span className="text-white/40">
            {units} artículo{units === 1 ? "" : "s"}
          </span>
          <span className="inline-flex items-center gap-1 uppercase tracking-[0.16em] text-krov-rose/80 transition-colors group-hover:text-krov-rose">
            Ver detalle
            <ChevronRight
              size={14}
              aria-hidden
              className="transition-transform duration-300 group-hover:translate-x-0.5"
            />
          </span>
        </div>
      </Link>
    </li>
  );
}

function StatePanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="krov-enter rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center text-sm leading-relaxed text-white/45">
      <p className="mb-2 text-base text-white" style={{ fontFamily: SERIF }}>
        {title}
      </p>
      {children}
    </div>
  );
}

/** Mirrors `OrderCard` line for line, so the list resolves without a jump. */
function OrdersSkeleton() {
  return (
    <>
      <LoadingAnnouncement label="Cargando tus pedidos…" />
      <SkeletonRegion as="ul" className="space-y-4">
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="rounded-2xl border border-krov-smoke bg-black/50 p-5 sm:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <TextBone className="text-lg leading-snug" width="9rem" strong />
                <TextBone className="mt-0.5 text-xs" width="7rem" />
              </div>
              <TextBone className="text-base" width="5rem" strong />
            </div>
            <div className="mt-3 flex gap-2">
              <Bone className="h-[25px] w-24 rounded-full" />
              <Bone className="h-[21px] w-20" />
            </div>
            <div className="mt-4 space-y-1.5 border-t border-krov-smoke/70 pt-4">
              <TextBone className="text-sm" width="80%" />
              <TextBone className="text-sm" width="60%" />
            </div>
            <div className="mt-4 flex justify-between">
              <TextBone className="text-xs" width="4.5rem" />
              <TextBone className="text-xs" width="5.5rem" />
            </div>
          </li>
        ))}
      </SkeletonRegion>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

/** Red stays a signal: only a confirmed order gets the brand colour. */
const ORDER_STATUS: Record<
  AccountOrderRow["order_status"],
  { label: string; dot: string }
> = {
  pending: { label: "Pendiente", dot: "bg-white/40" },
  received: { label: "Confirmado", dot: "bg-krov-rose" },
  shipped: { label: "Enviado", dot: "bg-krov-bone" },
  denied: { label: "Cancelado", dot: "bg-white/20" },
};

const PAYMENT_STATUS: Record<AccountOrderRow["payment_status"], string> = {
  pending: "Pago pendiente",
  paid: "Pagado",
  failed: "Pago fallido",
  refunded: "Reembolsado",
};

function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
