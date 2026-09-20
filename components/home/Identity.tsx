import Link from "next/link";
import KrovLogo from "@/components/brand/KrovLogo";
import Reveal from "@/components/ui/Reveal";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/**
 * The section that makes the name mean something.
 *
 * A visitor who never learns what KROV is has only seen a dark shop. This is
 * the one place the chain is stated outright — sangre → ADN → identidad →
 * deseo — and it is deliberately placed after the first look at product, so it
 * reads as an explanation the visitor has already started to want.
 *
 * Everything here is presentational: static copy and the brand asset. It adds
 * no data requirement of any kind.
 */

const CHAIN = [
  { word: "Sangre", note: "Lo que corre por dentro." },
  { word: "ADN", note: "Lo único que nadie más tiene." },
  { word: "Identidad", note: "Lo que los demás reconocen." },
  { word: "Deseo", note: "Lo que no se olvida." },
] as const;

export default function Identity() {
  return (
    <section
      aria-labelledby="identidad-titulo"
      className="relative overflow-hidden bg-krov-void px-5 py-24 sm:px-8 md:py-36"
    >
      {/* Two circular fields meeting — the mark's geometry as light, never as a
          second copy of the mark itself. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-1/4 h-[28rem] w-[28rem] krov-aura-wine opacity-70"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 bottom-0 h-[22rem] w-[22rem] krov-aura opacity-[0.18]"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[0.85fr_1fr] lg:gap-24">
        {/* ── The mark ─────────────────────────────────────────────────────
            The full lockup appears exactly once on the site, here, where the
            brand is being explained. Everywhere else uses the wordmark. */}
        <Reveal className="order-2 lg:order-1">
          <div className="relative mx-auto flex max-w-sm items-center justify-center lg:mx-0">
            <div
              aria-hidden
              className="absolute inset-0 -m-10 krov-aura opacity-20"
            />
            <KrovLogo variant="lockup" tone="original" width={340} />
          </div>
        </Reveal>

        {/* ── The idea ─────────────────────────────────────────────────────── */}
        <div className="order-1 lg:order-2">
          <Reveal>
            <p className="krov-eyebrow">El nombre</p>

            <h2
              id="identidad-titulo"
              className="mt-6 text-3xl leading-[1.08] text-krov-bone sm:text-4xl md:text-5xl"
              style={{ fontFamily: serif }}
            >
              KROV es <span className="italic text-krov-blush">кровь</span>.
              <br />
              Sangre.
            </h2>

            <div className="mt-7 max-w-lg space-y-5 text-[0.95rem] leading-relaxed text-krov-ash">
              <p>
                La sangre lleva el ADN, y el ADN es lo único que de verdad es
                tuyo. Un perfume funciona igual: dos personas usan el mismo
                frasco y nunca huelen igual. Reacciona con tu piel, con tu
                temperatura, con vos.
              </p>
              <p className="text-krov-bone">
                Por eso no vendemos fragancias. Ayudamos a encontrar la tuya.
              </p>
            </div>
          </Reveal>

          {/* The chain. Set as an ordered list because the order is the whole
              argument — each term is what the previous one becomes. */}
          <Reveal className="mt-12">
            <ol className="border-t border-krov-smoke">
              {CHAIN.map((step, i) => (
                <li
                  key={step.word}
                  className="group flex items-baseline gap-5 border-b border-krov-smoke py-5 sm:gap-8"
                >
                  <span
                    aria-hidden
                    className="w-6 shrink-0 text-[10px] tracking-[0.2em] text-krov-dust transition-colors duration-500 group-hover:text-krov-rose"
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className="w-32 shrink-0 text-xl text-krov-bone sm:text-2xl"
                    style={{ fontFamily: serif }}
                  >
                    {step.word}
                  </span>
                  <span className="text-sm leading-snug text-krov-ash">
                    {step.note}
                  </span>
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal className="mt-10">
            <Link href="/#historia" className="krov-btn-outline px-0 hover:border-transparent">
              <span className="krov-underline">Conocé la casa</span>
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
