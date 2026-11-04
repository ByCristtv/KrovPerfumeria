import Image from "next/image";

/**
 * The one place the KROV mark is allowed to come from.
 *
 * The mark is a fixed brand asset: it is never redrawn in CSS, never set as
 * live text, never recoloured and never scaled non-uniformly. Everything this
 * component does is pick the correct official file for the surface it sits on
 * and give it an intrinsic size so it cannot be squashed by a flex parent.
 *
 * Files live in `public/logos/`. The `krov-*` files are whitespace-cropped
 * derivatives of the supplied originals — identical artwork, identical
 * proportions, just without the 1500×1500 empty canvas the exports carry (an
 * uncropped export renders the wordmark at roughly half the size of its own
 * layout slot). The untouched originals remain alongside them.
 *
 *   tone="light"  white artwork      → for void / ink / coal surfaces
 *   tone="dark"   black artwork      → for linen surfaces
 *   tone="brand"  black + KROV red   → for linen surfaces where the mark leads
 *   tone="original" pale + KROV red  → for dark surfaces where the mark leads
 *
 * `variant="lockup"` is the full composition with the ornament above the
 * wordmark. It carries a large embedded raster, so it is reserved for the one
 * or two places a full brand statement is warranted — never for chrome.
 */

type Tone = "light" | "dark" | "brand" | "original";
type Variant = "wordmark" | "lockup";

// Intrinsic dimensions of each derivative, so `next/image` reserves the right
// box and no layout shift occurs while the SVG loads.
const ASSETS: Record<Variant, { w: number; h: number; files: Partial<Record<Tone, string>> }> = {
  wordmark: {
    w: 797,
    h: 261,
    files: {
      light: "/logos/krov-wordmark-light.svg",
      dark: "/logos/krov-wordmark-dark.svg",
      brand: "/logos/krov-wordmark-brand.svg",
      original: "/logos/krov-wordmark-original.svg",
    },
  },
  lockup: {
    w: 797,
    h: 741,
    files: {
      light: "/logos/krov-lockup-light.svg",
      original: "/logos/krov-lockup-original.svg",
    },
  },
};

interface KrovLogoProps {
  variant?: Variant;
  tone?: Tone;
  /** Rendered width in px. Height follows the asset's own aspect ratio. */
  width: number;
  /** Load immediately, for a logo above the fold. It is never the LCP element,
   *  so it does not get a preload that would compete with the one that is. */
  eager?: boolean;
  className?: string;
}

export default function KrovLogo({
  variant = "wordmark",
  tone = "light",
  width,
  eager = false,
  className = "",
}: KrovLogoProps) {
  const asset = ASSETS[variant];
  const src = asset.files[tone] ?? asset.files.light!;

  return (
    <Image
      src={src}
      // The mark reads as "KROV Perfumería"; announcing it again on every
      // surface would make screen readers repeat the brand endlessly. Callers
      // that need a name wrap this in a link with its own aria-label.
      alt="KROV Perfumería"
      width={width}
      height={Math.round((width * asset.h) / asset.w)}
      loading={eager ? "eager" : "lazy"}
      // `h-auto` keeps the aspect ratio locked even if a parent constrains the
      // width — the mark must never be stretched on either axis.
      className={`h-auto w-auto max-w-full ${className}`}
      style={{ width }}
    />
  );
}
