"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type PointerEvent,
} from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { FeaturedOffer, ProductTypes } from "@/types/product";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/** Time each offer stays on screen while rotating. */
export const OFFER_ROTATION_MS = 5500;
/** Horizontal travel (px) that counts as a swipe rather than a wobbly tap. */
const SWIPE_THRESHOLD = 40;

const TYPE_LABEL: Record<ProductTypes, string> = {
  full_size: "Botella",
  decant: "Decant",
  set: "Set",
};

// ── Browser signals as external stores ──────────────────────────────────────
// Read through `useSyncExternalStore` so the server snapshot is a fixed value
// (no hydration mismatch) and nothing has to setState inside an effect.

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const getPageHidden = () => document.visibilityState === "hidden";

const getFalse = () => false;

/**
 * ── The offers carousel ─────────────────────────────────────────────────────
 *
 * One promoted perfume at a time, set like a campaign plate: the bottle on the
 * same linen niche the catalogue uses (product photography is shot on white),
 * the saving stamped in red on its corner, and the promotional price as the
 * loudest thing in the type column.
 *
 * Rotation is a single `setTimeout` keyed on the active index, so every change
 * of slide — automatic, arrow, dot or swipe — re-arms a fresh timer and two can
 * never overlap. It runs only while ALL of these hold:
 *   · the visitor hasn't paused it (and hasn't asked for reduced motion — then
 *     it starts paused and only plays if they press play);
 *   · no mouse is hovering it and keyboard focus isn't inside it;
 *   · no finger is on it;
 *   · the tab is visible and the carousel is on screen.
 *
 * All slides share one grid cell, so the tallest sets the height and nothing
 * below shifts as they change. Images mount lazily: slide 1 eagerly, the next
 * one shortly after the page has loaded, the rest as they are reached — opacity
 * 0 does not stop `next/image` from fetching, so mounting is the only gate.
 */
export default function OffersCarousel({ offers }: { offers: FeaturedOffer[] }) {
  const count = offers.length;
  const multiple = count > 1;

  const [index, setIndex] = useState(0);
  // Slides whose image has been allowed to load. Updated where the index
  // changes (event/timer callbacks), never derived in an effect.
  const [mounted, setMounted] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [preloadNext, setPreloadNext] = useState(false);

  // `null` = the visitor hasn't chosen; the default then follows their motion
  // preference.
  const [userPlaying, setUserPlaying] = useState<boolean | null>(null);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [touching, setTouching] = useState(false);
  const [inView, setInView] = useState(true);

  const reduceMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotion, getFalse);
  const pageHidden = useSyncExternalStore(subscribeVisibility, getPageHidden, getFalse);

  const playing = userPlaying ?? !reduceMotion;
  const rotating =
    multiple && playing && !hovered && !keyboardFocus && !touching && !pageHidden && inView;

  const rootRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const goTo = useCallback(
    (next: number) => {
      const target = ((next % count) + count) % count;
      setIndex(target);
      setMounted((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
    },
    [count]
  );

  // ── Auto-advance ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => goTo(index + 1), OFFER_ROTATION_MS);
    return () => window.clearTimeout(timer);
  }, [rotating, index, goTo]);

  // ── Warm the next slide once the page itself has finished loading ────────
  useEffect(() => {
    if (!multiple) return;
    let timer: number | undefined;
    const arm = () => {
      timer = window.setTimeout(() => setPreloadNext(true), 1500);
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      window.removeEventListener("load", arm);
      window.clearTimeout(timer);
    };
  }, [multiple]);

  // ── Pause while scrolled out of view ─────────────────────────────────────
  useEffect(() => {
    const node = rootRef.current;
    if (!multiple || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.25 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [multiple]);

  // ── Interaction handlers ─────────────────────────────────────────────────
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    // Only KEYBOARD focus pauses. A mouse click also focuses a button, and
    // pausing on that would make the play button undo itself.
    if (e.target.matches(":focus-visible")) setKeyboardFocus(true);
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!multiple || e.pointerType === "mouse") return;
    touchStart.current = { x: e.clientX, y: e.clientY };
    setTouching(true);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    setTouching(false);
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Mostly-horizontal and long enough. Vertical drags never reach here: with
    // `touch-action: pan-y` the browser scrolls the page and fires
    // pointercancel instead.
    if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.2) {
      goTo(index + (dx < 0 ? 1 : -1));
    }
  };
  const onPointerCancel = () => {
    touchStart.current = null;
    setTouching(false);
  };

  if (count === 0) return null;

  const current = offers[index];
  const nextIndex = (index + 1) % count;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-roledescription={multiple ? "carrusel" : undefined}
      aria-labelledby="ofertas-destacadas"
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
      className="relative w-full"
    >
      {/* ── Header: what this is, and the pause control ─────────────────── */}
      <div className="mb-3 flex min-h-11 items-center justify-between gap-3">
        <h2 id="ofertas-destacadas" className="krov-eyebrow flex items-center gap-3">
          <span className="h-px w-6 bg-krov-blood" aria-hidden />
          Precios especiales
        </h2>
        {multiple && (
          <button
            type="button"
            onClick={() => setUserPlaying(!playing)}
            aria-label={playing ? "Pausar la rotación de ofertas" : "Reanudar la rotación de ofertas"}
            className="-mr-2 flex h-11 w-11 items-center justify-center text-krov-ash transition-colors duration-300 hover:text-krov-bone"
          >
            {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
          </button>
        )}
      </div>

      {/* ── Slides ──────────────────────────────────────────────────────── */}
      <div
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        // Vertical page scroll stays native; horizontal travel is ours.
        style={{ touchAction: "pan-y" }}
        className="relative grid grid-cols-1 overflow-hidden rounded-2xl border border-krov-smoke bg-krov-coal/80 shadow-[0_30px_80px_-40px_rgba(255,11,85,0.35)] backdrop-blur-sm"
      >
        {/* A low red bloom behind the plate — light, not decoration. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-16 -top-20 h-64 w-64 krov-aura-wine opacity-70"
        />

        {offers.map((offer, i) => {
          const active = i === index;
          const showImage = mounted.has(i) || (preloadNext && i === nextIndex);
          return (
            <article
              key={offer.variantId}
              role={multiple ? "group" : undefined}
              aria-roledescription={multiple ? "oferta" : undefined}
              aria-label={multiple ? `${i + 1} de ${count}: ${offer.name}` : undefined}
              aria-hidden={!active}
              inert={!active}
              // Plate | type side by side at every width, CTA as a full-width
              // row beneath both (on a phone a ~120px type column can't hold a
              // button; on desktop a stacked card overran a laptop viewport).
              className={`relative col-start-1 row-start-1 grid grid-cols-[minmax(0,42%)_minmax(0,1fr)] gap-x-4 gap-y-4 p-4 transition-[opacity,transform] duration-700 ease-krov motion-reduce:transition-none sm:grid-cols-[minmax(0,38%)_minmax(0,1fr)] sm:gap-x-6 sm:p-6 lg:grid-cols-[minmax(0,44%)_minmax(0,1fr)] ${
                active ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0"
              }`}
            >
              {/* The plate. Tappable (the obvious target on a phone) but out of
                  the tab order — the CTA below is the same destination. */}
              <Link
                href={offer.href}
                tabIndex={-1}
                className="relative block aspect-4/5 w-full overflow-hidden rounded-xl bg-linear-to-b from-krov-linen to-krov-linen-deep"
              >
                {showImage && (
                  <Image
                    src={offer.imageUrl}
                    alt={offer.imageAlt}
                    fill
                    loading={i === 0 ? "eager" : "lazy"}
                    sizes="(max-width: 640px) 42vw, (max-width: 1024px) 38vw, 16rem"
                    className="object-contain p-4 sm:p-6"
                  />
                )}
                {offer.discountPercent !== null && (
                  <span className="absolute left-0 top-0 bg-krov-blood px-2.5 py-1.5 text-[11px] font-medium tracking-[0.08em] text-krov-void">
                    −{offer.discountPercent}%
                  </span>
                )}
              </Link>

              {/* The type */}
              <div className="flex min-w-0 flex-col">
                <p className="text-[9px] uppercase tracking-[0.2em] text-krov-rose sm:tracking-[0.3em]">
                  Oferta especial
                </p>
                {offer.brand && (
                  <p className="mt-2.5 truncate text-[10px] uppercase tracking-[0.24em] text-krov-ash">
                    {offer.brand}
                  </p>
                )}
                <h3
                  className="mt-1 line-clamp-2 text-xl leading-tight text-krov-bone sm:text-2xl xl:text-[1.75rem]"
                  style={{ fontFamily: serif }}
                  title={offer.name}
                >
                  {offer.name}
                </h3>
                <p className="mt-1 text-[11px] tracking-[0.06em] text-krov-dust">
                  {TYPE_LABEL[offer.productType]} · {offer.sizeMl} ml
                </p>

                {offer.description && (
                  <p className="mt-3 hidden text-sm leading-relaxed text-krov-ash sm:line-clamp-2">
                    {offer.description}
                  </p>
                )}

                <div className="mt-auto pt-3">
                  <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                    <span className="sr-only">Precio de oferta:</span>
                    <span className="text-2xl font-medium tracking-tight text-krov-bone sm:text-[1.75rem]">
                      {formatPrice(offer.offerPrice)}
                    </span>
                    <span className="sr-only">, precio regular:</span>
                    <span className="text-xs text-krov-dust line-through">
                      {formatPrice(offer.price)}
                    </span>
                  </p>
                </div>
              </div>

              <Link
                href={offer.href}
                aria-label={`Ver oferta: ${offer.name}`}
                className="krov-btn-primary group col-span-2 min-h-11 w-full justify-center px-4 py-3"
              >
                Ver oferta
                <ArrowRight
                  size={14}
                  aria-hidden
                  className="transition-transform duration-500 group-hover:translate-x-1"
                />
              </Link>
            </article>
          );
        })}
      </div>

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      {/* Grouped to the left below `lg`: the floating cart button is fixed to
          the bottom-right corner on phones and would sit over a right-hand
          "next" arrow. */}
      {multiple && (
        <div className="mt-2 flex items-center justify-start lg:justify-between">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            aria-label="Oferta anterior"
            className="-ml-2 flex h-11 w-11 items-center justify-center text-krov-ash transition-colors duration-300 hover:text-krov-bone"
          >
            <ChevronLeft size={18} aria-hidden />
          </button>

          <div className="flex items-center">
            {offers.map((offer, i) => (
              <button
                key={offer.variantId}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Ver oferta ${i + 1} de ${count}: ${offer.name}`}
                aria-current={i === index ? "true" : undefined}
                className="group flex h-11 w-7 items-center justify-center"
              >
                <span
                  aria-hidden
                  className={`block h-0.5 transition-all duration-500 ease-krov motion-reduce:transition-none ${
                    i === index
                      ? "w-5 bg-krov-blood"
                      : "w-2.5 bg-krov-edge group-hover:bg-krov-ash"
                  }`}
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => goTo(index + 1)}
            aria-label="Oferta siguiente"
            className="-mr-2 flex h-11 w-11 items-center justify-center text-krov-ash transition-colors duration-300 hover:text-krov-bone"
          >
            <ChevronRight size={18} aria-hidden />
          </button>
        </div>
      )}

      {/* Screen-reader-only position. Announced only when the visitor changed
          the slide (or paused) — a polite announcement every 5.5s while it
          rotates would talk over everything else on the page. */}
      <p className="sr-only" aria-live={rotating ? "off" : "polite"} aria-atomic="true">
        {multiple ? `Oferta ${index + 1} de ${count}: ${current.name}` : current.name}
      </p>
    </div>
  );
}
