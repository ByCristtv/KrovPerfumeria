"use client";

import Image from "next/image";
import Swal from "sweetalert2";
import { supabase } from "@/lib/supabase/client";
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
            <th className="px-4 py-3">Stock</th>
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
