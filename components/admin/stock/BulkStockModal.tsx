"use client";

import { useCallback, useMemo, useState } from "react";
import AdminSelect from "@/components/admin/ui/AdminSelect";
import Swal from "sweetalert2";
import { Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "@/components/ui/Modal";
import { useAdminProducts } from "@/hooks/useAdminProducts";
import { registerBulkStock } from "@/features/admin/registerBulkStock";
import { ADMIN_PRODUCTS_QUERY_KEY } from "@/features/admin/getProductsAdmin";
import { PRODUCTS_QUERY_KEY } from "@/hooks/useProducts";
import { classifyVariantWrite } from "@/lib/admin/homepageOffers";
import { notifyHomepageOffers } from "@/features/admin/notifyHomepageOffers";

interface BulkStockModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful batch so the caller can refresh the table. */
  onSuccess?: () => void;
}

type Option = { value: string; label: string };

/** One editable row in the form. `key` is a stable client id for React. */
interface Row {
  key: string;
  variantId: string;
  quantity: string;
}

let rowSeq = 0;
const newRow = (): Row => ({ key: `row-${rowSeq++}`, variantId: "", quantity: "" });

/**
 * Bulk incoming-stock registration.
 *
 * A dynamic form: the admin adds/removes rows, each picking a variant (searchable
 * dropdown) and an incoming quantity. Decants are excluded from the dropdown —
 * their liquid is tracked in the shared `products.decant_stock_ml` pool, not in
 * `variant.stock`. Submission is delegated to the `register_bulk_stock` RPC,
 * which applies the entire batch atomically (one transaction).
 */
export default function BulkStockModal({
  open,
  onClose,
  onSuccess,
}: BulkStockModalProps) {
  const { data: variants = [], isLoading } = useAdminProducts();
  const queryClient = useQueryClient();

  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Selectable variants: everything EXCEPT decants (pool-managed elsewhere).
  const stockableVariants = useMemo(
    () => variants.filter((v) => v.product_type !== "decant"),
    [variants]
  );

  const optionFor = useMemo(() => {
    const map = new Map<string, Option>();
    for (const v of stockableVariants) {
      map.set(v.variant_id, {
        value: v.variant_id,
        label: `${v.name} — ${v.brand} · ${v.sku} (${v.size_ml}ml · stock: ${v.stock})`,
      });
    }
    return map;
  }, [stockableVariants]);

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, newRow()]);

  const removeRow = (key: string) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.key !== key)));

  const resetAndClose = useCallback(() => {
  if (submitting) return;

  setRows([newRow()]);
  setNotes("");
  onClose();
  }, [submitting, onClose]);

  const handleSubmit = async () => {
    // Collect filled rows (a variant chosen + a positive integer quantity).
    const items = rows
      .map((r) => ({ variant_id: r.variantId, quantity: Number(r.quantity) }))
      .filter((it) => it.variant_id && Number.isInteger(it.quantity) && it.quantity > 0);

    if (items.length === 0) {
      Swal.fire({
        icon: "warning",
        title: "Nada que registrar",
        text: "Agrega al menos una variante con una cantidad mayor a 0.",
      });
      return;
    }

    const uniqueVariants = new Set(items.map((it) => it.variant_id));
    if (uniqueVariants.size !== items.length) {
      Swal.fire({
        icon: "warning",
        title: "Variante repetida",
        text: "Cada variante puede aparecer una sola vez. Combina las cantidades.",
      });
      return;
    }

    try {
      setSubmitting(true);
      const result = await registerBulkStock(items, notes);

      // Restocking an on-offer variant can bring it back onto the hero (or
      // turn a "Por encargo" slide into an in-stock one).
      const touched = new Set(items.map((it) => it.variant_id));
      void notifyHomepageOffers(
        classifyVariantWrite(variants.filter((v) => touched.has(v.variant_id)))
      );

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ADMIN_PRODUCTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY() }),
      ]);

      await Swal.fire({
        icon: "success",
        title: "¡Stock registrado!",
        text: `${result.processed} variante(s) actualizada(s), ${result.total_added} unidad(es) ingresadas.`,
      });

      setRows([newRow()]);
      setNotes("");
      onSuccess?.();
      onClose();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err instanceof Error ? err.message : "No se pudo registrar el stock.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Variants already chosen in OTHER rows are hidden from a row's dropdown so
  // the same variant can't be added twice.
  const optionsForRow = (currentKey: string): Option[] => {
    const taken = new Set(
      rows.filter((r) => r.key !== currentKey && r.variantId).map((r) => r.variantId)
    );
    const list: Option[] = [];
    for (const [id, opt] of optionFor) if (!taken.has(id)) list.push(opt);
    return list;
  };

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Registrar entrada de stock"
      subtitle="Ingresa unidades para una o varias variantes (no aplica a decants)"
      maxWidthClassName="max-w-2xl"
      closeOnBackdrop={!submitting}
    >
      <div className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-white/60">Cargando variantes…</p>
        ) : (
          <>
            <div className="space-y-3">
              {rows.map((row, index) => (
                <div
                  key={row.key}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2"
                >
                  <AdminSelect<Option>
                    instanceId={`bulk-stock-${row.key}`}
                    placeholder="Buscar variante…"
                    options={optionsForRow(row.key)}
                    value={row.variantId ? optionFor.get(row.variantId) ?? null : null}
                    onChange={(opt) => updateRow(row.key, { variantId: opt?.value ?? "" })}
                    noOptionsMessage={() => "Sin variantes disponibles"}
                    isDisabled={submitting}
                  />
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    placeholder="Cant."
                    value={row.quantity}
                    onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                    disabled={submitting}
                    aria-label={`Cantidad fila ${index + 1}`}
                    className="w-24 rounded-none border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-krov-blood/50"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    disabled={submitting || rows.length === 1}
                    aria-label="Eliminar fila"
                    className="rounded-none p-2.5 text-white/50 transition hover:bg-white/10 hover:text-red-400 disabled:opacity-30"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addRow}
              disabled={submitting}
              className="inline-flex items-center gap-2 text-sm font-medium text-krov-rose transition hover:text-krov-crimson disabled:opacity-50"
            >
              <Plus size={16} /> Agregar variante
            </button>

            <div>
              <label className="mb-1 block text-xs text-white/60">
                Nota (opcional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={submitting}
                placeholder="Ej. Compra a proveedor X — factura #123"
                className="w-full rounded-none border border-white/20 bg-white/10 px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-krov-blood/50"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={resetAndClose}
                disabled={submitting}
                className="flex-1 rounded-none border border-white/20 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/5 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 rounded-none bg-krov-blood py-2.5 text-sm font-medium text-black transition hover:bg-krov-crimson disabled:opacity-50"
              >
                {submitting ? "Registrando…" : "Registrar stock"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
