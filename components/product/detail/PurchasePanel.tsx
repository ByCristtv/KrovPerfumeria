"use client";

import ProductHeader from "./ProductHeader";
import PriceTag from "./PriceTag";
import StockBadge from "./StockBadge";
import VariantSelector from "./VariantSelector";
import QuantityStepper from "./QuantityStepper";
import AddToCartButton from "./AddToCartButton";
import InquiryButton from "./InquiryButton";
import WholesalePanel from "./WholesalePanel";
import type { ProductDetailData, ProductVariant } from "@/types/product";
import type { Availability } from "@/lib/stock";
import {
  isWholesaleConfigured,
  resolveLinePricing,
  type VariantPricing,
} from "@/lib/pricing/wholesale";

interface PurchasePanelProps {
  product: ProductDetailData;
  selectedVariant: ProductVariant;
  variants: ProductVariant[];
  onSelectVariant: (v: ProductVariant) => void;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  /** Set the quantity directly — powers the wholesale "reach minimum" shortcut. */
  onSetQuantity: (q: number) => void;
  effectivePrice: number;
  hasOffer: boolean;
  /**
   * What the selected variant is to a customer and which action it gets (see
   * `resolveAvailability`). The only thing that decides between add-to-cart, the
   * WhatsApp inquiry and the sold-out state.
   */
  availability: Availability;
  /** Prefilled WhatsApp link; set exactly when the variant is made to order. */
  inquiryUrl: string | null;
  /** Sellable units of the selected variant (decant-aware). */
  availableStock: number;
  onAddToCart: () => void;
  /** Viewer is an approved wholesale buyer. */
  wholesaleEligible: boolean;
  /** Wholesale pricing columns for the selected variant (eligible buyers only). */
  wholesalePricing?: VariantPricing;
}

export default function PurchasePanel({
  product,
  selectedVariant,
  variants,
  onSelectVariant,
  quantity,
  onIncrement,
  onDecrement,
  onSetQuantity,
  effectivePrice,
  hasOffer,
  availability,
  inquiryUrl,
  availableStock,
  onAddToCart,
  wholesaleEligible,
  wholesalePricing,
}: PurchasePanelProps) {
  const madeToOrder = availability.status === "made_to_order";

  // Wholesale only surfaces for approved buyers on a fully-configured variant -
  // and never for a made-to-order one: quantity tiers belong to the cart, which
  // a made-to-order variant cannot enter.
  const showWholesale =
    !madeToOrder &&
    wholesaleEligible &&
    !!wholesalePricing &&
    isWholesaleConfigured(wholesalePricing);

  const line = showWholesale
    ? resolveLinePricing(wholesalePricing, quantity, true)
    : null;

  const minQty = line?.minWholesaleQuantity ?? 0;
  // "Reach minimum" shortcut: only shown when the minimum is actually
  // stockable AND the buyer hasn't reached it yet. Once quantity >= minimum the
  // shortcut has served its purpose and disappears — the stepper takes over for
  // fine adjustments, and there's no way to accidentally overshoot in one tap.
  const showReachMinimum =
    showWholesale && minQty > 0 && availableStock >= minQty && quantity < minQty;

  return (
    <div className="flex flex-col gap-7">
      <ProductHeader
        brand={product.brands?.name || ""}
        name={product.name}
        gender={product.gender}
        concentration={product.concentration}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <PriceTag
          price={effectivePrice}
          originalPrice={hasOffer ? selectedVariant.price : undefined}
          onOffer={hasOffer}
        />
        <StockBadge availability={availability} />
      </div>

      {showWholesale && line && (
        <WholesalePanel
          wholesalePrice={line.wholesalePrice as number}
          minQuantity={minQty}
          active={line.wasWholesale}
          unitsToUnlock={line.unitsToUnlock ?? 0}
        />
      )}

      <span aria-hidden className="krov-rule h-px w-full" />

      <VariantSelector
        variants={variants}
        selectedId={selectedVariant.id}
        onSelect={onSelectVariant}
        decantPoolMl={product.decant_stock_ml}
      />

      {/* A made-to-order variant is not bought by quantity - it is asked about -
          so the stepper goes with the add-to-cart button. */}
      {!madeToOrder && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[10px] uppercase tracking-[0.28em] text-krov-ash">
              Cantidad
            </h2>
            <QuantityStepper
              quantity={quantity}
              max={Math.max(1, availableStock)}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
            />
          </div>

          {showReachMinimum && (
            <button
              type="button"
              onClick={() => onSetQuantity(minQty)}
              aria-label={`Fijar la cantidad en el mínimo mayorista de ${minQty} unidades`}
              className="inline-flex items-center justify-center gap-2 border border-krov-blood/50 bg-krov-blood/[0.07] px-4 py-2.5 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors hover:bg-krov-blood/15"
            >
              Alcanzar mínimo mayorista · {minQty} uds.
            </button>
          )}
        </div>
      )}

      {madeToOrder ? (
        // Never the cart in this state. If the link is somehow missing the CTA
        // is simply absent - there is no fallback path into add-to-cart.
        <div className="flex flex-col gap-3">
          <MadeToOrderNotice />
          {inquiryUrl && (
            <>
              <InquiryButton href={inquiryUrl} />
              <p className="text-center text-[11px] text-krov-dust">
                Se abrirá WhatsApp con el mensaje listo para que lo envíes.
              </p>
            </>
          )}
        </div>
      ) : (
        <AddToCartButton
          onAdd={onAddToCart}
          disabled={!availability.canAddToCart}
          disabledLabel="Agotado"
        />
      )}

      {/* Reassurance, set as a rule of three under the CTA — the last thing read
          before committing. Hairlines rather than boxes: three bordered tiles
          under a red button is exactly the template shape this page avoids. */}
      <ul className="grid grid-cols-3 divide-x divide-krov-smoke border-y border-krov-smoke">
        <Perk title="Original" subtitle="100% auténtico" />
        <Perk title="Envío" subtitle="Todo el país" />
        <Perk title="Asesoría" subtitle="Por WhatsApp" />
      </ul>
    </div>
  );
}

/**
 * Sets the expectation BEFORE the customer taps: this is a request, not a
 * purchase. Availability comes from the supplier and can change, so it is
 * confirmed (with a delivery estimate) over WhatsApp before the sale is final.
 */
function MadeToOrderNotice() {
  return (
    <div className="border border-krov-smoke bg-krov-coal px-4 py-3.5">
      <p className="text-[10px] uppercase tracking-[0.24em] text-krov-rose">
        Por encargo
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-krov-ash">
        Este perfume no está en nuestro inventario: lo gestionamos con nuestro
        proveedor. Antes de finalizar tu compra confirmamos por WhatsApp si
        sigue disponible y cuál sería el plazo de entrega.
      </p>
    </div>
  );
}

function Perk({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <li className="px-3 py-4 text-center">
      <p className="text-[10px] uppercase tracking-[0.2em] text-krov-rose">
        {title}
      </p>
      <p className="mt-1.5 text-[11px] text-krov-dust">{subtitle}</p>
    </li>
  );
}
