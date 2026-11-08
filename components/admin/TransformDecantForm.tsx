"use client";

import { useMemo, useState, type FormEvent } from "react";
import Swal from "sweetalert2";
import AdminSelect from "@/components/admin/ui/AdminSelect";
import { useQueryClient } from "@tanstack/react-query";
import { transformToDecant } from "@/features/admin/transformToDecant";
import { useAdminProducts } from "@/hooks/useAdminProducts";
import { DECANT_STOCK_QUERY_KEY } from "@/features/admin/getDecantStock";
import { ADMIN_PRODUCTS_QUERY_KEY } from "@/features/admin/getProductsAdmin";
import { PRODUCTS_QUERY_KEY } from "@/hooks/useProducts";
import { notifyHomepageOffers } from "@/features/admin/notifyHomepageOffers";

interface TransformDecantFormProps {
  onSuccess?: () => void;
}

type Option = { value: string; label: string };

export default function TransformDecantForm({
  onSuccess,
}: TransformDecantFormProps) {
  const [loading, setLoading] = useState(false);
  const [sourceVariantId, setSourceVariantId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  const { data: variants = [] } = useAdminProducts();
  const queryClient = useQueryClient();

  // Only full-size, active variants can be sacrificed into the pool.
  const fullSizeVariants = useMemo(
    () => variants.filter((v) => v.product_type === "full_size" && v.is_active),
    [variants]
  );

  const options: Option[] = useMemo(
    () =>
      fullSizeVariants.map((v) => ({
        value: v.variant_id,
        label: `${v.name} — ${v.brand} · ${v.sku} (${v.size_ml}ml · stock: ${v.stock})`,
      })),
    [fullSizeVariants]
  );

  const selected = fullSizeVariants.find((v) => v.variant_id === sourceVariantId);
  const qty = Number(quantity);
  const mlToAdd =
    selected && qty > 0 ? selected.size_ml * qty : 0;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!selected) {
      Swal.fire({
        icon: "warning",
        title: "Variante requerida",
        text: "Selecciona la variante full size a transformar",
      });
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      Swal.fire({
        icon: "warning",
        title: "Cantidad inválida",
        text: "La cantidad debe ser un número entero mayor a 0",
      });
      return;
    }
    if (qty > selected.stock) {
      Swal.fire({
        icon: "warning",
        title: "Stock insuficiente",
        text: `Solo hay ${selected.stock} unidades de ${selected.sku} disponibles.`,
      });
      return;
    }

    try {
      setLoading(true);

      const result = await transformToDecant({
        source_variant_id: selected.variant_id,
        quantity: qty,
        notes,
      });

      // Moves units from a bottle into the product's decant pool: either side
      // may be on offer, so let the server check this product's offers.
      void notifyHomepageOffers({ scope: "product", productId: selected.product_id });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: DECANT_STOCK_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ADMIN_PRODUCTS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY() }),
      ]);

      const newPool = (result as { new_pool_ml?: number } | null)?.new_pool_ml;
      Swal.fire({
        icon: "success",
        title: "¡Pool actualizado!",
        text:
          newPool != null
            ? `Se agregaron ${mlToAdd} ml. Pool disponible: ${newPool} ml.`
            : `Se agregaron ${mlToAdd} ml al pool de decants.`,
      });

      setSourceVariantId("");
      setQuantity("");
      setNotes("");
      onSuccess?.();
    } catch (err) {
      Swal.fire({
        icon: "error",
        title: "Error",
        text: err instanceof Error ? err.message : "Error desconocido",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-black rounded-none border border-krov-blood/30 p-8 shadow-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-krov-bone">Generar Stock de Decant</h2>
        <p className="text-krov-ash">
          Transforma botellas full size en mililitros para el pool compartido
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-4">
          <h3 className="text-krov-rose font-bold border-b border-krov-smoke pb-2">
            Variante Full Size de Origen
          </h3>
          <AdminSelect<Option>
            instanceId="transform-source-variant"
            className="input-field-custom"
            placeholder="Buscar botella full size..."
            options={options}
            value={options.find((o) => o.value === sourceVariantId) ?? null}
            onChange={(opt) => setSourceVariantId(opt?.value ?? "")}
            noOptionsMessage={() => "No hay variantes full size activas"}
          />
        </div>

        <div className="space-y-4 bg-krov-graphite/50 p-6 rounded-none border border-krov-smoke/70">
          <h3 className="text-krov-rose font-bold border-b border-krov-smoke pb-2">
            Transformación
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Unidades a transformar
              </label>
              <input
                type="number"
                min={1}
                step={1}
                placeholder="2"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="input-field-custom"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Mililitros generados
              </label>
              <div className="input-field-custom flex items-center text-krov-rose font-bold">
                {mlToAdd > 0 ? `${mlToAdd} ml` : "—"}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-krov-rose uppercase">
              Notas (opcional)
            </label>
            <input
              type="text"
              placeholder="Ej. Sacrificio de 2 testers"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input-field-custom"
            />
          </div>

          {selected && (
            <p className="text-xs text-krov-ash">
              Se descontarán <span className="text-krov-bone font-bold">{qty > 0 ? qty : 0}</span>{" "}
              unidad(es) de <span className="text-krov-bone font-bold">{selected.sku}</span>{" "}
              (stock actual: {selected.stock}).
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-krov-blood text-black font-black py-4 rounded-none uppercase hover:bg-krov-crimson transition-colors disabled:opacity-50"
        >
          {loading ? "Transformando..." : "Transformar a Pool de Decants"}
        </button>
      </form>

      <style jsx>{`
        .input-field-custom {
          width: 100%;
          padding: 0.75rem 1rem;
          background-color: #191420;
          border: 1px solid rgba(255,11,85, 0.3);
          border-radius: 0.5rem;
          color: #f4eef0;
          transition: all 0.2s;
        }
        .input-field-custom:focus {
          border-color: #ff4d74;
          outline: none;
          box-shadow: 0 0 0 1px #ff4d74;
        }
      `}</style>
    </div>
  );
}
