"use client";

import Link from "next/link";
import { useCart } from "@/hooks/useCart";
import { useCartPricing } from "@/hooks/useCartPricing";
import { useIsMounted } from "@/hooks/useIsMounted";
import { useShippingPreview } from "@/hooks/useShippingPreview";
import { formatPrice } from "@/lib/format";
import { resolveShippingCost } from "@/lib/shipping/localDelivery";

interface OrderSummaryProps {
  /**
   * Selected canton code from the checkout form. Optional — when undefined,
   * the shipping line shows a "pick a canton" hint instead of a calculated cost.
   */
  cantonCode: string | undefined;
  /** Selected district name — half of the free-local-delivery condition. */
  district?: string;
  /** The customer's "Cariari centro" opt-in, if they ticked it. */
  localDelivery?: boolean;
}

export default function OrderSummary({
  cantonCode,
  district,
  localDelivery,
}: OrderSummaryProps) {
  // Zustand cart persists in localStorage. SSR renders empty, client hydrates
  // with the real cart → guard against the hydration mismatch.
  const mounted = useIsMounted();
  const { cart, totalItems } = useCart();

  // Wholesale-aware subtotal drives the shipping preview + free-shipping
  // threshold so they match what place_order will compute server-side.
  const { pricing } = useCartPricing(cart);
  const goodsSubtotal = pricing.subtotal;

  const {
    data: shipping,
    isLoading: shippingLoading,
    isError: shippingError,
  } = useShippingPreview({
    canton_code: cantonCode,
    subtotal: goodsSubtotal,
    enabled: mounted && cart.length > 0,
  });

  if (!mounted) return null;

  // ──────── Empty cart ────────
  if (cart.length === 0) {
    return (
      <aside className="rounded-none border border-krov-smoke bg-krov-coal p-5 text-center">
        <p className="text-sm text-krov-ash">Tu carrito está vacío.</p>
        <Link
          href="/"
          className="inline-block mt-4 text-sm text-krov-rose underline underline-offset-4 hover:text-krov-blush"
        >
          Seguir comprando
        </Link>
      </aside>
    );
  }

  /*
   * The same override the server will apply, run against the same RPC result.
   *
   * Calling the shared rule — rather than special-casing the display — is what
   * keeps the preview honest: this line and the amount the order is actually
   * created with come from one function, so they cannot disagree.
   */
  const resolved = resolveShippingCost(
    shipping?.cost ?? 0,
    { canton_code: cantonCode ?? "", district },
    localDelivery
  );
  const shippingCost = resolved.cost;
  const total = goodsSubtotal + shippingCost;

  // A threshold the customer no longer needs to reach is not worth nagging about.
  const thresholdRemaining =
    !resolved.localDeliveryApplied &&
    shipping?.free_shipping_threshold != null &&
    !shipping.free_shipping_applied
      ? shipping.free_shipping_threshold - goodsSubtotal
      : 0;

  return (
    <aside className="rounded-none border border-krov-smoke bg-krov-coal p-5 h-fit lg:sticky lg:top-28">
      <h2 className="text-lg font-semibold text-krov-bone">Resumen</h2>
      <p className="text-xs text-krov-dust mt-0.5">
        {totalItems} {totalItems === 1 ? "producto" : "productos"}
      </p>

      {/* ──────── Items list ──────── */}
      <ul className="mt-4 space-y-2 text-sm border-b border-krov-smoke/70 pb-4">
        {cart.map((item) => {
          const line = pricing.lines[item.variant_id];
          const lineTotal = line?.lineTotal ?? item.price * item.quantity;
          return (
            <li
              key={item.variant_id}
              className="flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-krov-bone truncate">{item.product_name}</p>
                <p className="text-xs text-krov-dust">
                  {item.size_ml} ml · cant. {item.quantity}
                  {line?.wasWholesale && (
                    <span className="ml-2 border border-krov-blood/40 bg-krov-blood/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-krov-rose">
                      Mayorista
                    </span>
                  )}
                </p>
              </div>
              <span className="text-krov-bone shrink-0 tabular-nums">
                {formatPrice(lineTotal)}
              </span>
            </li>
          );
        })}
      </ul>

      {/* ──────── Totals ──────── */}
      <dl className="mt-4 space-y-2 text-sm">
        {pricing.hasWholesaleApplied && (
          <div className="flex items-center justify-between text-krov-rose">
            <dt>Ahorro mayorista</dt>
            <dd className="tabular-nums">−{formatPrice(pricing.wholesaleSavings)}</dd>
          </div>
        )}

        <div className="flex items-center justify-between text-krov-ash">
          <dt>Subtotal</dt>
          <dd className="tabular-nums">{formatPrice(goodsSubtotal)}</dd>
        </div>

        <div className="flex items-center justify-between text-krov-ash">
          <dt>Envío</dt>
          <dd className="tabular-nums text-right">
            {renderShippingValue({
              cantonCode,
              shipping,
              localDeliveryApplied: resolved.localDeliveryApplied,
              loading: shippingLoading,
              error: shippingError,
            })}
          </dd>
        </div>

        {thresholdRemaining > 0 && (
          <p className="text-xs text-emerald-300 bg-emerald-500/10 rounded-none px-3 py-2 leading-snug">
            Te faltan <strong>{formatPrice(thresholdRemaining)}</strong> para
            envío gratis en {shipping?.zone_name}.
          </p>
        )}

        <div className="flex items-center justify-between text-base font-semibold text-krov-bone pt-3 border-t border-krov-smoke">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatPrice(total)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] text-krov-dust leading-relaxed">
        Precios incluyen IVA. El envío se confirma con el cantón seleccionado.
      </p>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface RenderShippingArgs {
  cantonCode: string | undefined;
  shipping: { cost: number; zone_name: string; free_shipping_applied: boolean } | undefined;
  /** True when the "Cariari centro" opt-in zeroed the cost. */
  localDeliveryApplied: boolean;
  loading: boolean;
  error: boolean;
}

function renderShippingValue({
  cantonCode,
  shipping,
  localDeliveryApplied,
  loading,
  error,
}: RenderShippingArgs) {
  if (!cantonCode) {
    return (
      <span className="text-xs text-krov-dust">Selecciona un cantón</span>
    );
  }
  if (loading && !shipping) {
    return <span className="text-xs text-krov-dust">Calculando…</span>;
  }
  if (error) {
    return (
      <span className="text-xs text-red-400">Error al calcular envío</span>
    );
  }
  if (!shipping) return null;

  // Checked before the zone's own threshold: both render "Gratis", but this one
  // names the reason, which is the thing the customer just opted into.
  if (localDeliveryApplied) {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-200 text-[11px] font-semibold uppercase tracking-wide">
          Gratis
        </span>
        <span className="text-[10px] text-krov-dust">Cariari centro</span>
      </span>
    );
  }

  if (shipping.free_shipping_applied) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-200 text-[11px] font-semibold uppercase tracking-wide">
          Gratis
        </span>
      </span>
    );
  }

  return <>{formatPrice(shipping.cost)}</>;
}
