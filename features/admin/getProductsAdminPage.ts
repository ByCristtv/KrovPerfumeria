import { createClient } from "@/lib/supabase/server";
import { ADMIN_PAGE_SIZE, paginate, type Paginated } from "@/lib/pagination";
import { sortVariantsByStatus } from "@/lib/admin/variantSort";
import type {
  AdminProductCategory,
  AdminVariantRow,
  ProductTypes,
} from "@/types/product";

/** Raw row shape returned by the admin_list_product_variants RPC. */
interface RawVariantRow {
  variant_id: string;
  product_id: string;
  sku: string;
  size_ml: number;
  product_type: string;
  price: number | null;
  stock: number | null;
  is_on_offer: boolean | null;
  offer_price: number | null;
  is_active: boolean | null;
  wholesale_price: number | null;
  min_wholesale_quantity: number | null;
  name: string | null;
  description: string | null;
  brand: string | null;
  categories: AdminProductCategory[] | null;
  /** Added by 20260905000200; `undefined` until that migration is applied. */
  image_url?: string | null;
  total_count: number;
}

/**
 * Fetch one page of product variants for the admin table.
 *
 * Runs on the SERVER with the request-bound Supabase client, so the
 * `admin_list_product_variants` RPC sees the admin's JWT and its internal
 * `is_admin()` gate passes. Search + ordering + pagination + the exact total
 * all happen inside the single RPC call (no N+1). Mirrors `getStockMovements`.
 *
 * Rows arrive active-first (see the RPC's ORDER BY). `sortVariantsByStatus`
 * re-asserts that on the page actually rendered, so the table stays correct
 * while migration 20260905000200 is pending; it is a stable no-op once live.
 *
 * Never throws: any failure degrades to an empty first page so the panel renders.
 */
export async function getProductsAdminPage(
  page: number,
  search?: string,
  pageSize: number = ADMIN_PAGE_SIZE
): Promise<Paginated<AdminVariantRow>> {
  const supabase = await createClient();
  const trimmed = search?.trim() || undefined;
  const offset = (Math.max(1, Math.floor(page) || 1) - 1) * pageSize;

  // The RPC is typed only after `npm run update-types` runs post-migration; cast
  // narrowly so this compiles today and stays valid once the types regenerate.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: "admin_list_product_variants",
    args: { p_search?: string; p_limit: number; p_offset: number }
  ) => PromiseLike<{ data: RawVariantRow[] | null; error: { message: string } | null }>;

  const { data, error } = await rpc("admin_list_product_variants", {
    p_search: trimmed,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) {
    console.error("getProductsAdminPage failed:", error.message);
    return { rows: [], total: 0, currentPage: 1, totalPages: 1, pageSize };
  }

  const raw = data ?? [];
  const total = raw.length > 0 ? Number(raw[0].total_count) : 0;
  const { currentPage, totalPages } = paginate(total, page, pageSize);

  const rows: AdminVariantRow[] = raw.map((v) => ({
    variant_id: v.variant_id,
    product_id: v.product_id,
    sku: v.sku,
    size_ml: Number(v.size_ml),
    product_type: v.product_type as ProductTypes,
    price: v.price ?? 0,
    stock: v.stock ?? 0,
    is_on_offer: !!v.is_on_offer,
    offer_price: v.offer_price ?? null,
    is_active: !!v.is_active,
    wholesale_price: v.wholesale_price ?? null,
    min_wholesale_quantity: v.min_wholesale_quantity ?? null,
    name: v.name ?? "Sin nombre",
    description: v.description ?? null,
    brand: v.brand ?? "Sin marca",
    categories: v.categories ?? [],
    image_url: v.image_url ?? null,
  }));

  return {
    rows: sortVariantsByStatus(rows),
    total,
    currentPage,
    totalPages,
    pageSize,
  };
}
