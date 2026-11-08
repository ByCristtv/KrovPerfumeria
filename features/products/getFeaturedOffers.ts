import { supabase } from "@/lib/supabase/client";
import { resolveAvailability } from "@/lib/stock";
import { productPath } from "@/lib/seo/product";
import type { FeaturedOffer, ProductTypes } from "@/types/product";

/** Most slides the homepage carousel shows. More is noise, not choice. */
export const FEATURED_OFFERS_LIMIT = 6;

/**
 * Upper bound on on-offer variant rows read per render. Ranking happens in
 * memory (the saving is a ratio of two columns, which PostgREST cannot order
 * by), so the window has to hold every current offer; the catalog runs a few
 * dozen at most. Hitting the cap is logged — raise it rather than let offers
 * silently fall out of the ranking.
 */
const CANDIDATE_CAP = 200;

/** Raw row shape returned by the select below. */
export interface OfferVariantRow {
  id: string;
  price: number;
  offer_price: number | null;
  is_on_offer: boolean;
  stock: number;
  size_ml: number;
  product_type: ProductTypes;
  /** `true` only when an admin verified the supplier has it; anything else = not verified. */
  supplier_available?: boolean | null;
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
 * Bigger saving first, compared EXACTLY. The saving ratio is
 * (price − offer) / price; cross-multiplying compares two ratios without
 * dividing, so equal discounts (20 000 → 16 000 and 50 000 → 40 000) are equal
 * rather than one floating-point ulp apart. Both prices are already validated
 * positive by `discountPercent`, so there is no zero denominator.
 */
function compareSaving(a: FeaturedOffer, b: FeaturedOffer): number {
  return (b.price - b.offerPrice) * a.price - (a.price - a.offerPrice) * b.price;
}

const AVAILABILITY_RANK: Record<FeaturedOffer["availability"], number> = {
  in_stock: 0,
  made_to_order: 1,
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The single, total order for offers — used both to pick a product's best
 * variant and to rank the slides, so neither depends on database row order:
 *
 *   1. biggest saving (exact ratio; see `compareSaving`);
 *   2. at an equal saving, one KROV can ship today before a "Por encargo" one;
 *   3. product name (es collation), then product id, then variant id — a
 *      stable, meaningless-but-fixed tie-break so the carousel never reshuffles
 *      between renders.
 */
export function compareOffers(a: FeaturedOffer, b: FeaturedOffer): number {
  return (
    compareSaving(a, b) ||
    AVAILABILITY_RANK[a.availability] - AVAILABILITY_RANK[b.availability] ||
    a.name.localeCompare(b.name, "es") ||
    compareText(a.productId, b.productId) ||
    compareText(a.variantId, b.variantId)
  );
}

/**
 * Pure transform from variant rows to carousel slides. Exported for tests.
 *
 * A row becomes a slide only when it can honestly be advertised:
 *   · `is_on_offer` and a valid promotional price (`0 < offer_price < price`)
 *     — a flagged variant whose `offer_price` is missing or not lower would
 *     sell at full price, so it isn't promoted as an offer;
 *   · obtainable per `resolveAvailability`, the one availability rule the
 *     catalog card and the detail page also use: `in_stock` (decants derive
 *     from the pool) or `made_to_order` (no units, supplier verified). A
 *     `sold_out` variant is never promoted.
 *
 * One slide per product — its best variant by `compareOffers` — and the slides
 * are ranked by `compareOffers` too, so the result is independent of row order.
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

    const { status } = resolveAvailability(row, product.decant_stock_ml);
    if (status === "sold_out") continue;

    const image = pickImage(row);
    const brand = product.brands?.name ?? null;
    const description = product.description?.trim() || null;

    const candidate: FeaturedOffer = {
      productId: product.id,
      variantId: row.id,
      availability: status,
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
      // The detail page (with this variant preselected) owns the purchase
      // decision: cart for in-stock, the WhatsApp inquiry for "Por encargo".
      href: `${productPath(product.slug)}?variant=${row.id}`,
    };

    const existing = byProduct.get(product.id);
    if (!existing || compareOffers(candidate, existing) < 0) {
      byProduct.set(product.id, candidate);
    }
  }

  return [...byProduct.values()].sort(compareOffers).slice(0, limit);
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
 * RLS in force. The rows are read in a fixed order (by id) and ranked in
 * memory, so an unrelated edit (a stock decrement, a supplier re-check) can no
 * longer reshuffle which offers make the cut.
 *
 * Freshness: the homepage is ISR (`revalidate = 300`); admin writes that change
 * an offer revalidate "/" on demand (lib/admin/homepageOffers.ts).
 *
 * Never throws — any failure degrades to "no offers", which the hero renders as
 * its non-promotional layout.
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
        supplier_available,
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
      .order("id", { ascending: true })
      .limit(CANDIDATE_CAP);

    if (error) {
      console.error("getFeaturedOffers failed:", error.message);
      return [];
    }

    const rows = (data as unknown as OfferVariantRow[]) ?? [];
    if (rows.length >= CANDIDATE_CAP) {
      console.warn(
        `getFeaturedOffers: ${rows.length} on-offer variants hit CANDIDATE_CAP; some offers were not ranked.`
      );
    }

    return toFeaturedOffers(rows);
  } catch (err) {
    console.error("getFeaturedOffers failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
