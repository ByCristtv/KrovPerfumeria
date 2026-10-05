"use client";

import Image from "next/image";
import { useState } from "react";
import { getRankIconUrl, type UserRank } from "@/lib/rank";

export type RankBadgeSize = "xs" | "sm" | "md" | "lg" | "xl";

/** Rendered box in CSS px. Fixed width AND height, so a badge never shifts layout. */
const SIZE_PX: Record<RankBadgeSize, number> = {
  xs: 20,
  sm: 28,
  md: 40,
  lg: 64,
  xl: 96,
};

interface RankBadgeProps {
  rank: UserRank;
  size?: RankBadgeSize;
  className?: string;
  /**
   * Set when the rank name is ALREADY printed beside the badge, so a screen
   * reader doesn't hear it twice. Otherwise the badge is labelled with the rank.
   */
  decorative?: boolean;
  /** Load immediately — for above-the-fold badges (e.g. the profile header). */
  eager?: boolean;
}

/**
 * A rank's official badge, served from Supabase Storage (`rank-icons/icons`).
 *
 * The URL and the file per tier live in lib/rank.ts — nothing here knows a
 * rank name. If the image cannot be built (no env) or fails to load (bucket
 * missing on the project the app points at), it degrades to a monogram in the
 * same box rather than a broken-image glyph.
 */
export default function RankBadge({
  rank,
  size = "md",
  className = "",
  decorative = false,
  eager = false,
}: RankBadgeProps) {
  const px = SIZE_PX[size];
  const src = getRankIconUrl(rank);
  // Keyed on the src so a rank change (e.g. after a refetch) retries the image.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const label = `Rango ${rank}`;

  if (!src || failedSrc === src) {
    return (
      <span
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative || undefined}
        title={rank}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-krov-blood/40 bg-krov-wine/40 font-display text-krov-rose ${className}`}
        style={{ width: px, height: px, fontSize: Math.round(px * 0.42) }}
      >
        {rank.charAt(0)}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={decorative ? "" : label}
      title={rank}
      width={px}
      height={px}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailedSrc(src)}
      className={`inline-block shrink-0 object-contain ${className}`}
      style={{ width: px, height: px }}
    />
  );
}
