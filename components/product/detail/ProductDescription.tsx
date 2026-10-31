const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

interface ProductDescriptionProps {
  description: string;
}

/**
 * The description, set as a pull quote.
 *
 * Copy about a fragrance is the closest thing the page has to writing, so it is
 * given the display serif at reading size on a narrow measure, opened by a red
 * rule. Left-aligned rather than centred: centred body text is decorative at
 * one line and genuinely harder to read at five.
 */
export default function ProductDescription({
  description,
}: ProductDescriptionProps) {
  return (
    <section className="relative mx-auto max-w-3xl">
      <p className="krov-eyebrow">Descripción</p>
      <span aria-hidden className="mt-3 block h-px w-16 bg-krov-blood sm:mt-5" />
      <p
        className="mt-4 whitespace-pre-line text-lg leading-relaxed text-krov-ash sm:mt-7 sm:text-2xl"
        style={{ fontFamily: serif }}
      >
        {description}
      </p>
    </section>
  );
}
