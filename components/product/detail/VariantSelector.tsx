"use client";

import type { ProductTypes, ProductVariant } from "@/types/product";
import { availableUnits } from "@/lib/stock";

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
    <div className="flex flex-col gap-7">
      {groups.map((group) => (
        <section key={group.type} aria-label={group.heading}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
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

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {group.items.map((v) => (
              <VariantCard
                key={v.id}
                variant={v}
                selected={v.id === selectedId}
                disabled={availableUnits(v, decantPoolMl) <= 0}
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
  disabled: boolean;
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
function VariantCard({ variant, selected, disabled, onClick }: VariantCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`relative px-4 py-3.5 text-left transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-35 ${
        selected
          ? "border border-krov-blood bg-krov-blood/10"
          : "border border-krov-edge bg-krov-coal hover:border-krov-ash"
      }`}
    >
      <span className="flex flex-col gap-1">
        <span
          className={`text-lg leading-none ${
            selected ? "text-krov-blush" : "text-krov-bone"
          }`}
          style={{ fontFamily: serif }}
        >
          {variant.size_ml} ml
        </span>
        <span className="text-[9px] uppercase tracking-[0.18em] text-krov-dust">
          {TYPE_LABEL[variant.product_type] || variant.product_type}
        </span>
        {disabled && (
          <span className="mt-0.5 text-[9px] uppercase tracking-[0.18em] text-krov-ash">
            Agotado
          </span>
        )}
      </span>
    </button>
  );
}
