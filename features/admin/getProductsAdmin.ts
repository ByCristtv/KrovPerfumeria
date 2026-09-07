import { supabase } from "@/lib/supabase/client";
import type {
  AdminProductCategory,
  AdminVariantRow,
  ProductTypes,
} from "@/types/product";
import {
  resolveVariantThumbnail,
  type VariantImageCandidate,
} from "@/lib/admin/variantThumbnail";

const ADMIN_VARIANT_SELECT = `
  id,
  sku,
  price,
  stock,
  size_ml,
  product_type,
  is_on_offer,
  offer_price,
  is_active,
  wholesale_price,
  min_wholesale_quantity,
  created_at,
  products!product_variants_product_id_fkey!inner (
    id,
    name,
    description,
    brands ( name ),
    product_categories (
      categories ( id, name )
    ),
    product_images ( url, position, variant_id )
  )
` as const;

/** Raw shape returned by ADMIN_VARIANT_SELECT before it is flattened. */
interface AdminVariantQueryRow {
  id: string;
  sku: string;
  price: number | null;
  stock: number | null;
  size_ml: number;
  product_type: string;
  is_on_offer: boolean | null;
  offer_price: number | null;
  is_active: boolean | null;
  wholesale_price: number | null;
  min_wholesale_quantity: number | null;
  created_at: string;
  products: {
    id: string;
    name: string | null;
    description: string | null;
    brands: { name: string } | null;
    product_categories: { categories: AdminProductCategory | null }[] | null;
    product_images: VariantImageCandidate[] | null;
  } | null;
}

/**
 * Fetch all commercial variants for the admin table.
 *
 * Query is rooted at `product_variants` because price, stock, sku,
 * size, and product_type all live there — `products` only carries the
 * fragrance-level metadata (name, brand, categories). Parent fields
 * are flattened in the mapper so the UI consumes a single flat row.
 */
export const getProductsAdmin = async (): Promise<AdminVariantRow[]> => {
  const { data, error } = await supabase
    .from("product_variants")
    .select(ADMIN_VARIANT_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as AdminVariantQueryRow[];

  // Ordering stays `created_at DESC`. This helper feeds the variant PICKERS
  // (manual orders, bulk stock, decant transform, new variant), not the products
  // table — the active-first rule belongs to that table and is applied by
  // `getProductsAdminPage` / the RPC.
  return rows.map((v): AdminVariantRow => {
    const parent = v.products;
    const flatCategories: AdminProductCategory[] = (
      parent?.product_categories ?? []
    )
      .map((pc) => pc.categories)
      .filter((category): category is AdminProductCategory => category !== null);

    return {
      variant_id: v.id,
      product_id: parent?.id ?? "",
      sku: v.sku,
      size_ml: v.size_ml,
      product_type: v.product_type as ProductTypes,
      price: v.price ?? 0,
      stock: v.stock ?? 0,
      is_on_offer: !!v.is_on_offer,
      offer_price: v.offer_price ?? null,
      is_active: !!v.is_active,
      wholesale_price: v.wholesale_price ?? null,
      min_wholesale_quantity: v.min_wholesale_quantity ?? null,
      name: parent?.name ?? "Sin nombre",
      description: parent?.description ?? null,
      brand: parent?.brands?.name ?? "Sin marca",
      categories: flatCategories,
      // Same rule the RPC applies (see lib/admin/variantThumbnail).
      image_url: resolveVariantThumbnail(v.id, parent?.product_images),
    };
  });
};

export const ADMIN_PRODUCTS_QUERY_KEY = ["admin", "product_variants"] as const;
