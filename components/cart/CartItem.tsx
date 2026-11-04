"use client";

import { Minus, Plus, X } from "lucide-react";
import ProductImage from "@/components/product/ProductImage";
import { CartLineItem } from "@/types/product";
import type { LinePricing } from "@/lib/pricing/wholesale";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

type CartItemProps = {
    item: CartLineItem;
    /** Wholesale-aware pricing for this line. Falls back to retail when absent. */
    line?: LinePricing;
    onIncrease: (variantId: string) => void;
    onDecrease: (variantId: string) => void;
    onDelete: (variantId: string) => void;
};

function formatPrice(value: number) {
    return value.toLocaleString("es-CR", {
        style: "currency",
        currency: "CRC",
        maximumFractionDigits: 0,
    });
}

/**
 * A cart line, set as a manifest row rather than a card.
 *
 * The thumbnail keeps the catalogue's linen niche so the product is recognisably
 * the same object the customer just clicked; everything around it is the dark
 * ground. Rows are separated by a hairline instead of being boxed — a stack of
 * bordered cards inside a bordered page is the shape this design is avoiding.
 *
 * Pricing logic (wholesale resolution, unlock threshold, subtotals) is untouched.
 */
export default function CartItem({
    item,
    line,
    onIncrease,
    onDecrease,
    onDelete,
}: CartItemProps) {
    const {
        variant_id,
        product_name,
        product_type,
        size_ml,
        price,
        image_url,
        quantity,
    } = item;

    // Prefer the wholesale-aware pricing; fall back to the retail price baked
    // into the cart line (guests, or before the pricing fetch resolves).
    const unitPrice = line?.unitPrice ?? price;
    const subtotal = line?.lineTotal ?? price * quantity;
    const isWholesale = line?.wasWholesale ?? false;
    const unitsToUnlock = line?.unitsToUnlock ?? null;
    // Eligible buyer + variant set up for wholesale, but this line is still at
    // the standard price (below the minimum). `wholesaleConfigured` is only true
    // on the eligible path, so retail buyers never see the wholesale badges.
    const wholesaleConfigured = line?.wholesaleConfigured ?? false;
    const wholesalePrice = line?.wholesalePrice ?? null;

    return (
        <article className="border-b border-krov-smoke py-5">
            <div className="flex gap-4 sm:gap-6">
                <div className="relative h-24 w-20 shrink-0 overflow-hidden bg-gradient-to-b from-krov-linen to-krov-linen-deep sm:h-28 sm:w-24">
                    <ProductImage
                        src={image_url}
                        alt={product_name}
                        fill
                        // The w-20 / sm:w-24 box less its p-2.
                        sizes="(max-width: 639px) 64px, 80px"
                        className="object-contain p-2"
                    />
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3
                                className="line-clamp-1 text-base text-krov-bone sm:text-lg"
                                style={{ fontFamily: serif }}
                            >
                                {product_name}
                            </h3>
                            <p className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-krov-dust">
                                {size_ml} ml ·{" "}
                                {product_type === "full_size" ? "Frasco original" : "Decant"}
                            </p>

                            {isWholesale && (
                                <span className="mt-2 inline-flex items-center gap-1.5 border border-krov-blood/40 bg-krov-blood/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-krov-rose">
                                    Precio mayorista
                                </span>
                            )}
                            {!isWholesale && wholesaleConfigured && (
                                <span className="mt-2 inline-flex items-center border border-krov-edge px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] text-krov-dust">
                                    Precio estándar
                                </span>
                            )}
                        </div>

                        {/* Remove: an icon at a full 40px target, muted until
                            hovered so it never competes with the price. */}
                        <button
                            onClick={() => onDelete(variant_id)}
                            aria-label={`Quitar ${product_name} del carrito`}
                            className="-mr-2 -mt-2 flex h-10 w-10 shrink-0 items-center justify-center text-krov-dust transition-colors hover:text-krov-blood"
                        >
                            <X size={16} aria-hidden />
                        </button>
                    </div>

                    {/* Wholesale unlock progress — only shown for eligible buyers below the minimum. */}
                    {unitsToUnlock !== null && unitsToUnlock > 0 && (
                        <p className="mt-3 border-l-2 border-krov-blood bg-krov-blood/[0.07] px-3 py-2 text-[11px] leading-snug text-krov-ash">
                            Agregá{" "}
                            <strong className="text-krov-bone">{unitsToUnlock}</strong>{" "}
                            {unitsToUnlock === 1 ? "unidad" : "unidades"} más para
                            desbloquear el precio mayorista
                            {wholesalePrice != null && (
                                <>
                                    {" "}
                                    de{" "}
                                    <strong className="text-krov-rose">
                                        {formatPrice(wholesalePrice)}
                                    </strong>
                                </>
                            )}
                            .
                        </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
                        <div className="inline-flex items-center border border-krov-edge">
                            <button
                                onClick={() => onDecrease(variant_id)}
                                className="flex h-9 w-9 items-center justify-center text-krov-ash transition-colors hover:bg-krov-graphite hover:text-krov-bone"
                                aria-label="Disminuir cantidad"
                            >
                                <Minus size={13} aria-hidden />
                            </button>
                            <span className="w-9 text-center text-sm tabular-nums text-krov-bone">
                                {quantity}
                            </span>
                            <button
                                onClick={() => onIncrease(variant_id)}
                                className="flex h-9 w-9 items-center justify-center text-krov-ash transition-colors hover:bg-krov-graphite hover:text-krov-bone"
                                aria-label="Aumentar cantidad"
                            >
                                <Plus size={13} aria-hidden />
                            </button>
                        </div>

                        <div className="ml-auto text-right">
                            {/* When wholesale applied, show the retail unit price struck through. */}
                            {isWholesale && line && (
                                <p className="text-[10px] tabular-nums text-krov-dust line-through">
                                    {formatPrice(line.retailPrice)} c/u
                                </p>
                            )}
                            <p className="text-[10px] tabular-nums text-krov-dust">
                                {formatPrice(unitPrice)} c/u
                            </p>
                            <p className="text-base tabular-nums text-krov-bone">
                                {formatPrice(subtotal)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </article>
    );
}
