import { supabase } from "@/lib/supabase/client";
import { availableUnits } from "@/lib/stock";
import { productPath } from "@/lib/seo/product";
import type { FeaturedOffer, ProductTypes } from "@/types/product";

/** Most slides the homepage carousel shows. More is noise, not choice. */
export const FEATURED_OFFERS_LIMIT = 6;

/**
 * Variant rows fetched per call. Several variants of one product can be on
 * offer at once and some will be filtered out (no stock, invalid price), so we
 * over-fetch a little and collapse to one slide per product afterwards.
 */
const CANDIDATE_CAP = 30;

/** Raw row shape returned by the select below. */
export interface OfferVariantRow {
  id: string;
  price: number;
  offer_price: number | null;
  is_on_offer: boolean;
  stock: number;
  size_ml: number;
  product_type: ProductTypes;
  product: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    decant_stock_ml: number;
    brands: { name: string } | null;
    product_images: {
      url: string;
      position: number;
      alt_text: string | null;
      variant_id: string | null;
    }[];
  } | null;
}

/**
 * Whole-percent saving, or `null` when the prices can't support one. Never
 * invents a figure: both prices must be positive and the offer strictly lower.
 */
export function discountPercent(price: number, offerPrice: number): number | null {
  if (!(price > 0) || !(offerPrice > 0) || offerPrice >= price) return null;
  const pct = Math.round((1 - offerPrice / price) * 100);
  return pct >= 1 ? pct : null;
}

/**
 * Pick the image that represents THIS variant: its own image when one exists,
 * otherwise the product-level gallery's first image.
 */
function pickImage(row: OfferVariantRow) {
  const images = [...(row.product?.product_images ?? [])].sort(
    (a, b) => a.position - b.position
  );
  return (
    images.find((img) => img.variant_id === row.id) ??
    images.find((img) => img.variant_id === null) ??
    images[0] ??
    null
  );
}

/**
 * Pure transform from variant rows to carousel slides. Exported for tests.
 *
 * A row becomes a slide only when it can honestly be advertised:
 *   · `is_on_offer` and a valid promotional price (`0 < offer_price < price`)
 *     — a flagged variant whose `offer_price` is missing or not lower would
 *     sell at full price, so it isn't promoted as an offer;
 *   · sellable right now per `availableUnits` (decants derive from the pool).
 *
 * Rows arrive newest-first. When a product has several qualifying variants the
 * one with the biggest saving represents it, at the product's first position.
 */
export function toFeaturedOffers(
  rows: OfferVariantRow[],
  limit = FEATURED_OFFERS_LIMIT
): FeaturedOffer[] {
  const byProduct = new Map<string, FeaturedOffer>();

  for (const row of rows) {
    const product = row.product;
    if (!product || !row.is_on_offer || row.offer_price == null) continue;

    const pct = discountPercent(row.price, row.offer_price);
    if (pct === null) continue;
    if (availableUnits(row, product.decant_stock_ml) <= 0) continue;

    const existing = byProduct.get(product.id);
    if (existing && (existing.discountPercent ?? 0) >= pct) continue;

    const image = pickImage(row);
    const brand = product.brands?.name ?? null;
    const description = product.description?.trim() || null;

    // Map preserves first-insertion order, so replacing a product's entry
    // keeps its (newest-first) slot.
    byProduct.set(product.id, {
      productId: product.id,
      variantId: row.id,
      name: product.name,
      brand,
      description,
      productType: row.product_type,
      sizeMl: row.size_ml,
      price: row.price,
      offerPrice: row.offer_price,
      discountPercent: pct,
      imageUrl: image?.url || "/placeholder.png",
      imageAlt: image?.alt_text?.trim() || [brand, product.name].filter(Boolean).join(" "),
      href: `${productPath(product.slug)}?variant=${row.id}`,
    });
  }

  return [...byProduct.values()].slice(0, limit);
}

/**
 * Products currently on offer, for the homepage hero carousel.
 *
 * Queried from the VARIANT side on purpose. The catalog's `onOffer` filter
 * matches a product when ANY variant is on offer, but its card is priced from
 * the featured variant — which may not be the discounted one. A promotion has
 * to show the price that is actually discounted, so we select the offered
 * variants themselves and join their parent.
 *
 * Visibility mirrors the detail page: active variant + active parent
 * (`!inner` prunes rows whose product is hidden), and the anon client keeps
 * RLS in force. Never throws — any failure degrades to "no offers", which the
 * hero renders as its non-promotional layout.
 */
export async function getFeaturedOffers(): Promise<FeaturedOffer[]> {
  try {
    const { data, error } = await supabase
      .from("product_variants")
      .select(
        `
        id,
        price,
        offer_price,
        is_on_offer,
        stock,
        size_ml,
        product_type,
        product:products!product_variants_product_id_fkey!inner (
          id,
          name,
          slug,
          description,
          decant_stock_ml,
          brands ( name ),
          product_images ( url, position, alt_text, variant_id )
        )
      `
      )
      .eq("is_on_offer", true)
      .eq("is_active", true)
      .eq("product.is_active", true)
      .order("updated_at", { ascending: false })
      .limit(CANDIDATE_CAP);

    if (error) {
      console.error("getFeaturedOffers failed:", error.message);
      return [];
    }

    return toFeaturedOffers((data as unknown as OfferVariantRow[]) ?? []);
  } catch (err) {
    console.error("getFeaturedOffers failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
