"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import OffersCarousel from "@/components/home/OffersCarousel";
import type { FeaturedOffer } from "@/types/product";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

const images = [
  "/hero-image1.avif",
  "/hero-image2.avif",
  "/hero-image3.avif",
  "/hero-image4.avif",
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] as const },
  },
};

/**
 * The brand statement, not a promotional banner.
 *
 * KROV is кровь — blood — and the whole proposition is the chain that runs from
 * blood to DNA to identity: a fragrance is the part of you that enters a room
 * first. The hero has to land that idea before it sells anything, so it opens
 * with the claim and only then offers the catalogue.
 *
 * Nothing here draws blood literally. The reference lives in a single word set
 * in italic Didone, a red horizon low in the frame, and the deep wine wash over
 * the photography. The visitor is meant to work the meaning out, not be shown it.
 *
 * When products are on offer (fetched server-side, see `getFeaturedOffers`),
 * the hero becomes a two-part composition: the statement keeps the h1 and the
 * CTAs, and the offers carousel takes the right column on desktop — or sits
 * between the claim and the CTAs on phones, so a promotional price is on screen
 * without scrolling. The background photography then holds on its first frame:
 * two things rotating at once would compete, and the offers are what should
 * move. With no offers the hero renders exactly as it always has.
 */
export default function Hero({ offers = [] }: { offers?: FeaturedOffer[] }) {
  const hasOffers = offers.length > 0;
  const rotatePhotos = !hasOffers;

  const [current, setCurrent] = useState(0);
  // Slides 2–4 are not mounted until the page has finished loading. They sit at
  // opacity 0, but `next/image` still fetches any image inside the viewport —
  // so all four AVIFs (~2.3 MB of source) used to race the first one, which is
  // the LCP element. Deferring them leaves the whole connection to slide 1.
  const [slidesReady, setSlidesReady] = useState(false);

  useEffect(() => {
    // With offers on screen the photography is static — never mount the rest.
    if (!rotatePhotos) return;
    let timer: number | undefined;
    const arm = () => {
      timer = window.setTimeout(() => setSlidesReady(true), 1500);
    };

    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });

    return () => {
      window.removeEventListener("load", arm);
      window.clearTimeout(timer);
    };
  }, [rotatePhotos]);

  useEffect(() => {
    if (!slidesReady || !rotatePhotos) return;
    const interval = setInterval(
      () => setCurrent((prev) => (prev + 1) % images.length),
      6500
    );
    return () => clearInterval(interval);
  }, [slidesReady, rotatePhotos]);

  return (
    <section
      className={`relative flex w-full items-center overflow-hidden bg-krov-void ${
        hasOffers
          ? // Content-height on phones (claim + offer + CTAs must not be
            // squeezed into a fixed 100vh), a full frame from desktop up.
            "min-h-svh pb-12 pt-24 lg:min-h-screen lg:pb-16 lg:pt-28"
          : "h-screen min-h-160"
      }`}
    >
      {/* ── Photography ─────────────────────────────────────────────────────
          Held far back: desaturated, dimmed and pushed under a wine wash so it
          reads as atmosphere rather than as a product shot. The images carry
          mood; the type carries the message. */}
      <div className="absolute inset-0">
        {images.map((img, index) =>
          index > 0 && !slidesReady ? null : (
            <Image
              key={img}
              src={img}
              alt=""
              fill
              priority={index === 0}
              aria-hidden
              sizes="100vw"
              className={`absolute inset-0 object-cover transition-[opacity,transform] duration-[4000ms] ease-out ${
                index === current
                  ? "scale-105 opacity-100"
                  : "scale-100 opacity-0"
              }`}
              style={{ filter: "saturate(0.55) contrast(1.05) brightness(0.62)" }}
            />
          )
        )}

        {/* Wine wash — the colour of the brand laid over the light of the photo,
            not painted on top of it. `multiply` keeps the highlights alive
            where a flat overlay would grey them out. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-krov-wine/45 mix-blend-multiply"
        />
        {/* Legibility gradients: dark at both edges, open through the middle. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-krov-void via-krov-void/70 to-krov-void/20"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-krov-void via-transparent to-krov-void/80"
        />
      </div>

      {/* ── The two circles ─────────────────────────────────────────────────
          The mark is built from two overlapping circular forms. Rather than
          reprinting the symbol, the hero states the idea as light: two blooms
          that meet and become a single field. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-20 h-[34rem] w-[34rem] krov-aura opacity-25"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-56 left-40 h-[30rem] w-[30rem] krov-aura-wine opacity-60"
      />

      {/* ── Statement ───────────────────────────────────────────────────────
          Left-aligned on an editorial measure. Centred hero type is the single
          most template-looking decision available; an off-centre column with a
          hard left margin is what separates a house from a store.

          With offers it is a grid: one column on phones in reading order
          (claim → offer → CTAs); from `lg` the claim and CTAs share the left
          column and the carousel spans both rows on the right. */}
      <motion.div
        variants={{
          show: { transition: { staggerChildren: 0.13, delayChildren: 0.15 } },
        }}
        initial="hidden"
        animate="show"
        className={`relative z-10 mx-auto w-full max-w-7xl px-6 lg:px-10 ${
          hasOffers
            ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-x-14 xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] xl:gap-x-20"
            : ""
        }`}
      >
        <div className={hasOffers ? "max-w-2xl lg:col-start-1 lg:row-start-1 lg:self-end" : "max-w-2xl"}>
          {/* The etymology, stated once, quietly. This is the only place the
              Cyrillic appears — it rewards attention instead of demanding it. */}
          <motion.p
            variants={fadeUp}
            className="flex items-center gap-3 text-[10px] uppercase tracking-[0.42em] text-krov-rose"
          >
            <span className="h-px w-8 bg-krov-blood" aria-hidden />
            кровь · Perfumería
          </motion.p>

          <motion.h1
            variants={fadeUp}
            className={`text-[2.75rem] leading-[0.95] text-krov-bone sm:text-6xl ${
              hasOffers ? "mt-5 md:mt-7 lg:text-[4.5rem] xl:text-[5.25rem]" : "mt-7 md:text-[5.25rem]"
            }`}
            style={{ fontFamily: serif }}
          >
            Tu perfume
            <br />
            <span className="italic text-krov-blush">a un click</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className={`max-w-md text-[0.95rem] leading-relaxed text-krov-ash md:text-base ${
              hasOffers ? "mt-5 md:mt-8" : "mt-8"
            }`}
          >
            Encuentra perfumes originales, perfumes árabes y decants en Costa Rica, al mejor precio, y acumula puntos de experiencia.
          </motion.p>
        </div>

        {hasOffers && (
          <motion.div
            variants={fadeUp}
            className="mt-8 w-full max-w-xl lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:max-w-none lg:self-center"
          >
            <OffersCarousel offers={offers} />
          </motion.div>
        )}

        <motion.div
          variants={fadeUp}
          className={`flex flex-col items-stretch gap-3 sm:flex-row sm:items-center ${
            hasOffers ? "mt-8 lg:col-start-1 lg:row-start-2 lg:mt-11 lg:self-start" : "mt-11"
          }`}
        >
          {/* With offers, the carousel's "Ver oferta" is the one solid red
              button in the frame; the catalogue route steps down to outline so
              two red slabs don't compete a thumb's width apart on a phone. */}
          <Link
            href="/products"
            className={`group justify-center ${hasOffers ? "krov-btn-outline" : "krov-btn-primary"}`}
          >
            Ver la colección
            <ArrowRight
              size={14}
              aria-hidden
              className="transition-transform duration-500 group-hover:translate-x-1"
            />
          </Link>
          <Link
            href="/howtobuy"
            className={`justify-center ${hasOffers ? "krov-btn-ghost min-h-11" : "krov-btn-outline"}`}
          >
            Cómo comprar
          </Link>
        </motion.div>
      </motion.div>

      {/* ── Horizon ─────────────────────────────────────────────────────────
          A single red line at the foot of the frame. It is the hero's only
          saturated element and it doubles as the seam into the next section. */}
      <div
        aria-hidden
        className="krov-rule absolute inset-x-0 bottom-0 z-10 h-px"
      />
    </section>
  );
}
