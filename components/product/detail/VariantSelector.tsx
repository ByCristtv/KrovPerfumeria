"use client";

import type { ProductTypes, ProductVariant } from "@/types/product";
import { resolveAvailability, type AvailabilityStatus } from "@/lib/stock";
import { formatPrice } from "@/lib/format";

interface VariantSelectorProps {
  variants: ProductVariant[];
  selectedId: string;
  onSelect: (v: ProductVariant) => void;
  /** Parent decant ml pool — drives decant variants' availability. */
  decantPoolMl: number;
}

const TYPE_LABEL: Record<string, string> = {
  full_size: "Full size",
  decant: "Decant",
  set: "Set",
};

/**
 * Display order of the presentation groups. Bottles first, then decants, then
 * any sets — each rendered as its own labelled block, and only when it holds
 * at least one variant.
 */
const GROUP_ORDER: { type: ProductTypes; heading: string;}[] = [
  { type: "full_size", heading: "Frasco" },
  { type: "decant", heading: "Decants" },
  { type: "set", heading: "Sets" },
];

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

export default function VariantSelector({
  variants,
  selectedId,
  onSelect,
  decantPoolMl,
}: VariantSelectorProps) {
  if (variants.length === 0) return null;

  // Group by presentation type, keeping each group ordered by size ascending.
  const groups = GROUP_ORDER.map((g) => ({
    ...g,
    items: variants
      .filter((v) => v.product_type === g.type)
      .sort((a, b) => a.size_ml - b.size_ml),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-4 md:gap-7">
      {groups.map((group) => (
        <section key={group.type} aria-label={group.heading}>
          <div className="mb-2 flex items-baseline justify-between gap-3 md:mb-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-[10px] uppercase tracking-[0.28em] text-krov-ash">
                {group.heading}
              </h2>

            </div>
            <span className="text-[11px] text-krov-dust">
              {group.items.length}{" "}
              {group.items.length === 1 ? "opción" : "opciones"}
            </span>
          </div>

          {/* Three to a row at every width: on a phone a 2-column grid turned a
              five-size decant range into three rows of oversized plates. */}
          <div className="grid grid-cols-3 gap-2 md:gap-2.5">
            {group.items.map((v) => (
              <VariantCard
                key={v.id}
                variant={v}
                selected={v.id === selectedId}
                status={resolveAvailability(v, decantPoolMl).status}
                onClick={() => onSelect(v)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface VariantCardProps {
  variant: ProductVariant;
  selected: boolean;
  /**
   * Only a sold-out size is unselectable. A made-to-order size must stay
   * pressable - it is how the customer reaches its "Por encargo" inquiry.
   */
  status: AvailabilityStatus;
  onClick: () => void;
}

/**
 * A size, as a plate you press.
 *
 * Selection is carried by the red edge and a lit surface — not by a shadow and
 * not by a spring. This control gets tapped repeatedly while sizes are being
 * compared, and a card that bounces makes the comparison harder to hold in the
 * eye. The entire state change is colour, settled in 250ms.
 */
function VariantCard({ variant, selected, status, onClick }: VariantCardProps) {
  const disabled = status === "sold_out";
  // Same offer rule as `useProductSelection` — the published price for THIS
  // size, so the chip and the headline price can never disagree.
  const onOffer = variant.is_on_offer && variant.offer_price != null;
  const price = onOffer ? (variant.offer_price as number) : variant.price;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`relative min-h-12 px-2.5 py-2 text-left transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-35 md:px-4 md:py-3.5 ${
        selected
          ? "border border-krov-blood bg-krov-blood/10"
          : "border border-krov-edge bg-krov-coal hover:border-krov-ash"
      }`}
    >
      <span className="flex flex-col gap-1">
        <span
          className={`text-base leading-none md:text-lg ${
            selected ? "text-krov-blush" : "text-krov-bone"
          }`}
          style={{ fontFamily: serif }}
        >
          {variant.size_ml} ml
        </span>
        {/* Phones only: the headline price is the selected size's, so the chips
            carry each size's own price to compare without tapping through. */}
        <span
          className={`text-[11px] tabular-nums leading-none md:hidden ${
            onOffer ? "text-krov-blush" : "text-krov-ash"
          }`}
        >
          {formatPrice(price)}
        </span>
        {/* Phones: the group heading above (Frasco / Decants / Sets) already
            names the type, so repeating it on every chip is dead weight. */}
        <span className="hidden text-[9px] uppercase tracking-[0.18em] text-krov-dust md:inline">
          {TYPE_LABEL[variant.product_type] || variant.product_type}
        </span>
        {status === "sold_out" && (
          <span className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-krov-ash">
            Agotado
          </span>
        )}
        {status === "made_to_order" && (
          <span className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-krov-rose">
            Por encargo
          </span>
        )}
      </span>
    </button>
  );
}
