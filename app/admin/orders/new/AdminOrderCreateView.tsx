"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase/client";
import { formatPrice } from "@/lib/format";
import { findCanton, findProvince } from "@/lib/cr-geo";
import {
  emptyAddressSelection,
  isCoherentAddressSelection,
  type AddressSelection,
} from "@/lib/cr-geo/selection";
import { useAdminProducts } from "@/hooks/useAdminProducts";
import { useRegisteredEmailMatch } from "@/hooks/useRegisteredEmailMatch";
import { useCustomerCoupons } from "@/hooks/useCustomerCoupons";
import { normalizeOptionalEmail } from "@/schemas/adminOrder";
import {
  applyCustomerToForm,
  type AutofillMode,
} from "@/lib/orders/customerAutofill";
import { quoteAdminShipping } from "@/lib/orders/adminShipping";
import { evaluateCoupon, groupCoupons } from "@/lib/coupons/discount";
import { LOCAL_DELIVERY_AREA } from "@/lib/shipping/localDelivery";
import AdminContainer from "@/components/admin/ui/AdminContainer";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import AdminAddressFields from "./AdminAddressFields";
import AdminCouponPicker, {
  evaluationLabel,
  type AdminCouponPickerStatus,
} from "./AdminCouponPicker";
import Field from "./Field";
import CustomerCombobox from "./CustomerCombobox";
import EmailAccountHint from "./EmailAccountHint";
import { createAdminOrderAction } from "../actions";
import type {
  AdminCustomerMatch,
  AdminOrderInput,
  AdminShippingMethod,
} from "@/types/adminOrder";
import type { AdminVariantRow } from "@/types/product";

interface CartLine {
  variant: AdminVariantRow;
  quantity: number;
}

const TYPE_LABEL: Record<string, string> = {
  full_size: "Full size",
  decant: "Decant",
  set: "Set",
};

function effectivePrice(v: AdminVariantRow): number {
  return v.is_on_offer && v.offer_price != null ? v.offer_price : v.price;
}

/** Decants draw from a shared ml pool (variant.stock is 0); the RPC is the
 * authoritative stock gate. For full_size/set we cap by the on-hand stock. */
function maxQtyFor(v: AdminVariantRow): number {
  return v.product_type === "decant" ? 99 : Math.max(0, v.stock);
}
function isSellable(v: AdminVariantRow): boolean {
  return v.is_active && (v.product_type === "decant" || v.stock > 0);
}

export default function AdminOrderCreateView() {
  const router = useRouter();
  const [submitting, startSubmit] = useTransition();

  // ── Customer ──
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // The registered account this order will belong to (picked from the search or
  // accepted from the email hint), and the email the admin said "don't link"
  // for. Declining is remembered PER EMAIL: change the address and the question
  // is a new one.
  const [linked, setLinked] = useState<AdminCustomerMatch | null>(null);
  const [declinedFor, setDeclinedFor] = useState<string | null>(null);

  // ── Shipping ──
  // The three geographic levels move together, so they are held as ONE value:
  // the cascade's reset rules (lib/cr-geo/selection) return the next complete
  // selection, which makes "province changed, so the district below it is gone"
  // a single atomic state update instead of three that can interleave.
  const [address, setAddress] = useState<AddressSelection>(emptyAddressSelection);
  const { cantonCode } = address;
  const [exactAddress, setExactAddress] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState<AdminShippingMethod>("delivery");

  // ── Items ──
  const [lines, setLines] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // ── Money ──
  const [discount, setDiscount] = useState("");
  const [notes, setNotes] = useState("");
  // The zone rate from calculate_shipping_cost. Kept even for Cariari (where
  // the order ships free), so moving the district restores it instantly.
  const [shippingCost, setShippingCost] = useState<number | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);

  // ── Coupon ──
  // Remembered together with the account it belongs to. A selection made for
  // one customer can then never price another customer's order, whatever path
  // changes the link: the derivation below simply stops seeing it.
  const [couponPick, setCouponPick] = useState<{ userId: string; couponId: string } | null>(
    null
  );

  const { data: variants = [], isLoading: variantsLoading } = useAdminProducts();

  const emailKey = normalizeOptionalEmail(email) ?? "";
  const emailMatch = useRegisteredEmailMatch(email);
  const declined = declinedFor !== null && declinedFor === emailKey;

  const linkedUserId = linked?.user_id ?? null;
  const couponsQuery = useCustomerCoupons(linkedUserId);

  // ── Derived totals ──
  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + effectivePrice(l.variant) * l.quantity, 0),
    [lines]
  );

  const spendableCoupons = useMemo(
    () => groupCoupons(couponsQuery.data ?? []).available,
    [couponsQuery.data]
  );
  const selectedCoupon =
    couponPick && couponPick.userId === linkedUserId
      ? (spendableCoupons.find((c) => c.id === couponPick.couponId) ?? null)
      : null;
  // Picked for THIS customer, but a refetch no longer lists it as spendable
  // (spent on the website meanwhile, or expired): say so instead of letting
  // the discount line silently disappear.
  const couponVanished =
    couponPick !== null &&
    couponPick.userId === linkedUserId &&
    couponsQuery.isSuccess &&
    selectedCoupon === null;
  const couponEvaluation = selectedCoupon ? evaluateCoupon(selectedCoupon, subtotal) : null;
  const couponStatus: AdminCouponPickerStatus = !linkedUserId
    ? "no-customer"
    : couponsQuery.isPending
      ? "loading"
      : couponsQuery.isError
        ? "error"
        : "ready";

  // Same rule the server applies (lib/orders/adminShipping): Limón › Pococí ›
  // Cariari ships free; pickup is free; anything else pays the zone rate.
  const shippingQuote = quoteAdminShipping(
    method,
    { canton_code: address.cantonCode, district: address.district },
    shippingCost
  );

  // A coupon REPLACES the manual discount (one `discount` column per order).
  const manualDiscount = Math.max(0, Number(discount) || 0);
  const couponDiscount = couponEvaluation?.ok ? couponEvaluation.discount : 0;
  const discountValue = selectedCoupon ? couponDiscount : manualDiscount;
  const total = Math.max(0, subtotal + (shippingQuote.cost ?? 0) - discountValue);

  // ── Search results (exclude already-added) ──
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const added = new Set(lines.map((l) => l.variant.variant_id));
    return variants
      .filter((v) => isSellable(v) && !added.has(v.variant_id))
      .filter((v) =>
        `${v.name} ${v.brand} ${v.sku}`.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [search, variants, lines]);

  // Close the results dropdown on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Recompute shipping when canton / subtotal / method change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (method === "pickup") {
        setShippingCost(0);
        return;
      }
      if (!cantonCode || subtotal <= 0) {
        setShippingCost(null);
        return;
      }
      setShippingLoading(true);
      const { data, error } = await supabase.rpc("calculate_shipping_cost", {
        p_canton_code: cantonCode,
        p_subtotal: subtotal,
      });
      if (cancelled) return;
      setShippingCost(
        error || !data ? null : Number((data as { cost?: number }).cost ?? 0)
      );
      setShippingLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [cantonCode, subtotal, method]);

  // ── Customer ops ──
  const applyCustomer = (customer: AdminCustomerMatch, mode: AutofillMode) => {
    const next = applyCustomerToForm(
      { name, phone, email, address, exactAddress, reference },
      customer,
      mode
    );
    setName(next.name);
    setPhone(next.phone);
    setEmail(next.email);
    setAddress(next.address);
    setExactAddress(next.exactAddress);
    setReference(next.reference);
    if (customer.user_id !== linked?.user_id) {
      // A different account: the previous customer's coupon goes with them.
      setCouponPick(null);
    }
    setLinked(customer);
    setDeclinedFor(null);
  };

  const unlinkCustomer = () => {
    setLinked(null);
    setCouponPick(null);
  };

  const onEmailChange = (value: string) => {
    setEmail(value);
    // The link belongs to one identity. Typing a different address means the
    // admin is no longer talking about that account — keeping the link would
    // credit XP to someone the order's email no longer points at.
    if (linked && (normalizeOptionalEmail(value) ?? "") !== linked.email.toLowerCase()) {
      unlinkCustomer();
    }
  };

  const selectCoupon = (couponId: string) => {
    if (!linkedUserId) return;
    setCouponPick({ userId: linkedUserId, couponId });
    // The coupon takes the discount slot; a stale manual amount would only
    // be confusing once the field is disabled.
    setDiscount("");
  };

  // ── Item ops ──
  const addVariant = (v: AdminVariantRow) => {
    setLines((prev) => [...prev, { variant: v, quantity: 1 }]);
    setSearch("");
    setSearchFocused(false);
  };
  const setQty = (variantId: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.variant.variant_id === variantId
          ? { ...l, quantity: Math.max(1, Math.min(qty, maxQtyFor(l.variant) || 99)) }
          : l
      )
    );
  };
  const removeLine = (variantId: string) =>
    setLines((prev) => prev.filter((l) => l.variant.variant_id !== variantId));

  // ── Submit ──
  const handleSubmit = () => {
    const canton = findCanton(address.cantonCode);
    const province = findProvince(address.provinceCode);

    if (!name.trim()) return warn("Ingresa el nombre del cliente.");
    if (phone.trim().length < 8) return warn("Ingresa un teléfono válido (mín. 8 dígitos).");
    if (!canton || !province) return warn("Selecciona provincia y cantón.");
    // The selects only offer valid combinations; this catches a selection left
    // inconsistent by a stale saved value before the server has to reject it.
    if (!isCoherentAddressSelection(address))
      return warn("El distrito no pertenece al cantón seleccionado.");
    if (exactAddress.trim().length < 5) return warn("Ingresa las señas de entrega.");
    if (lines.length === 0) return warn("Agrega al menos un producto.");
    // Never create an order WITHOUT a discount the summary was showing: a
    // coupon that stopped qualifying (an item was removed) must be resolved.
    if (couponEvaluation && !couponEvaluation.ok)
      return warn(
        `El cupón seleccionado no aplica: ${evaluationLabel(couponEvaluation, subtotal)} Quítalo o ajusta el pedido.`
      );
    if (!selectedCoupon && discountValue > subtotal + (shippingQuote.cost ?? 0))
      return warn("El descuento no puede superar el total.");

    const input: AdminOrderInput = {
      customer: {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        // Explicit link wins; otherwise only an explicit "no" is sent. Silence
        // lets the database link a confirmed account that owns the email.
        user_id: linked?.user_id,
        link_account: !linked && declined ? false : undefined,
      },
      shipping: {
        address: exactAddress.trim(),
        canton_code: canton.code,
        canton_name: canton.name,
        province_name: province.name,
        district: address.district.trim() || undefined,
        reference: reference.trim() || undefined,
      },
      items: lines.map((l) => ({
        variant_id: l.variant.variant_id,
        quantity: l.quantity,
      })),
      shipping_method: method,
      // Exactly one of the two reductions travels; the server rejects both.
      discount: selectedCoupon ? undefined : manualDiscount || undefined,
      user_coupon_id: selectedCoupon?.id,
      notes: notes.trim() || undefined,
    };

    startSubmit(async () => {
      const result = await createAdminOrderAction(input);
      if (result.ok && result.data) {
        void couponsQuery.refetch();
        await Swal.fire({
          title: "Pedido creado",
          text: `#${result.data.order_number} · ${result.message}`,
          // A drift warning must be read, not flashed.
          ...(result.data.needs_review
            ? { icon: "warning" as const, showConfirmButton: true }
            : { icon: "success" as const, timer: 2600, showConfirmButton: false }),
        });
        router.push(`/admin/orders/${result.data.order_id}`);
      } else {
        // The coupon may have been spent elsewhere meanwhile — show the truth.
        if (selectedCoupon) void couponsQuery.refetch();
        Swal.fire({ icon: "error", title: "No se pudo crear", text: result.message });
      }
    });
  };

  function warn(text: string) {
    Swal.fire({ icon: "warning", title: "Revisa el formulario", text });
  }

  return (
    <AdminContainer width="narrow">
      <AdminPageHeader
        eyebrow="Pedidos"
        title="Crear orden manual"
        description={
          <>
            Para clientes que escriben por WhatsApp, redes o teléfono. El pedido
            queda <span className="text-krov-rose">pendiente de pago</span>.
          </>
        }
        backHref="/admin/orders"
        backLabel="Volver a órdenes"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
          {/* ── Left: form ── */}
          <div className="space-y-5">
            {/* Customer */}
            <Panel title="Cliente">
              <div className="mb-4">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-krov-ash">
                  Cliente registrado
                </span>
                <CustomerCombobox
                  onSelect={(c) => applyCustomer(c, "replace")}
                  disabled={submitting}
                />
                <p className="mt-1 text-[11px] text-krov-ash">
                  Opcional. Si el cliente tiene cuenta, el pedido se vincula a ella,
                  suma XP al recibirse y puedes aplicar sus cupones.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Nombre *">
                  <input className="adm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del cliente" />
                </Field>
                <Field label="Teléfono *">
                  <input className="adm-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="8888-8888" inputMode="tel" />
                </Field>
                <Field label="Correo (opcional)">
                  <input
                    className="adm-input"
                    value={email}
                    onChange={(e) => onEmailChange(e.target.value)}
                    onBlur={emailMatch.onBlur}
                    placeholder="cliente@correo.com"
                    inputMode="email"
                    type="email"
                    autoComplete="off"
                    aria-describedby="order-email-hint"
                  />
                </Field>
              </div>
              <div id="order-email-hint" aria-live="polite">
                <EmailAccountHint
                  linked={linked}
                  match={emailMatch.match}
                  declined={declined}
                  isChecking={emailMatch.isChecking}
                  isError={emailMatch.isError}
                  onLink={(c) => applyCustomer(c, "fill-blanks")}
                  onUnlink={() => {
                    unlinkCustomer();
                    setDeclinedFor(emailKey || null);
                  }}
                  onDecline={() => setDeclinedFor(emailKey)}
                  onUndoDecline={() => setDeclinedFor(null)}
                />
              </div>
            </Panel>

            {/* Shipping */}
            <Panel title="Entrega">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <AdminAddressFields value={address} onChange={setAddress} />
                <Field label="Referencia (opcional)">
                  <input className="adm-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej. frente al parque" />
                </Field>
              </div>
              <Field label="Señas exactas *" className="mt-4">
                <textarea
                  className="adm-input resize-none"
                  rows={2}
                  value={exactAddress}
                  onChange={(e) => setExactAddress(e.target.value)}
                  placeholder="200m sur de la iglesia, casa azul portón negro"
                />
              </Field>
            </Panel>

            {/* Products */}
            <Panel title="Productos">
              <div className="relative" ref={searchRef}>
                <input
                  className="adm-input"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSearchFocused(true);
                  }}
                  onFocus={() => setSearchFocused(true)}
                  placeholder={
                    variantsLoading ? "Cargando catálogo…" : "Buscar por nombre, marca o SKU…"
                  }
                  disabled={variantsLoading}
                />
                {searchFocused && results.length > 0 && (
                  <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-none border border-krov-blood/30 bg-krov-ink shadow-2xl">
                    {results.map((v) => (
                      <li key={v.variant_id}>
                        <button
                          type="button"
                          onClick={() => addVariant(v)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[#1f1f1f]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-krov-bone">
                              {v.name} <span className="text-krov-ash">· {v.brand}</span>
                            </span>
                            <span className="block text-[11px] text-krov-ash">
                              {v.size_ml} ml · {TYPE_LABEL[v.product_type] ?? v.product_type} ·{" "}
                              <span className="font-mono">{v.sku}</span>
                              {v.product_type !== "decant" && ` · stock ${v.stock}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold text-krov-rose tabular-nums">
                            {formatPrice(effectivePrice(v))}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {searchFocused && search.trim() && results.length === 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-none border border-krov-smoke bg-krov-ink px-3 py-3 text-sm text-krov-ash">
                    Sin coincidencias disponibles.
                  </div>
                )}
              </div>

              {/* Cart lines */}
              <div className="mt-4">
                {lines.length === 0 ? (
                  <p className="py-6 text-center text-sm text-krov-ash">
                    Aún no has agregado productos.
                  </p>
                ) : (
                  <ul className="divide-y divide-krov-smoke/70">
                    {lines.map((l) => {
                      const lineTotal = effectivePrice(l.variant) * l.quantity;
                      const overStock =
                        l.variant.product_type !== "decant" &&
                        l.quantity > l.variant.stock;
                      return (
                        <li key={l.variant.variant_id} className="flex items-center gap-3 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-krov-bone">
                              {l.variant.name}{" "}
                              <span className="text-krov-ash">· {l.variant.size_ml} ml</span>
                            </p>
                            <p className="text-[11px] text-krov-ash">
                              <span className="font-mono">{l.variant.sku}</span> ·{" "}
                              {formatPrice(effectivePrice(l.variant))} c/u
                              {overStock && (
                                <span className="text-amber-400"> · excede stock ({l.variant.stock})</span>
                              )}
                            </p>
                          </div>
                          <QtyStepper
                            value={l.quantity}
                            max={maxQtyFor(l.variant) || 99}
                            onChange={(q) => setQty(l.variant.variant_id, q)}
                          />
                          <span className="w-24 shrink-0 text-right text-sm font-medium text-krov-bone tabular-nums">
                            {formatPrice(lineTotal)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeLine(l.variant.variant_id)}
                            aria-label="Quitar"
                            className="shrink-0 rounded-none p-1 text-krov-ash hover:bg-white/10 hover:text-red-300"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Panel>

            {/* Coupon */}
            <Panel
              title={
                linked
                  ? `Cupones de ${linked.full_name?.trim() || linked.email}`
                  : "Cupones del cliente"
              }
            >
              <AdminCouponPicker
                status={couponStatus}
                coupons={spendableCoupons}
                subtotal={subtotal}
                selectedId={selectedCoupon?.id ?? null}
                onSelect={selectCoupon}
                onClear={() => setCouponPick(null)}
                onRetry={() => void couponsQuery.refetch()}
                disabled={submitting}
              />
            </Panel>

            {/* Notes */}
            <Panel title="Notas internas (opcional)">
              <textarea
                className="adm-input resize-none"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. cliente pidió entrega después de las 5pm"
              />
            </Panel>
          </div>

          {/* ── Right: summary ── */}
          <aside className="lg:sticky lg:top-24 space-y-4">
            <Panel title="Resumen">
              <Field label="Método de envío" className="mb-4">
                <select
                  className="adm-input"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as AdminShippingMethod)}
                >
                  <option value="delivery">Envío a domicilio</option>
                  <option value="pickup">Retiro en tienda</option>
                </select>
              </Field>

              <dl className="space-y-2 text-sm">
                <Line label="Subtotal" value={formatPrice(subtotal)} />
                <Line
                  label="Envío"
                  value={
                    shippingQuote.status === "pickup" || shippingQuote.status === "local_delivery"
                      ? "Gratis"
                      : shippingLoading
                      ? "Calculando…"
                      : shippingQuote.cost == null
                      ? "—"
                      : shippingQuote.cost === 0
                      ? "Gratis"
                      : formatPrice(shippingQuote.cost)
                  }
                />
                {shippingQuote.status === "local_delivery" && (
                  <p
                    className="-mt-1 text-right text-[11px] text-emerald-300"
                    aria-live="polite"
                  >
                    Envío gratis · entrega local {LOCAL_DELIVERY_AREA.districtName},{" "}
                    {LOCAL_DELIVERY_AREA.cantonName}
                  </p>
                )}
                {couponVanished && (
                  <p role="alert" className="text-[11px] text-amber-300">
                    El cupón elegido ya no está disponible para este cliente (pudo usarse en
                    otro pedido o vencer). Elige otro o continúa sin cupón.
                  </p>
                )}
                {selectedCoupon ? (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="min-w-0 text-krov-ash">
                      Cupón{" "}
                      <span className="font-mono text-[11px] text-krov-bone">
                        {selectedCoupon.coupon.code}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCouponPick(null)}
                        disabled={submitting}
                        className="ml-2 text-[11px] text-krov-rose underline underline-offset-4 hover:text-krov-blush disabled:opacity-50"
                      >
                        Quitar
                      </button>
                    </dt>
                    <dd
                      className={`shrink-0 tabular-nums ${
                        couponEvaluation?.ok ? "text-krov-bone" : "text-amber-300"
                      }`}
                    >
                      {couponEvaluation?.ok ? `−${formatPrice(couponDiscount)}` : "No aplica"}
                    </dd>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-krov-ash">Descuento</dt>
                    <input
                      className="adm-input w-28 text-right py-1.5"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value.replace(/[^0-9]/g, ""))}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label="Descuento manual"
                    />
                  </div>
                )}
                <div className="flex justify-between border-t border-krov-smoke pt-3 text-base font-semibold">
                  <dt className="text-krov-bone">Total</dt>
                  <dd className="tabular-nums text-krov-rose">{formatPrice(total)}</dd>
                </div>
              </dl>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || lines.length === 0}
                className="mt-5 w-full rounded-none bg-krov-blood py-3 text-sm font-semibold text-black transition hover:bg-krov-crimson disabled:opacity-50"
              >
                {submitting ? "Creando pedido…" : "Crear pedido"}
              </button>
              <p className="mt-2 text-center text-[11px] text-krov-ash">
                Se creará como pendiente de pago.
              </p>
            </Panel>
          </aside>
        </div>

      <style jsx global>{`
        .adm-input {
          width: 100%;
          padding: 0.6rem 0.85rem;
          background-color: #111;
          border: 1px solid rgba(255,11,85, 0.25);
          border-radius: 0.5rem;
          color: #f4eef0;
          font-size: 0.875rem;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .adm-input::placeholder {
          color: #6f656c;
        }
        .adm-input:focus {
          border-color: #ff4d74;
          outline: none;
          box-shadow: 0 0 0 1px #ff4d74;
        }
        .adm-input:disabled {
          opacity: 0.5;
        }
      `}</style>
    </AdminContainer>
  );
}

// ── Small presentational helpers ──

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-none border border-krov-smoke bg-krov-graphite p-4 sm:p-5">
      <h2 className="mb-4 text-xs uppercase tracking-wider text-krov-rose">{title}</h2>
      {children}
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-krov-ash">
      <dt>{label}</dt>
      <dd className="tabular-nums text-krov-bone">{value}</dd>
    </div>
  );
}

function QtyStepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (q: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center rounded-none border border-krov-smoke">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= 1}
        className="px-2 py-1 text-krov-rose disabled:opacity-30"
        aria-label="Restar"
      >
        −
      </button>
      <input
        value={value}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9]/g, "")) || 1)}
        inputMode="numeric"
        className="w-9 bg-transparent text-center text-sm text-krov-bone outline-none"
        aria-label="Cantidad"
      />
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        className="px-2 py-1 text-krov-rose disabled:opacity-30"
        aria-label="Sumar"
      >
        +
      </button>
    </div>
  );
}
