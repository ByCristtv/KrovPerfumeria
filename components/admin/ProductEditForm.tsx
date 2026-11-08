"use client";

import { useEffect, useState, type FormEvent } from "react";
import Swal from "sweetalert2";
import AdminSelect from "@/components/admin/ui/AdminSelect";
import { useQueryClient } from "@tanstack/react-query";
import { updateProduct, getProductForEdit } from "@/features/admin/updateProduct";
import { useCategories } from "@/hooks/useCategories";
import { isGenderCategorySlug } from "@/lib/catalogCategoryFilter";
import { useBrands } from "@/hooks/useBrands";
import { PRODUCTS_QUERY_KEY } from "@/hooks/useProducts";
import { ADMIN_PRODUCTS_QUERY_KEY } from "@/features/admin/getProductsAdmin";
import { notifyHomepageOffers } from "@/features/admin/notifyHomepageOffers";
import {
  classifyProductEdit,
  type ProductEditSnapshot,
} from "@/lib/admin/homepageOffers";
import ProductImagesManager from "@/components/admin/ProductImagesManager";
import {
  parseWholesaleFields,
  wholesaleFieldToInput,
} from "@/lib/wholesale/variantFields";
import type { ProductTypes } from "@/types/product";

interface ProductEditFormProps {
  productId: string;
  variantId: string;
  onSuccess?: () => void;
}

type ProductFormState = {
  name: string;
  brand_id: string;
  description: string;
  notes_top: string;
  notes_middle: string;
  notes_base: string;
  gender: "masculine" | "feminine" | "unisex";
  concentration: "EDT" | "EDP" | "Parfum" | "Cologne";
  is_active: boolean;
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

type Option<V extends string = string> = { value: V; label: string };

/**
 * The hero-relevant view of the form, normalised exactly like the submit
 * payload (numbers, decant stock = 0, offer price null when off), so comparing
 * the loaded snapshot with the submitted one never reports a phantom change.
 */
function heroSnapshot(form: ProductFormState): ProductEditSnapshot {
  return {
    product: {
      name: form.name,
      brand_id: form.brand_id,
      description: form.description,
    },
    variant: {
      price: Number(form.price),
      offer_price: form.is_on_offer ? Number(form.offer_price) : null,
      is_on_offer: form.is_on_offer,
      stock: form.product_type === "decant" ? 0 : Number(form.stock),
      is_active: form.is_active,
      product_type: form.product_type,
      size_ml: Number(form.size_ml),
    },
  };
}

export default function ProductEditForm({
  productId,
  variantId,
  onSuccess,
}: ProductEditFormProps) {
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [form, setForm] = useState<ProductFormState>({
    name: "",
    brand_id: "",
    description: "",
    notes_top: "",
    notes_middle: "",
    notes_base: "",
    gender: "unisex",
    concentration: "EDP",
    is_active: true,
    sku: "",
    price: "",
    stock: "",
    size_ml: "",
    product_type: "full_size",
    is_on_offer: false,
    offer_price: "",
    wholesale_price: "",
    min_wholesale_quantity: "",
  });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  // What the hero saw when the form loaded (or was last saved): the baseline
  // for deciding whether a save must revalidate the homepage.
  const [savedSnapshot, setSavedSnapshot] = useState<ProductEditSnapshot | null>(null);

  const { data: categories = [] } = useCategories();
  const { data: brands = [] } = useBrands();
  const queryClient = useQueryClient();

  const setField = <K extends keyof ProductFormState>(
    key: K,
    value: ProductFormState[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }));

  // Fetch product + variant data to prefill the form
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { product, variant, category_ids } = await getProductForEdit(
          productId,
          variantId
        );
        if (cancelled) return;
        const loaded: ProductFormState = {
          name: product.name ?? "",
          brand_id: product.brand_id ?? "",
          description: product.description ?? "",
          notes_top: product.notes_top ?? "",
          notes_middle: product.notes_middle ?? "",
          notes_base: product.notes_base ?? "",
          gender: (product.gender as ProductFormState["gender"]) ?? "unisex",
          concentration:
            (product.concentration as ProductFormState["concentration"]) ?? "EDP",
          is_active: variant.is_active,
          sku: variant.sku ?? "",
          price: String(variant.price ?? ""),
          stock: String(variant.stock ?? ""),
          size_ml: String(variant.size_ml ?? ""),
          product_type: (variant.product_type as ProductTypes) ?? "full_size",
          is_on_offer: !!variant.is_on_offer,
          offer_price: variant.offer_price != null ? String(variant.offer_price) : "",
          // Hydrate NULLs to "" so the inputs stay controlled and blank fields
          // don't render "null"/"0".
          wholesale_price: wholesaleFieldToInput(variant.wholesale_price),
          min_wholesale_quantity: wholesaleFieldToInput(
            variant.min_wholesale_quantity
          ),
        };
        setForm(loaded);
        setSavedSnapshot(heroSnapshot(loaded));
        setSelectedCategories(category_ids);
      } catch (err) {
        Swal.fire({
          icon: "error",
          title: "Error",
          text:
            err instanceof Error
              ? err.message
              : "No se pudo cargar el producto.",
        });
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, variantId]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

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

      await updateProduct({
        product_id: productId,
        variant_id: variantId,
        ...form,
        price: Number(form.price),
        // Decant variants hold no manual stock — their inventory is the shared
        // ml pool (products.decant_stock_ml). The DB enforces this with
        // chk_decant_zero_stock, so always send 0 for decants.
        stock: form.product_type === "decant" ? 0 : Number(form.stock),
        size_ml: Number(form.size_ml),
        offer_price: form.is_on_offer ? Number(form.offer_price) : null,
        wholesale_price: wholesale.values.wholesale_price,
        min_wholesale_quantity: wholesale.values.min_wholesale_quantity,
        category_ids: selectedCategories,
      });

      // Only a save that can change a hero slide revalidates the homepage.
      const submitted = heroSnapshot(form);
      if (savedSnapshot) {
        void notifyHomepageOffers(
          classifyProductEdit(productId, savedSnapshot, submitted)
        );
      }
      setSavedSnapshot(submitted);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY() }),
        queryClient.invalidateQueries({ queryKey: ADMIN_PRODUCTS_QUERY_KEY }),
      ]);
      Swal.fire({
        icon: "success",
        title: "¡Actualizado!",
        text: "Producto y variante actualizados exitosamente",
      });
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

  if (fetching) {
    return (
      <div className="max-w-4xl mx-auto bg-black rounded-none border border-krov-blood/30 p-8 shadow-2xl">
        <p className="text-krov-bone text-center py-12">
          Cargando datos del producto...
        </p>
      </div>
    );
  }

  // Derive the selected brand option for react-select (controlled value)
  const brandOptions = brands.map((b) => ({ value: b.id, label: b.name }));
  const selectedBrand = brandOptions.find((b) => b.value === form.brand_id) ?? null;

  // Commercial categories only: gender is the "Género" field (products.gender).
  const categoryOptions = categories
    .filter((c) => !isGenderCategorySlug(c.slug))
    .map((c) => ({ value: c.id, label: c.name }));
  const selectedCategoryValues = categoryOptions.filter((c) =>
    selectedCategories.includes(c.value)
  );

  return (
    <div className="max-w-4xl mx-auto bg-black rounded-none border border-krov-blood/30 p-8 shadow-2xl">
      <div className="mb-8 text-center">
        <h2 className="text-2xl font-bold text-krov-bone">Editar Producto</h2>
        <p className="text-krov-ash">
          Modifica el perfume y su variante comercial
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* SECCIÓN 1: PRODUCTO BASE */}
        <div className="space-y-4">
          <h3 className="text-krov-rose font-bold border-b border-krov-smoke pb-2">
            Información del Perfume
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Nombre
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                className="input-field-custom"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Marca
              </label>
              <AdminSelect<Option>
                instanceId="edit-brand-select"
                className="input-field-custom"
                options={brandOptions}
                value={selectedBrand}
                onChange={(opt) => setField("brand_id", opt?.value ?? "")}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Género
              </label>
              <select
                value={form.gender}
                onChange={(e) =>
                  setField(
                    "gender",
                    e.target.value as ProductFormState["gender"]
                  )
                }
                className="input-field-custom"
              >
                <option value="masculine">Masculino</option>
                <option value="feminine">Femenino</option>
                <option value="unisex">Unisex</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Concentración
              </label>
              <select
                value={form.concentration}
                onChange={(e) =>
                  setField(
                    "concentration",
                    e.target.value as ProductFormState["concentration"]
                  )
                }
                className="input-field-custom"
              >
                <option value="EDT">EDT</option>
                <option value="EDP">EDP</option>
                <option value="Parfum">Parfum</option>
                <option value="Cologne">Cologne</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-krov-rose uppercase">
                Categorías
              </label>
              <AdminSelect<Option, true>
                instanceId="edit-category-select"
                isMulti
                className="input-field-custom"
                options={categoryOptions}
                value={selectedCategoryValues}
                onChange={(opts) =>
                  setSelectedCategories(opts.map((o) => o.value))
                }
              />
            </div>
          </div>

          {/* NOTAS OLFATIVAS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              placeholder="Notas de Salida"
              value={form.notes_top}
              onChange={(e) => setField("notes_top", e.target.value)}
              className="input-field-custom"
            />
            <input
              placeholder="Notas de Corazón"
              value={form.notes_middle}
              onChange={(e) => setField("notes_middle", e.target.value)}
              className="input-field-custom"
            />
            <input
              placeholder="Notas de Fondo"
              value={form.notes_base}
              onChange={(e) => setField("notes_base", e.target.value)}
              className="input-field-custom"
            />
          </div>

          <textarea
            placeholder="Descripción general..."
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            rows={3}
            className="input-field-custom w-full resize-none"
            required
          />
        </div>

        {/* SECCIÓN 2: VARIANTE */}
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
                placeholder="CH-BLEU-100"
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

          <div className="flex items-center gap-6 flex-wrap">
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

            <label className="flex items-center gap-2 text-krov-bone cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setField("is_active", e.target.checked)}
                className="accent-krov-blood"
              />
              Activa
            </label>
          </div>
        </div>

        {/* SECCIÓN 2b: PRECIOS MAYORISTAS (B2B) */}
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

        {/* SECCIÓN 3: IMÁGENES DEL PRODUCTO (acciones independientes) */}
        <ProductImagesManager productId={productId} />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-krov-blood text-black font-black py-4 rounded-none uppercase hover:bg-krov-crimson transition-colors disabled:opacity-50"
        >
          {loading ? "Actualizando..." : "Actualizar Producto"}
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
