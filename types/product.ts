import { Database } from "./database";

export type ProductTypes = "full_size" | "decant" | "set"

export type BaseCartItem = Database["public"]["Tables"]["cart_items"]["Row"];

export interface AdminProductCategory {
  id: string;
  name: string;
}

/**
 * Admin table row. One entry per `product_variants` SKU — the unit of
 * inventory the admin actually manages. Parent product fields (name,
 * brand, categories) are flattened upward for rendering convenience.
 */
export interface AdminVariantRow {
  variant_id: string;
  product_id: string;
  sku: string;
  size_ml: number;
  product_type: ProductTypes;
  price: number;
  stock: number;
  is_on_offer: boolean;
  offer_price: number | null;
  is_active: boolean;
  // Wholesale (B2B) — NULL when this variant isn't sold wholesale.
  wholesale_price: number | null;
  min_wholesale_quantity: number | null;
  /**
   * Supplier availability (NOT KROV's stock), as last verified by an admin.
   * Filled only by the products table (`getProductsAdminPage`). `undefined` means
   * "not loaded" - the variant pickers never read it, and the table also leaves
   * it unset if the supplier migration is not applied yet - which is different
   * from `false` ("verified sold out, or never verified").
   */
  supplier_available?: boolean;
  /** When an admin last inspected the supplier catalog; null = never. */
  supplier_checked_at?: string | null;
  name: string;
  description: string | null;
  brand: string;
  categories: AdminProductCategory[];
  /**
   * Main image for this variant — its own image when one exists, otherwise the
   * parent product's first image (resolved in `admin_list_product_variants`).
   * `null` when the product has no images; the table renders a placeholder.
   */
  image_url: string | null;
}
export interface ProductVariant {
  id: string;
  price: number;
  offer_price: number | null;
  is_on_offer: boolean;
  stock: number;
  size_ml: number;
  product_type: ProductTypes;
  position: number;
  /**
   * Variant SKU. Selected by the detail query from Phase 3 on; absent on older
   * payloads, so consumers must treat a missing value as "unknown".
   */
  sku?: string;
  /**
   * Supplier availability, manually verified by an admin (NOT KROV inventory).
   * `undefined`/`null` mean "not verified" and are treated as NOT available -
   * see `resolveAvailability` in lib/stock.ts.
   */
  supplier_available?: boolean | null;
}

export interface ProductDetailData {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  gender: "masculine" | "feminine" | "unisex";
  concentration: string;
  notes_top: string | null;
  notes_middle: string | null;
  notes_base: string | null;
  featured_variant_id: string | null;
  /** Shared decant ml pool — drives dynamic decant stock (see lib/stock.ts). */
  decant_stock_ml: number;
  brands: { name: string } | null;
  categories: { id: string; name: string }[];
  product_variants: ProductVariant[];
  product_images: {
    url: string;
    position: number;
    alt_text: string | null;
    /** When set, this image represents a specific variant; null = product-level. */
    variant_id: string | null;
  }[];
}

/** A variant as the catalog card needs it: pricing, own stock and the supplier flag. */
export interface ProductCardVariant {
  id: string;
  price: number;
  offer_price: number | null;
  is_on_offer: boolean;
  stock: number;
  size_ml: number;
  product_type: ProductTypes;
  /** Selected by the catalog queries from Phase 3 on; see `ProductVariant.sku`. */
  sku?: string;
  /** `undefined`/`null` = not verified = NOT available; see `ProductVariant`. */
  supplier_available?: boolean | null;
}

/**
 * Catalog card data — ONE card per parent product. The card represents the
 * product through its primary (featured) variant and the parent's first image.
 */
export interface ProductCardData {
  id: string;
  name: string;
  slug: string;
  gender: "masculine" | "feminine" | "unisex";
  concentration: string;
  brands: { name: string } | null;
  /** Parent decant pool — the only inventory every decant variant draws from. */
  decant_stock_ml: number;
  featured_variant: ProductCardVariant | null;
  /**
   * Every ACTIVE variant of the product (bottles, sets, decants). The card needs
   * them to answer "can this perfume be had in another form?" - e.g. a bottle
   * that is out of stock but sold as decants. Optional: payloads that do not
   * select it (related products) fall back to `featured_variant` alone, which
   * means "decants unknown", never "decants available".
   */
  variants?: ProductCardVariant[];
  product_images: {
    url: string;
    position: number;
  }[];
}

/**
 * One slide of the homepage offers carousel. Built server-side from a variant
 * that is on offer, active, in stock and carries a VALID promotional price
 * (`0 < offer_price < price`) — see `features/products/getFeaturedOffers.ts`.
 * One entry per parent product.
 */
export interface FeaturedOffer {
  productId: string;
  variantId: string;
  name: string;
  brand: string | null;
  description: string | null;
  productType: ProductTypes;
  sizeMl: number;
  /** Regular retail price (struck through). */
  price: number;
  /** Promotional price the customer pays — always lower than `price`. */
  offerPrice: number;
  /** Whole-percent saving; `null` when it would round to 0. */
  discountPercent: number | null;
  imageUrl: string;
  imageAlt: string;
  /** Product detail route with this variant preselected. */
  href: string;
}

/** Payload for the admin "create product + first variant" RPC. */
export interface CreateProductDTO {
  // Base product
  name: string;
  brand_id: string;
  description: string;
  notes_top: string;
  notes_middle: string;
  notes_base: string;
  gender: string;
  concentration: string;
  category_ids: string[];
  file: File;
  // Initial variant
  sku: string;
  price: number;
  stock: number;
  size_ml: number;
  product_type: ProductTypes;
  is_on_offer: boolean;
  offer_price: number | null;
  // Wholesale (B2B) — optional. NULL means "not sold wholesale". Both are
  // required together for wholesale pricing to apply (see lib/pricing/wholesale).
  wholesale_price: number | null;
  min_wholesale_quantity: number | null;
}

/**
 * One row of the "Stock para Decants" admin table. Each entry is a
 * `product_type='decant'` variant, paired with the SHARED liquid pool that
 * lives on its parent product (`products.decant_stock_ml`). Several decant
 * sizes of the same product therefore report the same `pool_ml`.
 */
export interface DecantStockRow {
  variant_id: string;
  product_id: string;
  sku: string;
  size_ml: number;
  name: string;
  brand: string;
  /** Shared liquid pool of the parent product, in ml. */
  pool_ml: number;
  /** How many units of THIS decant size the current pool can fill. */
  possible_units: number;
  is_active: boolean;
}

/**
 * Payload for the `transform_to_decant` RPC: sacrifice `quantity` full-size
 * bottles of `source_variant_id` and pour their ml into the product's pool.
 */
export interface TransformToDecantDTO {
  source_variant_id: string;
  quantity: number;
  notes?: string | null;
}

/** Payload for adding an extra variant to an existing product. */
export interface CreateVariantDTO {
  product_id: string;
  sku: string;
  price: number;
  stock: number;
  size_ml: number;
  product_type: ProductTypes;
  is_on_offer: boolean;
  offer_price: number | null;
  // Wholesale (B2B) — optional. NULL means "not sold wholesale".
  wholesale_price: number | null;
  min_wholesale_quantity: number | null;
}

export type CartLineItem = {
  variant_id: string;
  product_name: string;
  product_type: string;
  size_ml: number;
  price: number;
  image_url: string;
  quantity: number;
  stock: number;
};

export type CartStore = {
  cart: CartLineItem[];
  setCart: (cart: CartLineItem[]) => void;
  addItem: (item: Omit<CartLineItem, "quantity">) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalItems: () => number;
  getTotalPrice: () => number;
};