"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/format";
import {
  describeBenefit,
  describeConditions,
  effectiveStatus,
} from "@/lib/coupons/discount";
import { RANK_THRESHOLDS } from "@/lib/rank";
import type { UserCoupon } from "@/lib/coupons/types";

const SERIF = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

const DATE_FMT = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatDate(iso: string | null): string | null {
  return iso ? DATE_FMT.format(new Date(iso)) : null;
}

/** "Maestro" for level 5 — the ladder is the one source for level names. */
export function levelName(level: number): string {
  return RANK_THRESHOLDS[level - 1]?.rank ?? `Nivel ${level}`;
}

interface CouponCardProps {
  coupon: UserCoupon;
  /** Shown on an `unlocked` coupon; omit to hide the claim action. */
  onClaim?: (coupon: UserCoupon) => void;
  claiming?: boolean;
  /** Override "now" — only tests need it. */
  now?: Date;
}

/**
 * One coupon, as it appears under "Mis cupones".
 *
 * Presentation only: the benefit and conditions are derived from the coupon's own
 * terms (`describeBenefit` / `describeConditions`), so the card can never state a
 * percentage or a minimum the database does not enforce.
 */
export default function CouponCard({
  coupon,
  onClaim,
  claiming = false,
  now,
}: CouponCardProps) {
  const status = effectiveStatus(coupon, now);
  const spent = status === "used";
  const expired = status === "expired";
  const dimmed = spent || expired;

  const { coupon: terms } = coupon;
  const isPercentage = terms.discountType === "percentage";
  const headline = isPercentage
    ? `${terms.discountValue}%`
    : formatPrice(terms.discountValue);

  const expiry = formatDate(coupon.expiresAt);
  // A coupon on hold for an order whose payment is not confirmed yet: the
  // customer should know it is spoken for, and that it comes back if that order
  // fails.
  const onHold = spent && coupon.paymentConfirmedAt === null;

  return (
    <li
      className={`relative flex overflow-hidden rounded-2xl border bg-black/50 shadow-[0_12px_40px_rgba(0,0,0,0.35)] ${
        dimmed ? "border-krov-smoke/60" : "border-krov-blood/30"
      }`}
    >
      {/* Stub: the number the customer scans for. */}
      <div
        className={`flex w-28 shrink-0 flex-col items-center justify-center gap-1 border-r border-dashed px-3 py-5 text-center sm:w-32 ${
          dimmed
            ? "border-krov-smoke/60 text-white/30"
            : "border-krov-blood/30 text-krov-rose"
        }`}
      >
        <span
          className="text-3xl leading-none tabular-nums sm:text-4xl"
          style={{ fontFamily: SERIF }}
        >
          {headline}
        </span>
        <span className="text-[9px] uppercase tracking-[0.2em]">
          {isPercentage ? "de descuento" : "menos"}
        </span>
      </div>

      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3
              className={`text-lg leading-snug ${dimmed ? "text-white/45" : "text-white"}`}
              style={{ fontFamily: SERIF }}
            >
              {terms.name}
            </h3>
            <p className="mt-0.5 text-xs text-white/40">
              {describeBenefit(terms)} · Nivel {levelName(terms.levelRequired)}
            </p>
          </div>
          <StatusPill status={status} onHold={onHold} />
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/55">
          {describeConditions(terms).map((condition) => (
            <li key={condition} className="flex items-center gap-1.5">
              <span aria-hidden className="h-1 w-1 rounded-full bg-white/30" />
              {condition}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-white/35">
            {spent && coupon.usedAt
              ? onHold
                ? "En un pedido pendiente de pago. Si ese pedido no se completa, el cupón vuelve a estar disponible."
                : `Usado el ${formatDate(coupon.usedAt)}`
              : expired
                ? `Venció${expiry ? ` el ${expiry}` : ""}`
                : expiry
                  ? `Válido hasta el ${expiry}`
                  : "Sin fecha de vencimiento"}
          </p>

          {status === "unlocked" && onClaim && (
            <button
              type="button"
              onClick={() => onClaim(coupon)}
              disabled={claiming}
              className="min-h-10 border border-krov-blood/50 px-5 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {claiming ? "Reclamando…" : "Reclamar"}
            </button>
          )}

          {status === "claimed" && (
            <Link
              href="/products"
              className="min-h-10 inline-flex items-center border border-white/15 px-5 text-[10px] uppercase tracking-[0.2em] text-white/70 transition-colors duration-300 hover:border-krov-blood/60 hover:text-krov-rose"
            >
              Usar ahora
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function StatusPill({
  status,
  onHold,
}: {
  status: ReturnType<typeof effectiveStatus>;
  onHold: boolean;
}) {
  const label =
    status === "unlocked"
      ? "Nuevo"
      : status === "claimed"
        ? "Reclamado"
        : status === "used"
          ? onHold
            ? "En uso"
            : "Usado"
          : "Vencido";

  const tone =
    status === "unlocked"
      ? "border-krov-blood/60 bg-krov-blood/15 text-krov-rose"
      : status === "claimed"
        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
        : "border-white/15 text-white/45";

  return (
    <span
      className={`shrink-0 whitespace-nowrap border px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}
    >
      {label}
    </span>
  );
}
