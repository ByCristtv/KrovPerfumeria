const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/**
 * The masthead over the collection.
 *
 * This was previously a single pill badge floating in ~200px of empty space —
 * the catalogue opened on nothing. It now opens the way a magazine section
 * opens: a label, a statement, and a rule, with the grid starting immediately
 * beneath.
 *
 * Server component. It was a client component only to run a Framer stagger on
 * two elements, which cost a hydration boundary at the very top of the most
 * visited page in the store for an animation nobody was waiting to see.
 */
export default function CatalogHero() {
  return (
    <section className="relative overflow-hidden px-2 pb-10 pt-8 sm:px-16 md:pt-36">
      <div
        aria-hidden
        className="krov-aura-wine pointer-events-none absolute -top-28 left-1/4 h-[26rem] w-[26rem] opacity-60"
      />
    </section>
  );
}
