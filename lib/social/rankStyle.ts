import type { UserRank } from "@/lib/rank";

/**
 * How a rank looks in the social UI — a ring around the avatar and a pill.
 *
 * Only the TOP of the ladder earns gold. Gold is the scarce colour on purpose:
 * if every tier glowed, none would read as an achievement. The lower tiers move
 * through neutral → wine → rose, which stays inside the brand palette; Alquimista
 * and Maestro switch to the metal the leaderboard already uses for its podium
 * (`.krov-metal-gold` in globals.css: #fff1b8 / #e0b24a / #7a5412), so a friend
 * who is gold here is gold on /ranking too.
 *
 * Class strings are written out in full (never assembled from fragments) so
 * Tailwind's scanner can see every one of them.
 */
export interface RankStyle {
  /** Gradient painted on the 2px ring wrapper around the avatar. */
  ring: string;
  /** Extra glow on the ring, for the highest tier only. */
  glow: string;
  /** Semi-transparent pill: border, fill and text colour. */
  pill: string;
}

export const RANK_STYLES: Record<UserRank, RankStyle> = {
  Aficionado: {
    ring: "bg-white/15",
    glow: "",
    pill: "border-white/15 bg-white/[0.05] text-krov-ash",
  },
  Coleccionista: {
    ring: "bg-gradient-to-br from-krov-wine via-krov-blood/50 to-krov-wine",
    glow: "",
    pill: "border-krov-blood/25 bg-krov-wine/40 text-krov-rose",
  },
  Conocedor: {
    ring: "bg-gradient-to-br from-krov-blood via-krov-rose/70 to-krov-wine",
    glow: "",
    pill: "border-krov-blood/40 bg-krov-blood/10 text-krov-rose",
  },
  Alquimista: {
    ring: "bg-gradient-to-br from-[#fff1b8] via-[#e0b24a] to-[#7a5412]",
    glow: "",
    pill: "border-[#e0b24a]/35 bg-[#e0b24a]/10 text-[#f0cf7f]",
  },
  Maestro: {
    ring: "bg-gradient-to-br from-[#fff1b8] via-[#e0b24a] to-[#7a5412]",
    glow: "shadow-[0_0_18px_-2px_rgba(224,178,74,0.55)]",
    pill: "border-[#e0b24a]/50 bg-[#e0b24a]/15 text-[#ffe08a]",
  },
};

/** For people whose rank is not known (search results carry no XP). */
export const NEUTRAL_RING = RANK_STYLES.Aficionado.ring;
