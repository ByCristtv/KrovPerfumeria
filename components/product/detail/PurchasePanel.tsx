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
  /** Attached to the quantity + CTA block; the mobile purchase bar watches it. */
  actionRef?: React.Ref<HTMLDivElement>;
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
  actionRef,
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
    <div className="flex flex-col gap-4 md:gap-7">
      <ProductHeader
        brand={product.brands?.name || ""}
        name={product.name}
        gender={product.gender}
        concentration={product.concentration}
      />

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
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

      <span aria-hidden className="krov-rule hidden h-px w-full md:block" />

      <VariantSelector
        variants={variants}
        selectedId={selectedVariant.id}
        onSelect={onSelectVariant}
        decantPoolMl={product.decant_stock_ml}
      />

      {/* The action block. `actionRef` is what the mobile bar watches: it slides
          up only once this block has left the screen, so the page never shows
          two add buttons at once.

          On a phone, stepper and CTA share one row — a 44px stepper beside a
          full-width button costs one row where the stacked layout cost three. It
          is a wrapping flex row: when the CTA's minimum width no longer fits
          beside the stepper (~320px screens) it drops to its own full-width
          row instead of squeezing its label. From `md` it is the original
          stacked column (stepper row with its label, then the CTA). */}
      <div
        ref={actionRef}
        className="flex flex-wrap items-stretch gap-2.5 md:flex-col md:flex-nowrap md:gap-7"
      >
        {/* A made-to-order variant is not bought by quantity - it is asked about -
            so the stepper goes with the add-to-cart button. `contents` on a
            phone lets the stepper and the wholesale shortcut be items of the
            row above; from `md` the block is the original flex column. */}
        {!madeToOrder && (
          <div className="contents md:flex md:flex-col md:gap-3">
            <div className="flex shrink-0 items-stretch justify-between gap-4 md:items-center">
              <h2 className="sr-only text-[10px] uppercase tracking-[0.28em] text-krov-ash md:not-sr-only">
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
                className="order-last basis-full inline-flex items-center justify-center gap-2 border border-krov-blood/50 bg-krov-blood/[0.07] px-4 py-2.5 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors hover:bg-krov-blood/15 md:order-none md:basis-auto"
              >
                Alcanzar mínimo mayorista · {minQty} uds.
              </button>
            )}
          </div>
        )}

        {madeToOrder ? (
          // Never the cart in this state. If the link is somehow missing the CTA
          // is simply absent - there is no fallback path into add-to-cart.
          <div className="flex basis-full flex-col gap-2.5 md:basis-auto md:gap-3">
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
          <div className="grid min-w-[10.5rem] flex-1 md:min-w-0 md:flex-none">
            <AddToCartButton
              onAdd={onAddToCart}
              disabled={!availability.canAddToCart}
              disabledLabel="Agotado"
            />
          </div>
        )}
      </div>

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
    <div className="border border-krov-smoke bg-krov-coal px-3.5 py-3 md:px-4 md:py-3.5">
      <p className="text-[10px] uppercase tracking-[0.24em] text-krov-rose">
        Por encargo
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-krov-ash md:mt-2 md:text-[13px]">
        Este perfume no está en nuestro inventario: lo gestionamos con nuestro
        proveedor. Antes de finalizar tu compra confirmamos por WhatsApp si
        sigue disponible y cuál sería el plazo de entrega.
      </p>
    </div>
  );
}

function Perk({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <li className="px-2 py-2.5 text-center md:px-3 md:py-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-krov-rose">
        {title}
      </p>
      <p className="mt-1 text-[11px] text-krov-dust md:mt-1.5">{subtitle}</p>
    </li>
  );
}
