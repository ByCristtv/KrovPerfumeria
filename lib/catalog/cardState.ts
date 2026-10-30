import { availableUnits, resolveAvailability } from "@/lib/stock";
import type { ProductCardData, ProductCardVariant } from "@/types/product";

/**
 * What a catalog card says about a product, decided in ONE place.
 *
 * A perfume can be had in up to three independent ways, and none of them stands
 * in for another:
 *
 *   1. its own bottle     KROV's physical stock of a full bottle / set
 *   2. the supplier       KROV can order that bottle ("Por encargo"); this is NOT
 *                         stock - it is a promise to ask, never to ship
 *   3. decants            poured from the parent's shared ml pool; a decant is
 *                         available only if floor(pool / size) >= 1
 *
 * The card shows ONE primary state, by strict precedence:
 *
 *   own bottle in stock              -> available / low_stock   (action: add to cart)
 *   else supplier can order it       -> made_to_order           (action: WhatsApp)
 *   else some decant is in stock     -> decants_only            (action: choose decant)
 *   else                             -> sold_out                (no action)
 *
 * Everything is derived from real purchasable variants - bottles from their own
 * stock, decants from the pool, the supplier from the verified flag. Nothing is
 * summed across variants and nothing is inferred from a neighbouring field (a
 * parent existing says nothing about its decants; a zero bottle says nothing
 * about the supplier).
 *
 * Pure and presentation-free on purpose: no React, no copy. The card decides how
 * to draw a state; it never decides which state it is.
 */

/** A bottle with this many units or fewer (but at least one) is "low stock". */
export const LOW_STOCK_THRESHOLD = 5;

export type CardStatus =
  | "available"
  | "low_stock"
  | "made_to_order"
  | "decants_only"
  | "sold_out";

/**
 * The one thing the card's corner control does:
 *   add_to_cart    quick-add the presented bottle (the existing behavior)
 *   whatsapp       open a prefilled availability inquiry; never touches the cart
 *   choose_decant  go to the product page with the starting decant preselected,
 *                  where the existing variant selector picks the size
 *   none           nothing can be bought or asked about
 */
export type CardAction = "add_to_cart" | "whatsapp" | "choose_decant" | "none";

export interface CardPrice {
  /** What the customer pays for the presented variant; null if pricing is missing or invalid. */
  current: number | null;
  /** The struck-through list price. Set ONLY when there is a genuine discount. */
  original: number | null;
  /** Whole-percent saving (>= 1), or null. */
  discountPercent: number | null;
}

export interface CardState {
  status: CardStatus;
  action: CardAction;
  /** The variant this card presents: the bottle, or - for decants only - the starting decant. */
  presented: ProductCardVariant;
  /** "bottle" for a bottle or set, "decants" when the presented variant is a decant. */
  kind: "bottle" | "decants";
  /** Price facts for `presented` (and only for it). */
  price: CardPrice;
  /** Own units of the presented bottle; 0 unless the status is available / low_stock. */
  units: number;
  /** Decants that can be bought right now, smallest first. */
  decantsAvailable: ProductCardVariant[];
  /** Smallest purchasable decant, in ml; null when there is none. */
  decantFromMl: number | null;
  /**
   * The bottle is orderable AND decants can be bought too. Drives a secondary
   * line only - never a second badge, never a second action.
   */
  alsoDecants: boolean;
}

export function isValidPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The price a variant is sold at, and the discount that is real.
 *
 * "What is charged" follows the rule `place_order` applies (an active offer with
 * an `offer_price` wins), so the card can never advertise a number the checkout
 * will not honor. The discount is shown only when it is genuine: both prices
 * valid, the list price above the charged one, and the whole-percent saving
 * positive. A misconfigured offer (offer >= list) is charged but not advertised.
 */
export function cardPrice(v: ProductCardVariant): CardPrice {
  const offerActive = v.is_on_offer === true && v.offer_price != null;
  const charged = offerActive ? v.offer_price : v.price;

  if (!isValidPrice(charged)) {
    return { current: null, original: null, discountPercent: null };
  }

  if (offerActive && isValidPrice(v.price) && v.price > charged) {
    const discountPercent = Math.round(((v.price - charged) / v.price) * 100);
    if (discountPercent > 0) {
      return { current: charged, original: v.price, discountPercent };
    }
  }

  return { current: charged, original: null, discountPercent: null };
}

/** The featured variant when it qualifies, otherwise the first (smallest) that does. */
function pickPrimary(
  candidates: ProductCardVariant[],
  featuredId: string | undefined
): ProductCardVariant | undefined {
  return candidates.find((v) => v.id === featuredId) ?? candidates[0];
}

/** Cheapest valid price first; ties (and unpriced variants) fall back to size. */
function cheapestFirst(a: ProductCardVariant, b: ProductCardVariant): number {
  const pa = cardPrice(a).current;
  const pb = cardPrice(b).current;
  if (pa !== null && pb !== null && pa !== pb) return pa - pb;
  if ((pa === null) !== (pb === null)) return pa === null ? 1 : -1;
  return a.size_ml - b.size_ml;
}

/**
 * Resolve the card's state, or `null` when the product has no variant to present
 * (the card then renders nothing, as it always has).
 */
export function resolveCardState(
  product: Pick<ProductCardData, "featured_variant" | "variants" | "decant_stock_ml">
): CardState | null {
  const featured = product.featured_variant ?? undefined;
  const pool = product.decant_stock_ml;

  const source =
    product.variants && product.variants.length > 0
      ? product.variants
      : featured
        ? [featured]
        : [];
  if (source.length === 0) return null;

  // Smallest first: a stable, predictable order for "first that qualifies".
  const variants = [...source].sort((a, b) => a.size_ml - b.size_ml);
  const bottles = variants.filter((v) => v.product_type !== "decant");
  const decants = variants.filter((v) => v.product_type === "decant");

  const inStock = bottles.filter((b) => resolveAvailability(b, pool).status === "in_stock");
  const orderable = bottles.filter(
    (b) => resolveAvailability(b, pool).status === "made_to_order"
  );
  // A decant is purchasable only if the shared pool can fill at least one of it.
  const decantsAvailable = decants.filter((d) => availableUnits(d, pool) > 0);
  const decantFromMl =
    decantsAvailable.length > 0 ? Math.min(...decantsAvailable.map((d) => d.size_ml)) : null;

  const base = {
    decantsAvailable,
    decantFromMl,
  };

  // 1 ── KROV owns the bottle.
  const owned = pickPrimary(inStock, featured?.id);
  if (owned) {
    const units = availableUnits(owned, pool);
    const price = cardPrice(owned);
    return {
      ...base,
      status: units <= LOW_STOCK_THRESHOLD ? "low_stock" : "available",
      // A bottle with no usable price cannot be quick-added at an undefined price.
      action: price.current === null ? "none" : "add_to_cart",
      presented: owned,
      kind: "bottle",
      price,
      units,
      alsoDecants: false,
    };
  }

  // 2 ── Not in stock, but the supplier can be asked.
  const ordered = pickPrimary(orderable, featured?.id);
  if (ordered) {
    return {
      ...base,
      status: "made_to_order",
      action: "whatsapp",
      presented: ordered,
      kind: "bottle",
      price: cardPrice(ordered),
      units: 0,
      alsoDecants: decantsAvailable.length > 0,
    };
  }

  // 3 ── No bottle by any route, but a decant can be bought.
  if (decantsAvailable.length > 0) {
    const start = [...decantsAvailable].sort(cheapestFirst)[0];
    return {
      ...base,
      status: "decants_only",
      action: "choose_decant",
      presented: start,
      kind: "decants",
      price: cardPrice(start),
      units: 0,
      alsoDecants: false,
    };
  }

  // 4 ── Nothing can be bought or asked about.
  const shown = featured ?? bottles[0] ?? variants[0];
  const listed = cardPrice(shown);
  return {
    ...base,
    status: "sold_out",
    action: "none",
    presented: shown,
    kind: shown.product_type === "decant" ? "decants" : "bottle",
    // The price stays readable, but a promotion on something nobody can buy is
    // not advertised: no struck-through price, no discount badge.
    price: { current: listed.current, original: null, discountPercent: null },
    units: 0,
    alsoDecants: false,
  };
}
