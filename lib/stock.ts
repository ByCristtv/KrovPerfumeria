import type { ProductTypes } from "@/types/product";

/**
 * Minimal shape needed to compute a variant's sellable units.
 */
export interface StockableVariant {
  product_type: ProductTypes | string;
  size_ml: number;
  /** Manual stock column — authoritative for everything EXCEPT decants. */
  stock: number;
}

/**
 * Sellable units for a variant — the single source of truth for "how many
 * can I buy" across catalog, detail, cart, checkout and quantity selectors.
 *
 * Decants do NOT persist stock on the variant (it stays 0). Their inventory
 * is the parent product's shared ml pool (`products.decant_stock_ml`), so the
 * available units are derived:
 *
 *   availableUnits = floor(decant_stock_ml / variant.size_ml)
 *
 * Every other variant type (full_size, set, …) keeps using its own `stock`
 * column exactly as before.
 *
 * @param variant       The variant (product_type, size_ml, stock).
 * @param decantPoolMl  Parent product's `decant_stock_ml`. Only consulted for
 *                      decants; pass null/undefined when unknown.
 */
export function availableUnits(
  variant: StockableVariant,
  decantPoolMl: number | null | undefined
): number {
  if (variant.product_type === "decant") {
    if (!decantPoolMl || decantPoolMl <= 0 || variant.size_ml <= 0) return 0;
    return Math.floor(decantPoolMl / variant.size_ml);
  }
  return variant.stock;
}

/**
 * Convenience: can KROV ship this variant from its OWN inventory right now?
 *
 * This is physical availability only. It is deliberately blind to supplier
 * availability, which is why the cart, checkout and structured-data callers can
 * keep using it unchanged: a made-to-order variant is NOT in stock here, and
 * must never become buyable through any path that asks this question. Use
 * {@link resolveAvailability} when deciding what to SHOW or which action to offer.
 */
export function isInStock(
  variant: StockableVariant,
  decantPoolMl: number | null | undefined
): boolean {
  return availableUnits(variant, decantPoolMl) > 0;
}

/**
 * The three customer-facing states of a variant.
 *
 *   in_stock       KROV owns sellable units  -> normal add-to-cart flow.
 *   made_to_order  none owned, but the supplier was verified to have it
 *                  ("Por encargo") -> WhatsApp inquiry only; never the cart.
 *   sold_out       neither ("Agotado") -> no purchase, no inquiry.
 *
 * Derived on demand from stock + `supplier_available`; never stored, so it can
 * never disagree with the inventory it summarises.
 */
export type AvailabilityStatus = "in_stock" | "made_to_order" | "sold_out";

/**
 * A variant as `resolveAvailability` reads it: the stock shape plus the supplier
 * flag. The flag is optional/nullable on purpose - payloads fetched before the
 * column existed (or by a query that does not select it) simply do not carry it,
 * and that has to read as "not verified", never as "available".
 */
export interface SupplierAwareVariant extends StockableVariant {
  supplier_available?: boolean | null;
}

export interface Availability {
  status: AvailabilityStatus;
  /**
   * Units KROV can sell immediately (decant-aware) - the same number
   * `availableUnits` returns, and 0 unless `status` is `in_stock`. Supplier
   * availability never contributes units.
   */
  units: number;
  /** The normal purchase flow (cart -> checkout) may be offered. */
  canAddToCart: boolean;
  /** The WhatsApp availability inquiry may be offered. */
  canInquire: boolean;
}

function availability(status: AvailabilityStatus, units: number): Availability {
  return {
    status,
    units,
    canAddToCart: status === "in_stock",
    canInquire: status === "made_to_order",
  };
}

/**
 * The single rule for what a variant is to a customer and which action it gets.
 * Cards, the detail page, the sticky bar and the variant selector must all ask
 * this instead of re-deriving it from `stock`.
 *
 *   1. Physical units > 0                       -> in_stock. Physical stock wins:
 *      a variant that is ALSO flagged `supplier_available` is a normal sale.
 *   2. No units, and `supplier_available` is exactly `true`, and the variant is
 *      not a decant                            -> made_to_order.
 *   3. Anything else                            -> sold_out.
 *
 * Fail-closed on purpose: `null`, `undefined` and any non-`true` value (legacy
 * rows, a query that did not select the column) are "not verified". Decants are
 * never made-to-order - their only inventory is KROV's own ml pool, so supplier
 * stock is never decant liquid (the database enforces the same rule with
 * `chk_decant_not_supplier_available`; this keeps the UI correct even if a bad
 * row slipped through).
 *
 * @param variant       The variant (product_type, size_ml, stock, supplier flag).
 * @param decantPoolMl  Parent product's `decant_stock_ml`; only consulted for decants.
 */
export function resolveAvailability(
  variant: SupplierAwareVariant,
  decantPoolMl: number | null | undefined
): Availability {
  const units = availableUnits(variant, decantPoolMl);

  if (Number.isFinite(units) && units > 0) {
    return availability("in_stock", units);
  }

  if (variant.product_type !== "decant" && variant.supplier_available === true) {
    return availability("made_to_order", 0);
  }

  return availability("sold_out", 0);
}
