"use client";

import { useState, type FormEvent } from "react";
import Swal from "sweetalert2";
import AdminSelect from "@/components/admin/ui/AdminSelect";
import { useQueryClient } from "@tanstack/react-query";
import { createVariant } from "@/features/admin/createProduct";
import { useAdminProducts } from "@/hooks/useAdminProducts";
import { PRODUCTS_QUERY_KEY } from "@/hooks/useProducts";
import { ADMIN_PRODUCTS_QUERY_KEY } from "@/features/admin/getProductsAdmin";
import { parseWholesaleFields } from "@/lib/wholesale/variantFields";
import { classifyVariantWrite } from "@/lib/admin/homepageOffers";
import { notifyHomepageOffers } from "@/features/admin/notifyHomepageOffers";
import type { ProductTypes } from "@/types/product";

interface VariantFormProps {
  onSuccess?: () => void;
}

type VariantFormState = {
  product_id: string;
  sku: string;
  price: string;
  stock: string;
  size_ml: string;
  product_type: ProductTypes;
  is_on_offer: boolean;
  offer_price: string;
  // Wholesale (B2B) — raw strings; parsed to number|null on submit.
  wholesale_price: string;
  min_wholesale_quantity: string;
};

const INITIAL_STATE: VariantFormState = {
  product_id: "",
  sku: "",
  price: "",
  stock: "",
  size_ml: "",
  product_type: "full_size",
  is_on_offer: false,
  offer_price: "",
  wholesale_price: "",
  min_wholesale_quantity: "",
};

export default function VariantForm({ onSuccess }: VariantFormProps) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<VariantFormState>(INITIAL_STATE);

  const { data: variants = [] } = useAdminProducts();
  const queryClient = useQueryClient();

  const setField = <K extends keyof VariantFormState>(
    key: K,
    value: VariantFormState[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  const parentProducts = variants.reduce<
    { value: string; label: string }[]
  >((acc, v) => {
    if (!acc.some((p) => p.value === v.product_id)) {
      acc.push({ value: v.product_id, label: `${v.name} — ${v.brand}` });
    }
    return acc;
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!form.product_id) {
      Swal.fire({
        icon: "warning",
        title: "Producto requerido",
        text: "Selecciona un producto padre",
      });
      return;
    }

    const wholesale = parseWholesaleFields(
      form.wholesale_price,
      form.min_wholesale_quantity
    );
    if (!wholesale.ok) {
      Swal.fire({
        icon: "warning",
        title: "Datos mayoristas inválidos",
        text: wholesale.message,
      });
      return;
    }

    try {
      setLoading(true);

      await createVariant({
        product_id: form.product_id,
        sku: form.sku,
        price: Number(form.price),
        // Decant variants hold no manual stock — their inventory is the shared
        // ml pool (products.decant_stock_ml). The DB enforces this with
        // chk_decant_zero_stock, so always send 0 for decants.
        stock: form.product_type === "decant" ? 0 : Number(form.stock),
        size_ml: Number(form.size_ml),
        product_type: form.product_type,
        is_on_offer: form.is_on_offer,
        offer_price: form.is_on_offer ? Number(form.offer_price) : null,
        wholesale_price: wholesale.values.wholesale_price,
        min_wholesale_quantity: wholesale.values.min_wholesale_quantity,
      });

      // A new variant created on offer can become (or replace) a hero slide.
      void notifyHomepageOffers(classifyVariantWrite([{ is_on_offer: form.is_on_offer }]));

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY() }),
        queryClient.invalidateQueries({ queryKey: ADMIN_PRODUCTS_QUERY_KEY }),
      ]);

      Swal.fire({
        icon: "success",
        title: "¡Creada!",
        text: "Variante creada exitosamente",
      });
      setForm(INITIAL_STATE);
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
    <div className="max-w-4xl mx-auto bg-black rounded-none border border-krov-blood/30 p-8 shadow-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-krov-bone">Nueva Variante</h2>
        <p className="text-krov-ash">
          Agrega una variante comercial a un producto existente
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="space-y-4">
          <h3 className="text-krov-rose font-bold border-b border-krov-smoke pb-2">
            Producto Padre
          </h3>
          <AdminSelect<{ value: string; label: string }>
            instanceId="parent-product-select"
            className="input-field-custom"
            placeholder="Buscar producto..."
            options={parentProducts}
            value={parentProducts.find((p) => p.value === form.product_id) ?? null}
            onChange={(opt) => setField("product_id", opt?.value ?? "")}
          />
        </div>

        <div className="space-y-4 bg-krov-graphite/50 p-6 rounded-none border border-krov-smoke/70">
          <h3 className="text-krov-rose font-bold border-b border-krov-smoke pb-2">
            Variante Comercial (Stock y Precio)
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                SKU (Único)
              </label>
              <input
                type="text"
                placeholder="CH-BLEU-50"
                value={form.sku}
                onChange={(e) => setField("sku", e.target.value)}
                className="input-field-custom"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Precio Base
              </label>
              <input
                type="number"
                value={form.price}
                onChange={(e) => setField("price", e.target.value)}
                className="input-field-custom"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Stock
              </label>
              {form.product_type === "decant" ? (
                <div className="input-field-custom flex items-center text-xs text-krov-ash">
                  Pool de decants
                </div>
              ) : (
                <input
                  type="number"
                  value={form.stock}
                  onChange={(e) => setField("stock", e.target.value)}
                  className="input-field-custom"
                  required
                />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Tamaño (ml)
              </label>
              <input
                type="number"
                value={form.size_ml}
                onChange={(e) => setField("size_ml", e.target.value)}
                className="input-field-custom"
                required
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <select
              value={form.product_type}
              onChange={(e) =>
                setField("product_type", e.target.value as ProductTypes)
              }
              className="input-field-custom"
            >
              <option value="full_size">Full Size</option>
              <option value="decant">Decant</option>
              <option value="set">Set</option>
            </select>

            <label className="flex items-center gap-2 text-krov-bone cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_on_offer}
                onChange={(e) => setField("is_on_offer", e.target.checked)}
                className="accent-krov-blood"
              />
              ¿En Oferta?
            </label>

            {form.is_on_offer && (
              <input
                type="number"
                placeholder="Precio Oferta"
                value={form.offer_price}
                onChange={(e) => setField("offer_price", e.target.value)}
                className="input-field-custom w-40"
                required
              />
            )}
          </div>
        </div>

        <div className="space-y-4 bg-krov-graphite/50 p-6 rounded-none border border-krov-smoke/70">
          <div className="border-b border-krov-smoke pb-2">
            <h3 className="text-krov-rose font-bold">Precios Mayoristas (B2B)</h3>
            <p className="text-xs text-krov-ash mt-1">
              Opcional. Solo se aplican a clientes mayoristas aprobados que compren
              la cantidad mínima. Déjalos vacíos si esta variante no se vende al por
              mayor.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Precio Mayorista
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Opcional"
                value={form.wholesale_price}
                onChange={(e) => setField("wholesale_price", e.target.value)}
                className="input-field-custom"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Cantidad Mínima Mayorista
              </label>
              <input
                type="number"
                min="2"
                step="1"
                placeholder="Opcional (mín. 2)"
                value={form.min_wholesale_quantity}
                onChange={(e) =>
                  setField("min_wholesale_quantity", e.target.value)
                }
                className="input-field-custom"
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-krov-blood text-black font-black py-4 rounded-none uppercase hover:bg-krov-crimson transition-colors disabled:opacity-50"
        >
          {loading ? "Registrando Variante..." : "Crear Variante"}
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
