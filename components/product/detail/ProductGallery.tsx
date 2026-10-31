"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";

export interface GalleryImage {
  url: string;
  position: number;
  alt_text: string | null;
}

interface ProductGalleryProps {
  images: GalleryImage[];
  productName: string;
}

const PLACEHOLDER = "/placeholder.png";

/**
 * Parent-product gallery: a main image plus a thumbnail strip, switched on
 * click. Images belong to the parent product — variant selection does NOT
 * change them.
 *
 * The plate stays LIGHT on the dark page, and that is the point. Product
 * photography is shot on white, so a dark frame would either show a white
 * rectangle or require every asset to be re-cut. Holding one lit surface inside
 * a black page also puts the bottle under gallery lighting, which is a better
 * result than the old white page ever produced — there the plate and the page
 * were the same colour and the object had no edge at all.
 *
 * The main image is deliberately NOT wrapped in any entrance animation. It
 * previously lived inside two nested Framer Motion nodes that started at
 * `opacity: 0`, so even though `next/image priority` preloaded the bytes early,
 * the pixels stayed invisible until React hydrated and ran the animation — on a
 * slow phone that is exactly the "hero loads noticeably after the rest of the
 * page" symptom. Now the server-rendered, prioritized image is visible on first
 * paint. The only motion left is the desktop hover-zoom, which is pure CSS.
 */
export default function ProductGallery({
  images,
  productName,
}: ProductGalleryProps) {
  const safeImages = useMemo<GalleryImage[]>(() => {
    const sorted = [...images].sort((a, b) => a.position - b.position);
    return sorted.length > 0
      ? sorted
      : [{ url: PLACEHOLDER, position: 0, alt_text: productName }];
  }, [images, productName]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [zoom, setZoom] = useState({ on: false, x: 50, y: 50 });
  const frameRef = useRef<HTMLDivElement>(null);

  const active = safeImages[activeIdx] ?? safeImages[0];

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoom({ on: true, x, y });
  };

  return (
    // Below `md` the plate has a bounded height (a clamp on the viewport's
    // height) instead of being a full-width square: a 390px-wide square is 358px
    // tall, which on a phone pushes the name, price, sizes and CTA below the
    // fold. The thumbnails move to a column beside the plate (`flex-row-reverse`
    // puts them on the left) so they cost no vertical space. From `md` up it is
    // the original block layout: square plate, thumbnail strip underneath.
    <div className="flex flex-row-reverse gap-2 md:block md:sticky md:top-28">
      <div className="relative min-w-0 flex-1">
        {/* The bloom behind the plate — the light the bottle is standing in. */}
        <div
          aria-hidden
          className="krov-aura absolute inset-0 -m-8 opacity-[0.22]"
        />

        <div
          ref={frameRef}
          onMouseMove={onMove}
          onMouseLeave={() => setZoom((z) => ({ ...z, on: false }))}
          className="group relative h-[clamp(13rem,31svh,16.25rem)] overflow-hidden bg-gradient-to-b from-krov-linen via-krov-linen to-krov-linen-deep md:aspect-square md:h-auto"
        >
          <Image
            key={active.url}
            src={active.url}
            alt={active.alt_text || productName}
            fill
            sizes="(max-width: 768px) 80vw, 50vw"
            priority
            className="object-contain p-4 transition-transform duration-500 ease-out md:p-10"
            style={{
              transform: zoom.on ? "scale(1.6)" : "scale(1)",
              transformOrigin: `${zoom.x}% ${zoom.y}%`,
            }}
          />

          {/* Registration marks at the corners — a printer's crop mark rather
              than a decorative flourish. They frame the object and reinforce
              that this is an editorial plate, not a UI card. */}
          <Corner className="left-3 top-3 md:left-5 md:top-5" />
          <Corner className="right-3 top-3 rotate-90 md:right-5 md:top-5" />
          <Corner className="bottom-3 right-3 rotate-180 md:bottom-5 md:right-5" />
          <Corner className="bottom-3 left-3 -rotate-90 md:bottom-5 md:left-5" />
        </div>
      </div>

      {/* Thumbnails — a vertical column beside the plate on phones (capped to
          the plate's height, scrolling if there are more than fit), the
          original horizontal strip below it from `md` up. */}
      {safeImages.length > 1 && (
        <div className="flex max-h-[clamp(13rem,31svh,16.25rem)] w-12 shrink-0 flex-col gap-2 overflow-y-auto [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden md:mt-4 md:max-h-none md:w-auto md:flex-row md:gap-3 md:overflow-x-auto md:overflow-y-visible md:pb-1">
          {safeImages.map((img, i) => {
            const isActive = i === activeIdx;
            return (
              <button
                key={img.url + i}
                type="button"
                onClick={() => setActiveIdx(i)}
                aria-label={`Ver imagen ${i + 1} de ${safeImages.length}`}
                aria-pressed={isActive}
                className={`relative h-12 w-12 shrink-0 overflow-hidden border bg-krov-linen transition-colors duration-300 md:h-20 md:w-20 ${
                  isActive
                    ? "border-krov-blood"
                    : "border-transparent opacity-60 hover:opacity-100"
                }`}
              >
                <Image
                  src={img.url}
                  alt={img.alt_text || `${productName} ${i + 1}`}
                  fill
                  sizes="80px"
                  className="object-contain p-2"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Corner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-4 w-4 border-l border-t border-krov-void/25 ${className}`}
    />
  );
}
