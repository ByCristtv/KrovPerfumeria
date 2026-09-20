"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { SocialStatePanel, SocialPanelAction } from "@/components/social/socialUi";
import type { PurchasedFragrance } from "@/types/social";

/**
 * "Fragancias compradas" — the social half of the friend profile.
 *
 * Why this is not <ProductCard>: that component needs a `featured_variant` to
 * exist, reads the wholesale pricing context, computes stock, renders prices
 * and offers an add-to-cart. The social projection has none of those fields by
 * design — exposing a friend's purchase price or letting this screen act as a
 * storefront is exactly what the projection exists to prevent. Reusing it would
 * have meant inventing commercial data to satisfy its props.
 *
 * So the CARD is new; the visual language is not. The light niche, the 4:5
 * plate, `object-contain`, the rose brand eyebrow, the serif name, the red edge
 * that lights on hover and the `/placeholder.png` fallback are all lifted from
 * ProductCard so the section reads as the same storefront rather than a social
 * widget bolted onto it.
 *
 * Each card links to the real catalog page at /products/[slug]. There is no
 * second product-detail implementation here — the link hands the visitor to the
 * commerce catalog that already exists.
 */

const SERIF = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/** The same fallback ProductGallery and ProductCard use. */
const PLACEHOLDER = "/placeholder.png";

export default function PurchasedFragrances({
  fragrances,
  ownerName,
}: {
  fragrances: PurchasedFragrance[];
  /** Already resolved for display — a friend may have no username. */
  ownerName: string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4">
      {fragrances.map((fragrance) => (
        <li key={fragrance.productId}>
          <FragranceCard fragrance={fragrance} ownerName={ownerName} />
        </li>
      ))}
    </ul>
  );
}

function FragranceCard({
  fragrance,
  ownerName,
}: {
  fragrance: PurchasedFragrance;
  ownerName: string;
}) {
  const [loaded, setLoaded] = useState(false);
  // A broken remote URL falls back to the same placeholder a missing one does,
  // so a dead image never leaves an empty plate in the grid.
  const [failed, setFailed] = useState(false);

  const src = !fragrance.imageUrl || failed ? PLACEHOLDER : fragrance.imageUrl;

  return (
    <article className="group flex h-full flex-col">
      <Link
        href={`/products/${fragrance.slug}`}
        // The card is one link, so the accessible name carries the whole
        // meaning rather than leaving a screen reader with a bare brand name.
        aria-label={`Ver ${fragrance.name} de ${fragrance.brandName}, comprado por ${ownerName}`}
        className="relative block aspect-4/5 overflow-hidden rounded-t-xl bg-linear-to-b from-krov-linen to-krov-linen-deep"
      >
        {!loaded && (
          <span
            aria-hidden
            className="absolute inset-0 animate-pulse bg-krov-linen-deep"
          />
        )}
        <Image
          src={src}
          alt=""
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            setLoaded(true);
          }}
          className={`object-contain p-6 transition-all duration-700 ease-krov group-hover:scale-[1.04] ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-krov-blood transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100"
        />
      </Link>

      <div className="pt-3.5">
        <p className="text-[9px] uppercase tracking-[0.28em] text-krov-rose">
          {fragrance.brandName}
        </p>
        <h3
          className="mt-1.5 line-clamp-2 text-base leading-snug text-krov-bone transition-colors duration-300 group-hover:text-krov-blush"
          style={{ fontFamily: SERIF }}
          title={fragrance.name}
        >
          {fragrance.name}
        </h3>
      </div>
    </article>
  );
}

/**
 * A friend with no qualifying purchases. Not an error — a new customer, or one
 * whose orders have not been confirmed yet, lands here legitimately.
 */
export function PurchasedFragrancesEmptyState({
  name,
}: {
  /** Already resolved for display. */
  name: string;
}) {
  return (
    <SocialStatePanel title={`${name} aún no tiene fragancias visibles`}>
      Aquí aparecerán las fragancias de sus pedidos confirmados.
    </SocialStatePanel>
  );
}

/**
 * The fragrance query failed. Scoped to this section: the profile above it
 * stays on screen, because the two are independent queries.
 */
export function PurchasedFragrancesErrorState({
  onRetry,
}: {
  onRetry: () => void;
}) {
  return (
    <SocialStatePanel title="No pudimos cargar las fragancias">
      <p>Vuelve a intentarlo en unos segundos.</p>
      <SocialPanelAction label="Reintentar" onClick={onRetry} />
    </SocialStatePanel>
  );
}

/** Plate-shaped placeholders, sized to the real cards so the grid holds still. */
export function PurchasedFragrancesSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div
      aria-hidden
      className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 lg:grid-cols-4"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i}>
          <div className="aspect-4/5 animate-pulse rounded-t-xl bg-white/5" />
          <div className="mt-3.5 h-2.5 w-16 animate-pulse rounded bg-white/5" />
          <div className="mt-2 h-4 w-28 max-w-full animate-pulse rounded bg-white/10" />
        </div>
      ))}
    </div>
  );
}
