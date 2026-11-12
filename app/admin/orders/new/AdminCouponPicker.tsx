"use client";

import { useId } from "react";
import { formatPrice } from "@/lib/format";
import {
  describeBenefit,
  describeConditions,
  evaluateCoupon,
} from "@/lib/coupons/discount";
import type { CouponEvaluation, UserCoupon } from "@/lib/coupons/types";

export type AdminCouponPickerStatus = "no-customer" | "loading" | "error" | "ready";

interface AdminCouponPickerProps {
  status: AdminCouponPickerStatus;
  /** The linked customer's SPENDABLE coupons (unlocked/claimed, not expired). */
  coupons: UserCoupon[];
  /** Goods subtotal of the order being built — what a coupon is priced on. */
  subtotal: number;
  selectedId: string | null;
  onSelect: (userCouponId: string) => void;
  onClear: () => void;
  onRetry: () => void;
  disabled?: boolean;
}

/**
 * The linked customer's level coupons, as a single-choice list.
 *
 * One radio group, so "one coupon per order" is something the control cannot
 * express a violation of. Coupons the current cart does not qualify for stay
 * visible but disabled, with the reason — "₡3.000 short" is something the admin
 * can tell the customer; a coupon that silently vanished is not.
 *
 * The amounts shown are a PREVIEW (lib/coupons/discount.ts mirrors the SQL);
 * the database recomputes and spends the coupon when the order is created.
 */
export default function AdminCouponPicker({
  status,
  coupons,
  subtotal,
  selectedId,
  onSelect,
  onClear,
  onRetry,
  disabled = false,
}: AdminCouponPickerProps) {
  const groupId = useId();

  if (status === "no-customer") {
    return (
      <p className="text-sm text-krov-ash">
        Selecciona un cliente registrado para ver sus cupones disponibles.
      </p>
    );
  }

  if (status === "loading") {
    return (
      <div role="status" aria-live="polite" className="h-14 animate-pulse bg-krov-void/60">
        <span className="sr-only">Cargando los cupones del cliente…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-red-300">No pudimos cargar los cupones del cliente.</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs text-krov-rose underline underline-offset-4 hover:text-krov-blush"
        >
          Reintentar
        </button>
      </div>
    );
  }

  if (coupons.length === 0) {
    return (
      <p className="text-sm text-krov-ash">
        Este cliente no tiene cupones disponibles en este momento.
      </p>
    );
  }

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-3 text-[11px] text-krov-ash">
        Un cupón por pedido. Se descuenta de los productos, no del envío.
      </legend>

      {coupons.map((coupon) => {
        const evaluation = evaluateCoupon(coupon, subtotal);
        const eligible = evaluation.ok;
        const checked = selectedId === coupon.id;
        const inputId = `${groupId}-${coupon.id}`;

        return (
          <label
            key={coupon.id}
            htmlFor={inputId}
            className={`flex items-start gap-3 border p-3 transition-colors ${
              checked
                ? "border-krov-blood bg-krov-blood/10"
                : eligible
                  ? "cursor-pointer border-krov-smoke hover:border-krov-blood/50"
                  : "cursor-not-allowed border-krov-smoke/70 opacity-60"
            }`}
          >
            <input
              id={inputId}
              type="radio"
              name={groupId}
              checked={checked}
              disabled={!eligible}
              onChange={() => onSelect(coupon.id)}
              className="mt-1 h-4 w-4 shrink-0 accent-krov-blood"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-krov-bone">{coupon.coupon.name}</span>
                <span className="font-mono text-[11px] text-krov-ash">{coupon.coupon.code}</span>
                <span className="text-xs text-krov-rose">{describeBenefit(coupon.coupon)}</span>
                <span className="border border-krov-smoke px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-krov-ash">
                  {coupon.status === "unlocked" ? "Sin reclamar" : "Reclamado"}
                </span>
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-krov-ash">
                {[...describeConditions(coupon.coupon), expiryLabel(coupon.expiresAt)].join(" · ")}
              </span>
              <span
                className={`mt-1 block text-xs ${eligible ? "text-krov-bone" : "text-amber-300"}`}
              >
                {evaluationLabel(evaluation, subtotal)}
              </span>
            </span>
          </label>
        );
      })}

      <label
        className={`flex cursor-pointer items-center gap-3 border p-3 text-sm transition-colors ${
          selectedId === null
            ? "border-krov-smoke bg-krov-void/40 text-krov-bone"
            : "border-krov-smoke/70 text-krov-ash hover:border-krov-smoke"
        }`}
      >
        <input
          type="radio"
          name={groupId}
          checked={selectedId === null}
          onChange={onClear}
          className="h-4 w-4 shrink-0 accent-krov-blood"
        />
        Sin cupón
      </label>
    </fieldset>
  );
}

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Sin vencimiento";
  return `Vence el ${new Date(expiresAt).toLocaleDateString("es-CR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/** Admin wording: the customer-facing copy says "tu compra", this says what to do. */
export function evaluationLabel(evaluation: CouponEvaluation, subtotal: number): string {
  if (evaluation.ok) return `Descuento en este pedido: ${formatPrice(evaluation.discount)}`;
  if (subtotal <= 0) return "Agrega productos para calcular el descuento.";
  switch (evaluation.reason) {
    case "min_subtotal":
      return `No aplica: faltan ${formatPrice(evaluation.shortfall)} en productos para la compra mínima.`;
    case "no_discount":
      return "No aplica: no genera descuento con este subtotal.";
    case "used":
      return "Ya fue utilizado.";
    case "expired":
      return "Venció.";
  }
}
