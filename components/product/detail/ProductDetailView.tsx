"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useCart } from "@/hooks/useCart";
import { useProductSelection } from "@/hooks/useProductSelection";
import { useWholesalePricingMap } from "@/hooks/useWholesalePricingMap";
import { buildProductInquiryUrl } from "@/lib/whatsapp/productInquiry";
import type { ProductCardData, ProductDetailData } from "@/types/product";

import AmbientBackground from "./AmbientBackground";
import ProductGallery from "./ProductGallery";
import PurchasePanel from "./PurchasePanel";
import ProductDescription from "./ProductDescription";
import FragranceNotes from "./FragranceNotes";
import RelatedProducts from "./RelatedProducts";
import StickyPurchaseBar from "./StickyPurchaseBar";
import Reveal from "./Reveal";

interface ProductDetailViewProps {
  product: ProductDetailData;
  related: ProductCardData[];
  /** Variant preselected via the catalog link's `?variant=` search param. */
  initialVariantId?: string;
}

const TYPE_LABEL: Record<string, string> = {
  full_size: "Full size",
  decant: "Decant",
  set: "Set",
};

export default function ProductDetailView({
  product,
  related,
  initialVariantId,
}: ProductDetailViewProps) {
  const { addItem } = useCart();
  const sel = useProductSelection(product, initialVariantId);

  // Wholesale B2B pricing for this product's variants — fetched only for
  // approved buyers (see hook). The selected variant's row drives the panel.
  const variantIds = useMemo(
    () => product.product_variants.map((v) => v.id),
    [product.product_variants]
  );
  const { eligible: wholesaleEligible, pricingMap } =
    useWholesalePricingMap(variantIds);
  const wholesalePricing = pricingMap[sel.selectedVariant.id];

  // Images belong to the parent product, not the variant — the cart line shows
  // the parent's primary image regardless of the selected variant.
  const primaryImage =
    [...product.product_images].sort((a, b) => a.position - b.position)[0]?.url ||
    "/placeholder.png";

  // Made-to-order only: the WhatsApp inquiry for the SELECTED size, at the
  // published (retail, offer-aware) price the panel shows. `null` otherwise, so
  // nothing downstream can render an inquiry for an in-stock or sold-out size.
  const inquiryUrl = useMemo(
    () =>
      sel.availability.canInquire
        ? buildProductInquiryUrl({
            productName: product.name,
            brand: product.brands?.name,
            sizeMl: sel.selectedVariant.size_ml,
            productType: sel.selectedVariant.product_type,
            sku: sel.selectedVariant.sku,
            price: sel.effectivePrice,
            slug: product.slug,
          })
        : null,
    [
      sel.availability.canInquire,
      sel.selectedVariant,
      sel.effectivePrice,
      product.name,
      product.brands,
      product.slug,
    ]
  );

  const handleAdd = useCallback(() => {
    // The one gate between this page and the cart: only a variant KROV can ship
    // from its own inventory gets through (made-to-order and sold-out do not).
    if (!sel.availability.canAddToCart) return;
    const v = sel.selectedVariant;
    for (let i = 0; i < sel.quantity; i++) {
      addItem({
        variant_id: v.id,
        product_name: product.name,
        product_type: v.product_type,
        size_ml: v.size_ml,
        price: sel.effectivePrice,
        image_url: primaryImage,
        stock: sel.availableStock,
      });
    }
  }, [addItem, product, sel, primaryImage]);

  return (
    <>
      <AmbientBackground />

      <div className="relative pt-24 pb-24 sm:pt-28 sm:pb-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Breadcrumb — the trail back out. Kept as real links with a visible
              separator so a visitor who arrived from search can always find the
              catalogue without reaching for the browser back button. */}
          <nav
            aria-label="Migas"
            className="mb-10 text-[10px] uppercase tracking-[0.24em] text-krov-dust"
          >
            <Link href="/" className="transition-colors hover:text-krov-bone">
              KROV
            </Link>
            <span className="mx-2.5 text-krov-smoke" aria-hidden>
              /
            </span>
            <Link
              href="/products"
              className="transition-colors hover:text-krov-bone"
            >
              Colección
            </Link>
            <span className="mx-2.5 text-krov-smoke" aria-hidden>
              /
            </span>
            <span className="text-krov-rose">{product.name}</span>
          </nav>

          {/* Hero: gallery + purchase */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16">
            <ProductGallery
              images={product.product_images}
              productName={product.name}
            />
            <PurchasePanel
              product={product}
              selectedVariant={sel.selectedVariant}
              variants={sel.sortedVariants}
              onSelectVariant={sel.selectVariant}
              quantity={sel.quantity}
              onIncrement={sel.increment}
              onDecrement={sel.decrement}
              onSetQuantity={sel.setQuantity}
              effectivePrice={sel.effectivePrice}
              hasOffer={sel.hasOffer}
              availability={sel.availability}
              inquiryUrl={inquiryUrl}
              availableStock={sel.availableStock}
              onAddToCart={handleAdd}
              wholesaleEligible={wholesaleEligible}
              wholesalePricing={wholesalePricing}
            />
          </section>

          {/* Description */}
          {product.description && (
            <Reveal className="mt-28 sm:mt-36">
              <ProductDescription description={product.description} />
            </Reveal>
          )}

          {/* Fragrance notes */}
          <Reveal className="mt-24 sm:mt-32">
            <FragranceNotes
              top={product.notes_top}
              middle={product.notes_middle}
              base={product.notes_base}
            />
          </Reveal>

          {/* Related */}
          {related.length > 0 && (
            <Reveal className="mt-28 sm:mt-36">
              <RelatedProducts products={related} />
            </Reveal>
          )}
        </div>
      </div>

      <StickyPurchaseBar
        productName={product.name}
        variantLabel={`${sel.selectedVariant.size_ml} ml · ${
          TYPE_LABEL[sel.selectedVariant.product_type] ||
          sel.selectedVariant.product_type
        }`}
        price={sel.effectivePrice}
        status={sel.availability.status}
        onAdd={handleAdd}
        inquiryUrl={inquiryUrl}
      />
    </>
  );
}
