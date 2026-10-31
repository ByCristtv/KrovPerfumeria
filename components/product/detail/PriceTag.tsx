"use client";

import { formatPrice } from "@/lib/format";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

interface PriceTagProps {
  price: number;
  originalPrice?: number;
  onOffer: boolean;
}

/**
 * The price is set in the display serif at headline scale — on this page it is
 * the second-largest thing after the product's name, which is the hierarchy a
 * buying decision actually has.
 *
 * It is plain text, not an animated node. It used to fade in through Framer
 * Motion starting at `opacity: 0`, which left the price invisible on the first
 * paint of a phone until hydration ran — the one number a shopper is looking
 * for. Selecting another size now swaps it instantly; the selected size card
 * already carries the "something changed" signal.
 */
export default function PriceTag({
  price,
  originalPrice,
  onOffer,
}: PriceTagProps) {
  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
      <span
        className="text-[2rem] tabular-nums leading-none text-krov-bone sm:text-4xl"
        style={{ fontFamily: serif }}
      >
        {formatPrice(price)}
      </span>

      {onOffer && originalPrice != null && originalPrice > price && (
        <span className="mb-0.5 text-sm tabular-nums text-krov-dust line-through sm:mb-1">
          {formatPrice(originalPrice)}
        </span>
      )}

      {onOffer && (
        <span className="mb-1 bg-krov-blood px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-krov-void sm:mb-1.5">
          Oferta
        </span>
      )}
    </div>
  );
}
