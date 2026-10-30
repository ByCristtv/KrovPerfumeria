"use client";

import { useMemo, useState, useCallback } from "react";
import type { ProductDetailData, ProductVariant } from "@/types/product";
import {
  availableUnits,
  resolveAvailability,
  type Availability,
} from "@/lib/stock";

export interface UseProductSelectionReturn {
  sortedVariants: ProductVariant[];
  selectedVariant: ProductVariant;
  selectVariant: (v: ProductVariant) => void;
  quantity: number;
  /** Set the quantity directly (stock-clamped) — powers the wholesale "reach minimum" shortcut. */
  setQuantity: (q: number) => void;
  increment: () => void;
  decrement: () => void;
  effectivePrice: number;
  hasOffer: boolean;
  outOfStock: boolean;
  /** Sellable units of the selected variant (decant-aware). */
  availableStock: number;
  /**
   * What the selected variant is to a customer (in stock / made to order / sold
   * out) and which action it gets. `outOfStock` above only means "KROV has no
   * units" - it is true for made-to-order variants too - so decide the CTA from
   * this, never from `outOfStock`.
   */
  availability: Availability;
}

/**
 * Encapsulates variant + quantity state for the product detail page.
 * Keeps the rendering layer dumb — components only read derived values.
 */
export function useProductSelection(
  product: ProductDetailData,
  initialVariantId?: string
): UseProductSelectionReturn {
  // Order by presentation size ascending (numeric) so every consumer — the
  // grouped selector, the default pick — reads small→large left-to-right.
  const sortedVariants = useMemo(
    () =>
      [...product.product_variants].sort((a, b) => a.size_ml - b.size_ml),
    [product.product_variants]
  );

  // Priority: variant from the catalog link (`?variant=`) → the product's
  // featured variant → the first available variant.
  const initial =
    sortedVariants.find((v) => v.id === initialVariantId) ??
    sortedVariants.find((v) => v.id === product.featured_variant_id) ??
    sortedVariants[0];

  const [selectedVariant, setSelectedVariant] =
    useState<ProductVariant>(initial);
  const [quantity, setQuantityState] = useState(1);

  // Decant-aware sellable units for the selected variant.
  const availableStock = availableUnits(
    selectedVariant,
    product.decant_stock_ml
  );

  const selectVariant = useCallback((v: ProductVariant) => {
    setSelectedVariant(v);
    // Reset quantity so the user never holds a number that exceeds the new
    // variant's available stock.
    setQuantityState(1);
  }, []);

  const setQuantity = useCallback(
    (q: number) => {
      const clamped = Math.max(1, Math.min(q, availableStock || 1));
      setQuantityState(clamped);
    },
    [availableStock]
  );

  const increment = useCallback(
    () => setQuantity(quantity + 1),
    [quantity, setQuantity]
  );
  const decrement = useCallback(
    () => setQuantity(quantity - 1),
    [quantity, setQuantity]
  );

  const hasOffer =
    selectedVariant.is_on_offer && selectedVariant.offer_price != null;
  const effectivePrice = hasOffer
    ? (selectedVariant.offer_price as number)
    : selectedVariant.price;
  const outOfStock = availableStock <= 0;
  const availability = resolveAvailability(
    selectedVariant,
    product.decant_stock_ml
  );

  return {
    sortedVariants,
    selectedVariant,
    selectVariant,
    quantity,
    setQuantity,
    increment,
    decrement,
    effectivePrice,
    hasOffer,
    outOfStock,
    availableStock,
    availability,
  };
}
