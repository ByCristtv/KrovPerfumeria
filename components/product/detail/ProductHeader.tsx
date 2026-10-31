"use client";

interface ProductHeaderProps {
  brand: string;
  name: string;
  gender: "masculine" | "feminine" | "unisex";
  concentration: string;
}

const GENDER_LABEL: Record<ProductHeaderProps["gender"], string> = {
  masculine: "Masculino",
  feminine: "Femenino",
  unisex: "Unisex",
};

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/**
 * Brand line, name, and the two facts that classify a fragrance.
 *
 * The per-element entrance animations are gone. Three staggered Framer nodes
 * meant the product's own name faded in after the page had already painted —
 * on a slow connection the most important text on the screen was the last thing
 * to arrive. It renders immediately now; the page's motion budget is spent on
 * scroll reveals further down, where nothing is waiting on it.
 */
export default function ProductHeader({
  brand,
  name,
  gender,
  concentration,
}: ProductHeaderProps) {
  return (
    <div>
      {brand && (
        <p className="text-[10px] uppercase tracking-[0.34em] text-krov-rose">
          {brand}
        </p>
      )}

      {/* Phone scale: ~28px, so even a three-word name stays at two lines. The
          display size returns at `sm`. */}
      <h1
        className="mt-1.5 text-[1.75rem] leading-[1.08] text-krov-bone sm:mt-4 sm:text-5xl sm:leading-[1.02]"
        style={{ fontFamily: serif }}
      >
        {name}
      </h1>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:mt-5 sm:gap-2.5">
        <Chip>{concentration}</Chip>
        <Chip>{GENDER_LABEL[gender]}</Chip>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center border border-krov-smoke px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-krov-ash sm:px-3 sm:py-1.5">
      {children}
    </span>
  );
}
