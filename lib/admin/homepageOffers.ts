/**
 * Which admin writes can change the homepage hero's featured offers?
 *
 * The homepage is the one public route that caches (ISR, `revalidate = 300`),
 * and its hero is built from on-offer variants (see
 * features/products/getFeaturedOffers.ts). Admin writes go straight to Supabase
 * from the browser, so after a successful write the form asks the server to
 * revalidate "/" — but only when the write could actually change a slide.
 * Everything else waits for the 5-minute ISR window, which remains the backstop.
 *
 * These helpers are pure on purpose (no Supabase, no Next imports): they run in
 * the admin forms and are unit-tested in isolation. The server action
 * (`revalidateHomepageOffersAction`) decides authorization and, for the
 * "product" scope, re-checks the database.
 */

/**
 * What a write may have changed, from the hero's point of view.
 *
 *  · `offers`  — eligibility may have changed (a price, the offer flag, stock,
 *                activation…). Revalidate unconditionally: the write may have
 *                ADDED a slide or REMOVED one, and after a removal the database
 *                can no longer tell us the product used to be on the hero.
 *  · `product` — something the slide merely DISPLAYS changed (name, brand,
 *                description, images, the decant pool). Revalidate only if that
 *                product currently has an active on-offer variant; the server
 *                checks that, so the client never has to know.
 */
export type HomepageOfferChange =
  | { scope: "offers" }
  | { scope: "product"; productId: string };

/** The variant fields that decide whether — and how — a variant is a slide. */
export interface OfferVariantSnapshot {
  price: number;
  /** Effective promotional price: `null` whenever the offer is off. */
  offer_price: number | null;
  is_on_offer: boolean;
  stock: number;
  is_active: boolean;
  product_type: string;
  size_ml: number;
}

/** The product fields a slide shows (never its eligibility). */
export interface OfferProductSnapshot {
  name: string;
  brand_id: string;
  description: string;
}

export interface ProductEditSnapshot {
  product: OfferProductSnapshot;
  variant: OfferVariantSnapshot;
}

const VARIANT_FIELDS: (keyof OfferVariantSnapshot)[] = [
  "price",
  "offer_price",
  "is_on_offer",
  "stock",
  "is_active",
  "product_type",
  "size_ml",
];

const PRODUCT_FIELDS: (keyof OfferProductSnapshot)[] = ["name", "brand_id", "description"];

function changed<T extends object>(before: T, after: T, fields: (keyof T)[]): boolean {
  return fields.some((field) => !Object.is(before[field], after[field]));
}

/**
 * Classify a product + variant edit (the admin edit form saves both at once).
 *
 *   1. The variant is or was on offer AND one of its eligibility fields changed
 *      → `offers`. (Turning an offer off is caught here: `is_on_offer` changed.)
 *   2. A displayed product field changed → `product`: ANOTHER variant of the
 *      same product may be the one on the hero, so the server checks.
 *   3. Anything else (notes, gender, concentration, categories, wholesale
 *      prices, SKU, a non-offer variant's stock) → `null`, no revalidation.
 */
export function classifyProductEdit(
  productId: string,
  before: ProductEditSnapshot,
  after: ProductEditSnapshot
): HomepageOfferChange | null {
  const onOffer = before.variant.is_on_offer || after.variant.is_on_offer;
  if (onOffer && changed(before.variant, after.variant, VARIANT_FIELDS)) {
    return { scope: "offers" };
  }
  if (changed(before.product, after.product, PRODUCT_FIELDS)) {
    return { scope: "product", productId };
  }
  return null;
}

/**
 * A write that touched specific variants as a whole — created one, toggled its
 * activation, or changed its stock. Only on-offer variants can be slides.
 */
export function classifyVariantWrite(
  variants: readonly { is_on_offer: boolean }[]
): HomepageOfferChange | null {
  return variants.some((v) => v.is_on_offer) ? { scope: "offers" } : null;
}

/** Runtime guard for the server action, whose argument is untrusted input. */
export function isHomepageOfferChange(value: unknown): value is HomepageOfferChange {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.scope === "offers") return true;
  return (
    v.scope === "product" &&
    typeof v.productId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.productId)
  );
}
