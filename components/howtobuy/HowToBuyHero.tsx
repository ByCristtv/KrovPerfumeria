"use client";

import { useReveal } from "@/hooks/useReveal";

/**
 * Editorial opening for the buying-guide journey.
 *
 * Uses the shared reveal rather than Framer's mount animation. Because the
 * reveal is driven by an IntersectionObserver — and falls back to "just show it"
 * when observers are unavailable — the headline can never end up stranded
 * invisible waiting on an animation frame that hasn't come.
 */
export default function HowToBuyHero() {
  const ref = useReveal<HTMLDivElement>();

  return (
    <section
      aria-label="Cómo comprar en KROV Perfumería"
      className="relative overflow-hidden px-6 pb-10 pt-28 text-center md:pt-36"
    >
      {/* Ambient wine halos */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-krov-blood/10 blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-krov-blood/30 to-transparent"
      />

      <div ref={ref} className="reveal relative mx-auto max-w-3xl">
        {/* The page's only heading. It is the existing eyebrow line promoted to
            <h1> with the same classes: the page had no heading at all, and a
            visible redesign of this hero is the owner's call, not an SEO fix. */}
        <h1
          className="reveal reveal-d1 mb-6 text-xs uppercase tracking-[0.4em] text-krov-rose md:text-sm"
        >
          Guía de compra · KROV Perfumería
        </h1>

      </div>
    </section>
  );
}
