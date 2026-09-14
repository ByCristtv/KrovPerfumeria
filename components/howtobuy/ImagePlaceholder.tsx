"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import StepBadge from "./StepBadge";

type ImagePlaceholderProps = {
  /** Optional screenshot. When omitted the elegant skeleton shows instead. */
  src?: string;
  alt: string;
  /** Step number rendered as an overlay badge on the visual. */
  number: number;
  /** Hide the numbered badge (e.g. on the closing success visual). */
  showBadge?: boolean;
  label?: string;
  priority?: boolean;
};

/**
 * 16:9 media slot for every step. Renders a real image when `src` is provided,
 * otherwise a refined dashed-border skeleton with a slow red shimmer — which is
 * the mobile journey's default state until captures are added.
 *
 * Two performance fixes live here:
 *
 *  1. The shimmer was a Framer `animate` with `repeat: Infinity`, i.e. a JS
 *     rAF loop per placeholder. With an all-empty mobile flow that meant ~12
 *     concurrent loops on the page. It is now a CSS `transform` animation, which
 *     runs on the compositor and gets throttled off-screen automatically.
 *  2. The card lift was `whileHover` with a spring — mounting a motion component
 *     and its listeners on every slot to serve an interaction that does not exist
 *     on touch. It is now a CSS `:hover` behind `@media (hover: hover)`, so phones
 *     pay nothing for it at all.
 */
export default function ImagePlaceholder({
  src = "/images/howtobuy/Result.png",
  alt,
  number,
  showBadge = true,
  label = "Ilustración / Captura de pantalla",
  priority = false,
}: ImagePlaceholderProps) {
  return (
    <div className="group/img hover-lift relative w-full">
      {/* Soft red glow that intensifies on hover */}
      <div className="pointer-events-none absolute -inset-1 rounded-[1.4rem] bg-krov-blood/0 blur-2xl transition-colors duration-700 group-hover/img:bg-krov-blood/10" />

      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-krov-smoke/85 bg-krov-ink shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] transition-colors duration-500 group-hover/img:border-krov-blood/40">
        {showBadge && (
          <div className="absolute left-4 top-4 z-20">
            <StepBadge number={number} />
          </div>
        )}

        {src ? (
          <Image
            src={src}
            alt={alt}
            fill
            priority={priority}
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover transition-transform duration-700 group-hover/img:scale-[1.04]"
          />
        ) : (
          <div
            role="img"
            aria-label={`${label}: ${alt}`}
            className="absolute inset-0"
          >
            {/* Dashed elegant frame */}
            <div className="absolute inset-3 rounded-xl border border-dashed border-krov-smoke" />

            {/* Slow shimmer sweep — CSS, compositor-only */}
            <div
              aria-hidden="true"
              className="shimmer-sweep absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-krov-blood/10 to-transparent"
            />

            {/* Centre label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-krov-blood/30 text-krov-rose/70 transition-colors duration-500 group-hover/img:text-krov-rose">
                <ImageOff size={20} strokeWidth={1.3} aria-hidden="true" />
              </span>
              <span
                className="text-xs uppercase tracking-[0.3em] text-white/45"
              >
                {label}
              </span>
            </div>
          </div>
        )}

        {/* Subtle inner vignette for depth */}
        <div className="pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_0_60px_-20px_rgba(0,0,0,0.8)]" />
      </div>
    </div>
  );
}
