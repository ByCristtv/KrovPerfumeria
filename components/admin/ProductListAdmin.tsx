"use client";

import { useState } from "react";
import Image from "next/image";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase/client";
import { setSupplierAvailabilityAction } from "@/app/admin/products/actions";
import { resolveAvailability, type AvailabilityStatus } from "@/lib/stock";
import type { AdminVariantRow } from "@/types/product";

const currency = new Intl.NumberFormat("es-CR", {
  style: "currency",
  currency: "CRC",
  maximumFractionDigits: 0,
});

/**
 * Thumbnail box, in px. Roughly half the public catalog thumbnail (the cart
 * line renders the same photo at 96px) and it keeps the card's 4:5 crop, so a
 * bottle reads the same shape here as in the storefront. This is a visual
 * reference for the admin scanning rows — deliberately too small to inspect.
 */
const THUMB_WIDTH = 48;
const THUMB_HEIGHT = 60;

/**
 * One cell of the "Miniatura" column.
 *
 * The photography is shot on white, so the box keeps the same light plate the
 * catalog card uses — a dark tile would show a white rectangle. `alt=""` is
 * correct: the product name is already in the adjacent cell, so announcing it
 * again is noise for a screen reader.
 */
function VariantThumbnail({ url, name }: { url: string | null; name: string }) {
  if (!url) {
    return (
      <div
        style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
        className="flex items-center justify-center border border-krov-smoke/70 bg-krov-graphite text-[9px] uppercase tracking-wider text-krov-ash"
        title={`${name} — sin imagen`}
      >
        —
      </div>
    );
  }

  return (
    <div
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
      className="relative overflow-hidden border border-krov-smoke/70 bg-krov-linen"
    >
      <Image
        src={url}
        alt=""
        fill
        sizes={`${THUMB_WIDTH}px`}
        className="object-contain p-1"
      />
    </div>
  );
}

/**
 * Costa Rica time on purpose: this component is server-rendered and then
 * hydrated in the admin's browser, and a timezone-dependent date would render
 * differently in the two places (a hydration mismatch near midnight).
 */
const CHECKED_DATE = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "America/Costa_Rica",
});

function formatChecked(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : CHECKED_DATE.format(date);
}

/** What a customer would see for this row, in the storefront's own words. */
const STORE_STATUS_LABEL: Record<AvailabilityStatus, string> = {
  in_stock: "En stock",
  made_to_order: "Por encargo",
  sold_out: "Agotado",
};

const SUPPLIER_BTN =
  "border border-krov-smoke px-2 py-1 text-[11px] uppercase tracking-wide text-krov-bone transition-colors hover:bg-krov-graphite disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The "Proveedor" cell: what an admin last saw on the SUPPLIER's website for
 * this variant - never KROV's own inventory, which has its own column.
 *
 * Three recorded states (disponible / agotado / sin verificar) and one derived
 * line, "En tienda", showing what customers will actually see. The derived line
 * is the point: the supplier flag only matters while KROV has no stock of its
 * own, and spelling out the outcome saves the admin from working that out.
 *
 * Decants get no control - their only inventory is KROV's ml pool, and the
 * database refuses to flag them anyway. A row whose supplier data could not be
 * loaded (migration pending) shows a dash instead of guessing "agotado".
 */
function SupplierCell({
  row,
  onChanged,
}: {
  row: AdminVariantRow;
  onChanged?: () => void;
}) {
  const [pending, setPending] = useState(false);

  if (row.product_type === "decant") {
    return (
      <span
        className="text-krov-ash"
        title="Los decants se venden del pool de ml propio; no usan disponibilidad del proveedor."
      >
        No aplica
      </span>
    );
  }

  if (row.supplier_available === undefined) {
    return (
      <span
        className="text-krov-ash"
        title="No se pudo leer la disponibilidad del proveedor (¿falta aplicar la migración 20261029000100?)."
      >
        —
      </span>
    );
  }

  const available = row.supplier_available;
  const checked = formatChecked(row.supplier_checked_at);
  const verified = row.supplier_checked_at != null;

  const store = resolveAvailability(
    {
      product_type: row.product_type,
      size_ml: row.size_ml,
      stock: row.stock,
      supplier_available: available,
    },
    null
  );

  const label = available
    ? { text: "Disponible en proveedor", className: "text-emerald-400" }
    : verified
      ? { text: "Agotado en proveedor", className: "text-krov-ash" }
      : { text: "Sin verificar", className: "italic text-krov-ash" };

  const run = async (value: boolean) => {
    setPending(true);
    try {
      const result = await setSupplierAvailabilityAction(row.variant_id, value);
      if (!result.ok) {
        void Swal.fire({
          icon: "error",
          title: "No se pudo actualizar",
          text: result.message,
          confirmButtonColor: "#ff4d74",
        });
        return;
      }
      onChanged?.();
      void Swal.fire({
        toast: true,
        position: "top-end",
        icon: "success",
        title: result.message,
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true,
      });
    } catch {
      void Swal.fire({
        icon: "error",
        title: "No se pudo actualizar",
        text: "Error de conexión. Intenta de nuevo.",
        confirmButtonColor: "#ff4d74",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-w-[11rem] flex-col gap-1.5">
      <div>
        <span className={label.className}>{label.text}</span>
        {checked && (
          <span className="block text-[11px] text-krov-ash">
            verificado {checked}
          </span>
        )}
      </div>

      {row.is_active && (
        <span
          className="text-[11px] text-krov-ash"
          title={
            available && row.stock > 0
              ? "Hay stock propio: el proveedor no se usa mientras haya unidades."
              : undefined
          }
        >
          En tienda:{" "}
          <span className="text-krov-bone">{STORE_STATUS_LABEL[store.status]}</span>
        </span>
      )}

      <div className="flex flex-wrap gap-1.5">
        {!available && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(true)}
            aria-label={`Marcar ${row.sku} como disponible en el proveedor`}
            className={SUPPLIER_BTN}
          >
            Marcar disponible
          </button>
        )}
        {(available || !verified) && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(false)}
            aria-label={`Marcar ${row.sku} como agotado en el proveedor`}
            className={SUPPLIER_BTN}
          >
            Marcar agotado
          </button>
        )}
        {verified && (
          // Same value again: records "I checked today" without changing the answer.
          <button
            type="button"
            disabled={pending}
            onClick={() => run(available)}
            aria-label={`Reconfirmar la disponibilidad de ${row.sku} en el proveedor`}
            className={SUPPLIER_BTN}
          >
            Reconfirmar
          </button>
        )}
      </div>
    </div>
  );
}

interface ProductListAdminProps {
  /** One page of variants, fetched + paginated server-side. */
  rows: AdminVariantRow[];
  onEdit?: (productId: string, variantId: string) => void;
  /** Called after a successful mutation so the server page can re-fetch. */
  onChanged?: () => void;
}

export default function ProductListAdmin({ rows, onEdit, onChanged }: ProductListAdminProps) {
  const variants = rows;

  const toggleActive = async (
    variantId: string,
    currentlyActive: boolean,
    label: string
  ) => {
    const action = currentlyActive ? "desactivar" : "reactivar";
    const result = await Swal.fire({
      title: `¿${currentlyActive ? "Desactivar" : "Reactivar"} variante?`,
      text: `Se va a ${action} la variante "${label}".`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ff4d74",
      cancelButtonColor: "#2a2130",
      confirmButtonText: `Sí, ${action}`,
      cancelButtonText: "Cancelar",
    });

    if (!result.isConfirmed) return;

    const { error } = await supabase
      .from("product_variants")
      .update({ is_active: !currentlyActive })
      .eq("id", variantId);

    if (error) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: `No se pudo ${action} la variante: ${error.message}`,
      });
      return;
    }

    onChanged?.();

    Swal.fire({
      icon: "success",
      title: currentlyActive ? "Variante desactivada" : "Variante reactivada",
      text: `La variante ha sido ${currentlyActive ? "desactivada" : "reactivada"} exitosamente.`,
    });
  };

  if (variants.length === 0) {
    return (
      <p className="text-krov-bone text-center py-12">
        No hay variantes disponibles.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-none border border-krov-blood/30 bg-black shadow-[0_20px_60px_rgba(0,0,0,0.3)]">
      <table className="min-w-full text-sm text-left text-krov-bone">
        <thead className="bg-krov-graphite text-krov-rose uppercase text-xs tracking-wider">
          <tr>
            <th className="px-4 py-3">Miniatura</th>
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">Producto</th>
            <th className="px-4 py-3">Marca</th>
            <th className="px-4 py-3">Tipo</th>
            <th className="px-4 py-3">Tamaño</th>
            <th className="px-4 py-3">Precio</th>
            <th className="px-4 py-3">Mayorista</th>
            <th className="px-4 py-3">Stock propio</th>
            <th className="px-4 py-3">Proveedor</th>
            <th className="px-4 py-3">Estado</th>
            <th className="px-4 py-3 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((v) => {
            const effectivePrice =
              v.is_on_offer && v.offer_price != null ? v.offer_price : v.price;

            return (
              <tr
                key={v.variant_id}
                className="border-t border-krov-smoke/70 hover:bg-krov-graphite/60 transition-colors"
              >
                <td className="px-4 py-3">
                  <VariantThumbnail url={v.image_url} name={v.name} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-krov-ash">
                  {v.sku}
                </td>
                <td className="px-4 py-3 font-medium">{v.name}</td>
                <td className="px-4 py-3 text-krov-ash">{v.brand}</td>
                <td className="px-4 py-3 capitalize text-krov-ash">
                  {{
                    decant: "Decant",
                    set: "Set",
                    full_size: "Full size"
                  }[v.product_type] || "Desconocido"}
                </td>
                <td className="px-4 py-3 text-krov-ash">{v.size_ml} ml</td>
                <td className="px-4 py-3">
                  {v.is_on_offer && v.offer_price != null ? (
                    <div className="flex flex-col">
                      <span className="line-through text-xs text-krov-ash">
                        {currency.format(v.price)}
                      </span>
                      <span className="text-krov-rose font-semibold">
                        {currency.format(effectivePrice)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-krov-rose font-semibold">
                      {currency.format(effectivePrice)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {v.wholesale_price != null ? (
                    <div className="flex flex-col">
                      <span className="text-krov-rose font-semibold">
                        {currency.format(v.wholesale_price)}
                      </span>
                      {v.min_wholesale_quantity != null && (
                        <span className="text-xs text-krov-ash">
                          mín. {v.min_wholesale_quantity}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-krov-ash">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      v.product_type === "decant"
                        ? "text-krov-rose"
                        : v.stock <= 0
                        ? "text-red-400"
                        : v.stock < 5
                        ? "text-yellow-400"
                        : "text-krov-bone"
                    }
                  >
                    {v.product_type === "decant" ? "X" : v.stock}
                  </span>
                </td>
                <td className="px-4 py-3 align-top text-xs">
                  <SupplierCell row={v} onChanged={onChanged} />
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      v.is_active
                        ? "text-emerald-400"
                        : "text-krov-ash italic"
                    }
                  >
                    {v.is_active ? "Activa" : "Inactiva"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    onClick={() => onEdit?.(v.product_id, v.variant_id)}
                    className="bg-blue-950 hover:bg-blue-800 text-white px-3 py-1.5 rounded-none text-xs font-medium transition-colors mr-2"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() =>
                      toggleActive(
                        v.variant_id,
                        v.is_active,
                        `${v.name} · ${v.size_ml}ml · ${v.sku}`
                      )
                    }
                    className={`${
                      v.is_active
                        ? "bg-red-900 hover:bg-red-700"
                        : "bg-emerald-900 hover:bg-emerald-700"
                    } text-white px-3 py-1.5 rounded-none text-xs font-medium transition-colors`}
                  >
                    {v.is_active ? "Desactivar" : "Reactivar"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
