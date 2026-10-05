"use client";

import Link from "next/link";
import { useId } from "react";
import { formatPrice } from "@/lib/format";
import { describeBenefit, describeRejection } from "@/lib/coupons/discount";
import type { CheckoutCouponState } from "@/hooks/useCheckoutCoupon";

interface CheckoutCouponSelectorProps {
  state: CheckoutCouponState;
  /** Blocks changes while a submit is in flight. */
  disabled?: boolean;
}

/**
 * The "Cupón de nivel" block, rendered right above the pay button.
 *
 * One radio group, so "only one coupon per order" is something the control makes
 * impossible to violate rather than something the customer has to know. Coupons
 * the cart doesn't qualify for stay in the list, disabled, with the reason — a
 * customer who is ₡3.000 short should see that, not wonder where their coupon
 * went.
 *
 * Presentation over `useCheckoutCoupon`; all rules (claim-on-select, removal when
 * the subtotal drops) live in the hook.
 */
export default function CheckoutCouponSelector({
  state,
  disabled = false,
}: CheckoutCouponSelectorProps) {
  const groupId = useId();
  const { availability, options, selectedId, discount, isClaiming } = state;

  // Guests have no coupons; a block that can only say "no" is clutter.
  if (availability === "guest") return null;

  return (
    <section
      aria-labelledby={`${groupId}-title`}
      className="rounded-none border border-krov-smoke bg-krov-coal p-5 sm:p-6"
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3
            id={`${groupId}-title`}
            className="text-base font-semibold text-krov-bone"
          >
            Cupón de nivel
          </h3>
          <p className="mt-0.5 text-xs text-krov-dust">
            Un cupón por pedido. Se descuenta de tus productos, no del envío.
          </p>
        </div>
        {selectedId && (
          <button
            type="button"
            onClick={state.clear}
            disabled={disabled}
            className="shrink-0 text-xs text-krov-rose underline underline-offset-4 hover:text-krov-blush disabled:opacity-50"
          >
            Quitar
          </button>
        )}
      </header>

      {availability === "loading" && (
        <div
          role="status"
          aria-live="polite"
          className="h-14 animate-pulse bg-krov-void/60"
        >
          <span className="sr-only">Cargando tus cupones…</span>
        </div>
      )}

      {availability === "error" && (
        <p role="alert" className="text-xs text-red-400">
          No pudimos cargar tus cupones. Puedes continuar sin uno.
        </p>
      )}

      {availability === "wholesale" && (
        <p className="text-xs leading-relaxed text-krov-dust">
          Tu cuenta mayorista ya tiene precios especiales; los cupones de nivel
          no se combinan con ellos.
        </p>
      )}

      {availability === "ready" && options.length === 0 && (
        <p className="text-xs leading-relaxed text-krov-dust">
          No tienes cupones disponibles. Sube de nivel para desbloquearlos.{" "}
          <Link
            href="/ranking"
            className="text-krov-rose underline underline-offset-4 hover:text-krov-blush"
          >
            Ver premios
          </Link>
        </p>
      )}

      {availability === "ready" && options.length > 0 && (
        <fieldset disabled={disabled} className="space-y-2">
          <legend className="sr-only">Elige un cupón para este pedido</legend>

          {options.map(({ coupon, evaluation, heldByThisCheckout }) => {
            const eligible = evaluation.ok;
            const checked = selectedId === coupon.id;
            const inputId = `${groupId}-${coupon.id}`;

            return (
              <label
                key={coupon.id}
                htmlFor={inputId}
                className={`flex items-start gap-3 border p-3.5 transition-colors ${
                  checked
                    ? "border-krov-blood bg-krov-blood/10"
                    : eligible
                      ? "cursor-pointer border-krov-edge hover:border-krov-blood/50"
                      : "cursor-not-allowed border-krov-smoke/70 opacity-60"
                }`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name={groupId}
                  checked={checked}
                  disabled={!eligible}
                  onChange={() => state.select(coupon.id)}
                  className="mt-1 h-4 w-4 shrink-0 accent-krov-blood"
                />

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-krov-bone">
                      {coupon.coupon.name}
                    </span>
                    <span className="text-xs text-krov-rose">
                      {describeBenefit(coupon.coupon)}
                    </span>
                    {coupon.status === "unlocked" && !heldByThisCheckout && (
                      <span className="border border-krov-blood/50 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-krov-rose">
                        Nuevo
                      </span>
                    )}
                  </span>

                  <span className="mt-0.5 block text-xs leading-relaxed text-krov-dust">
                    {evaluation.ok
                      ? `Ahorras ${formatPrice(evaluation.discount)} en este pedido`
                      : describeRejection(evaluation, coupon.coupon)}
                  </span>
                </span>
              </label>
            );
          })}

          {/* "No usar cupón" is an explicit option, not just an absence, so the
              group always has a visible resting state. */}
          <label
            className={`flex cursor-pointer items-center gap-3 border p-3.5 text-sm transition-colors ${
              selectedId === null
                ? "border-krov-edge bg-krov-void/40 text-krov-bone"
                : "border-krov-smoke/70 text-krov-ash hover:border-krov-edge"
            }`}
          >
            <input
              type="radio"
              name={groupId}
              checked={selectedId === null}
              onChange={state.clear}
              className="h-4 w-4 shrink-0 accent-krov-blood"
            />
            No usar cupón
          </label>
        </fieldset>
      )}

      {/* Live region: screen readers hear the saving and the background claim. */}
      <p role="status" aria-live="polite" className="sr-only">
        {isClaiming
          ? "Reclamando tu cupón…"
          : discount > 0
            ? `Cupón aplicado. Ahorras ${formatPrice(discount)}.`
            : ""}
      </p>
    </section>
  );
}
