"use client";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

interface FragranceNotesProps {
  top: string | null;
  middle: string | null;
  base: string | null;
}

const TIERS = [
  {
    key: "top" as const,
    label: "Salida",
    sublabel: "Top",
    description:
      "La primera impresión — lo que se percibe al instante.",
  },
  {
    key: "middle" as const,
    label: "Corazón",
    sublabel: "Heart",
    description: "El alma del perfume, su carácter dominante.",
  },
  {
    key: "base" as const,
    label: "Fondo",
    sublabel: "Base",
    description: "La huella final, lo que permanece sobre la piel.",
  },
];

/**
 * The olfactive pyramid, set as a numbered descent rather than three cards.
 *
 * A fragrance is experienced in sequence — top, then heart, then base, over
 * hours — so the notes are laid out as an ordered progression down the page
 * with a rule between each stage. Three equal boxes side by side implied the
 * three tiers were parallel options, which is the opposite of what they are.
 *
 * The per-card scroll animations are gone; the shared `.reveal-fx` observer on
 * the parent section already handles the entrance, and this had its own set.
 */
export default function FragranceNotes({ top, middle, base }: FragranceNotesProps) {
  const values = [top, middle, base];
  if (values.every((t) => !t)) return null;

  return (
    <section className="relative mx-auto max-w-3xl">
      <header className="mb-5 sm:mb-10">
        <p className="krov-eyebrow">La pirámide olfativa</p>
        <h2
          className="mt-3 text-2xl text-krov-bone sm:mt-5 sm:text-4xl"
          style={{ fontFamily: serif }}
        >
          Cómo se <span className="italic text-krov-blush">revela</span>
        </h2>
      </header>

      <ol className="border-t border-krov-smoke">
        {TIERS.map((tier, i) => {
          const value = values[i];
          if (!value) return null;
          return (
            <li
              key={tier.key}
              className="grid grid-cols-[auto_1fr] gap-x-5 border-b border-krov-smoke py-5 sm:py-7 sm:grid-cols-[auto_10rem_1fr] sm:gap-x-8"
            >
              <span
                aria-hidden
                className="text-[10px] leading-6 tracking-[0.2em] text-krov-rose"
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              <div className="min-w-0">
                <h3
                  className="text-2xl leading-none text-krov-bone"
                  style={{ fontFamily: serif }}
                >
                  {tier.label}
                </h3>
                <p className="mt-1.5 text-[9px] uppercase tracking-[0.24em] text-krov-dust">
                  {tier.sublabel}
                </p>
                <p className="mt-3 text-xs leading-relaxed text-krov-dust sm:hidden">
                  {tier.description}
                </p>
              </div>

              <div className="col-span-2 mt-4 sm:col-span-1 sm:mt-0">
                <p className="text-[0.95rem] leading-relaxed text-krov-bone">
                  {value}
                </p>
                <p className="mt-2.5 hidden text-xs leading-relaxed text-krov-dust sm:block">
                  {tier.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
