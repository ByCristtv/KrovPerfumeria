// Shared design tokens for the contact sections of the home page.
// Mirrors the site's premium identity: KROV red on near-black, Didone headings.

export const serif =
  "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

export const fadeUp = {
  hidden: { opacity: 0, y: 32 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};
