import { formatXp } from "@/lib/format";
import { getRankInfo, RANK_THRESHOLDS } from "@/lib/rank";
import { RANKING_TOP_COUNT, type RankingEntry } from "@/types/ranking";

/**
 * The Top 10 board.
 *
 * A Server Component with no interactivity: the shimmer, halo and bar fill are
 * all CSS (see the "Leaderboard: metal frames" block in globals.css), so nothing
 * here ships a client bundle. Laid out mobile-first as a podium (1 centred and
 * raised, 2 left, 3 right) over a stack of steel cards for 4–10.
 *
 * Two ordered lists rather than one: the podium's visual order (2, 1, 3) is
 * produced with CSS `order`, so the DOM — and therefore a screen reader — still
 * reads 1, 2, 3. The second list continues the count with `start={4}`.
 *
 * Avatars are monograms: the ranking RPC deliberately exposes only a position,
 * a nickname and XP, so there is no photo to show without widening that
 * privacy boundary.
 */
export default function RankingBoard({ entries }: { entries: RankingEntry[] }) {
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  return (
    <div className="krov-frame krov-metal-rose rounded-lg p-2.5 [--frame-w:1px] [--shimmer-dur:14s] sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-linear-to-b from-krov-wine/25 via-krov-coal/60 to-krov-void/0"
      />

      <ol className="krov-enter-stagger relative flex items-end justify-center gap-2 pt-7 sm:gap-4">
        {podium.map((entry) => (
          <PodiumCard key={entry.position} entry={entry} />
        ))}
      </ol>

      {rest.length > 0 && (
        <ol
          start={4}
          className="krov-enter-stagger relative mt-5 space-y-2.5 sm:mt-7 sm:space-y-3"
        >
          {rest.map((entry) => (
            <StandingRow key={entry.position} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  );
}

/* ── Podium ──────────────────────────────────────────────────────────────── */

const PODIUM = {
  1: {
    metal: "krov-metal-gold",
    slot: "order-2 w-[37%] sm:max-w-[16rem]",
    avatar: "size-[4.5rem] text-3xl sm:size-24 sm:text-4xl",
    numeral: "text-6xl sm:text-7xl",
    name: "text-sm sm:text-base",
  },
  2: {
    metal: "krov-metal-silver",
    slot: "order-1 w-[31%] sm:max-w-[13rem]",
    avatar: "size-14 text-2xl sm:size-[4.5rem] sm:text-3xl",
    numeral: "text-4xl sm:text-5xl",
    name: "text-xs sm:text-sm",
  },
  3: {
    metal: "krov-metal-bronze",
    slot: "order-3 w-[31%] sm:max-w-[13rem]",
    avatar: "size-14 text-2xl sm:size-[4.5rem] sm:text-3xl",
    numeral: "text-4xl sm:text-5xl",
    name: "text-xs sm:text-sm",
  },
} as const;

function PodiumCard({ entry }: { entry: RankingEntry }) {
  const tier = PODIUM[entry.position as 1 | 2 | 3];
  const isFirst = entry.position === 1;

  return (
    <li className={`${tier.metal} ${tier.slot}`}>
      <div
        className={`krov-frame krov-metal-face rounded-md px-2 pb-3 text-center sm:px-3 sm:pb-4 ${
          isFirst ? "pt-9 sm:pt-11" : "pt-4 sm:pt-5"
        }`}
      >
        <span aria-hidden className="krov-halo" />
        <span aria-hidden className="krov-sheen" />

        {isFirst && (
          <Crown className="absolute left-1/2 top-2 h-6 w-9 -translate-x-1/2 text-(--m-mid) drop-shadow-[0_0_6px_rgb(var(--m-glow)/0.7)] sm:top-3 sm:h-7 sm:w-11" />
        )}
        <Movement delta={entry.movement} className="absolute right-1.5 top-1.5 z-10" />

        <div className="mx-auto w-fit">
          <Avatar name={entry.username} className={tier.avatar} />
        </div>

        <div className="mt-2 flex items-center justify-center gap-1.5">
          <span
            aria-hidden
            className={`krov-emboss font-display font-semibold leading-none ${tier.numeral}`}
          >
            {entry.position}
          </span>
          {isFirst && (
            <BottleIcon
              level={5}
              className="h-9 w-6 text-(--m-mid) drop-shadow-[0_0_5px_rgb(var(--m-glow)/0.6)] sm:h-12 sm:w-8"
            />
          )}
        </div>

        <p className={`mt-1.5 truncate font-medium text-krov-bone ${tier.name}`}>
          <span className="sr-only">{entry.position}. </span>
          {entry.username}
        </p>
        <RankTag rank={entry.rank} className="mt-1 justify-center" />

        <XpMeter xp={entry.experiencePoints} compact className="mt-2.5" />
      </div>
    </li>
  );
}

/* ── Positions 4–10 ──────────────────────────────────────────────────────── */

function StandingRow({ entry }: { entry: RankingEntry }) {
  return (
    <li className="krov-metal-steel">
      <div className="krov-frame krov-steel-face flex items-center gap-3 rounded-md px-3 py-3 [--shimmer-dur:12s] sm:gap-4 sm:px-4 sm:py-4">
        <div className="flex w-7 shrink-0 flex-col items-center gap-1 sm:w-9">
          <span
            aria-hidden
            className="krov-emboss font-display text-3xl font-semibold leading-none tabular-nums sm:text-4xl"
          >
            {entry.position}
          </span>
          <Movement delta={entry.movement} />
        </div>

        <Avatar name={entry.username} className="size-11 text-lg sm:size-12 sm:text-xl" />

        {/* min-w-0 lets `truncate` work inside a flex row; without it a long
            username pushes the XP text off a narrow screen. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-medium text-krov-bone sm:text-base">
              <span className="sr-only">{entry.position}. </span>
              {entry.username}
            </p>
            <RankTag rank={entry.rank} className="shrink-0" />
          </div>
          <XpMeter xp={entry.experiencePoints} className="mt-2" />
        </div>
      </div>
    </li>
  );
}

/* ── Shared pieces ───────────────────────────────────────────────────────── */

/** Monogram avatar in the surrounding metal. Reads `--m-*` from its ancestor. */
function Avatar({ name, className }: { name: string; className: string }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span aria-hidden className="krov-avatar-ring relative block shrink-0 w-fit">
      <span
        className={`flex items-center justify-center rounded-full bg-[radial-gradient(circle_at_30%_25%,var(--color-krov-wine),var(--color-krov-coal)_75%)] font-display font-semibold text-(--m-hi) ${className}`}
      >
        {initial}
      </span>
    </span>
  );
}

/** Rank name with its level bottle (1 of 5 — fuller bottle, higher rank). */
function RankTag({ rank, className = "" }: { rank: RankingEntry["rank"]; className?: string }) {
  const level = RANK_THRESHOLDS.findIndex((t) => t.rank === rank) + 1;
  return (
    <p
      className={`flex items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-krov-ash sm:text-[10px] sm:tracking-[0.2em] ${className}`}
    >
      <BottleIcon level={level} className="h-3.5 w-2.5 shrink-0 text-krov-rose sm:h-4 sm:w-3" />
      <span>{rank}</span>
      <span aria-hidden className="text-krov-dust">
        Nv.{level}
      </span>
    </p>
  );
}

/**
 * Segmented glowing bar showing progress to the next rank, with the exact
 * numbers beside it. The bar is decoration — the figures carry the meaning — so
 * it is hidden from assistive tech rather than announced as a second reading.
 */
function XpMeter({
  xp,
  compact = false,
  className = "",
}: {
  xp: number;
  compact?: boolean;
  className?: string;
}) {
  const info = getRankInfo(xp);
  const pct = info.progressPercent;

  return (
    <div className={className}>
      <div aria-hidden className="relative h-2 sm:h-2.5">
        {pct > 0 && (
          <div
            className="krov-xp-fill krov-bar-fill absolute inset-y-0 left-0 opacity-60 blur-[5px]"
            style={{ width: `${pct}%` }}
          />
        )}
        <div className="krov-xp-segments absolute inset-0 bg-krov-void/80">
          <div
            className="krov-xp-fill krov-bar-fill h-full"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {compact ? (
        <p className="mt-1.5 text-[10px] leading-tight tabular-nums text-krov-bone sm:text-xs">
          {formatXp(info.currentXP)} XP
          <span className="block truncate text-[9px] text-krov-dust sm:text-[10px]">
            {info.nextRankXP === null
              ? "Rango máximo"
              : `/ ${formatXp(info.nextRankXP)} · ${info.nextRank}`}
          </span>
        </p>
      ) : (
        <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-krov-bone sm:text-xs">
          <span>
            {formatXp(info.currentXP)} XP
            {info.nextRankXP !== null && (
              <span className="text-krov-dust"> / {formatXp(info.nextRankXP)}</span>
            )}
          </span>
          <span className="truncate text-[10px] text-krov-dust">
            {info.nextRank === null ? "Rango máximo" : `→ ${info.nextRank}`}
          </span>
        </p>
      )}
    </div>
  );
}

/** ▲ / ▼ / = since yesterday. Draws nothing when there is no comparison. */
function Movement({
  delta,
  className = "",
}: {
  delta: number | null | undefined;
  className?: string;
}) {
  if (typeof delta !== "number") return null;

  const [glyph, tone, label] =
    delta > 0
      ? ["▲", "text-emerald-400", `Subió ${delta} ${delta === 1 ? "puesto" : "puestos"}`]
      : delta < 0
        ? ["▼", "text-krov-rose", `Bajó ${-delta} ${delta === -1 ? "puesto" : "puestos"}`]
        : ["=", "text-krov-dust", "Sin cambios"];

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-medium tabular-nums sm:text-[10px] ${tone} ${className}`}
    >
      <span aria-hidden>
        {glyph}
        {delta !== 0 && Math.abs(delta)}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A three-pointed crown for first place. Colour comes from `currentColor`. */
function Crown({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 36 24" fill="none" aria-hidden className={className}>
      <path
        d="M3 20 1.5 6.5l9 7L18 2l7.5 11.5 9-7L33 20z"
        fill="currentColor"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3 20h30" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="1.5" cy="6" r="1.8" fill="currentColor" />
      <circle cx="18" cy="2.4" r="2" fill="currentColor" />
      <circle cx="34.5" cy="6" r="1.8" fill="currentColor" />
    </svg>
  );
}

/**
 * Perfume bottle, filled `level` fifths of the way up. Used for the rank level
 * (Fraiche 1 … Parfum 5) and, full and gold, beside the first-place numeral.
 * Everything is `currentColor`, so no gradient ids are needed — they would have
 * to be unique per instance across ten cards.
 */
function BottleIcon({ level, className }: { level: number; className: string }) {
  const clamped = Math.min(5, Math.max(0, level));
  const top = 28 - (17.5 * clamped) / 5;

  return (
    <svg viewBox="0 0 24 32" fill="none" aria-hidden className={className}>
      <rect x="8.5" y="0.75" width="7" height="4.5" rx="1.2" fill="currentColor" />
      <rect x="10.25" y="5.25" width="3.5" height="3" fill="currentColor" fillOpacity="0.55" />
      <path
        d="M7 8.5h10a2 2 0 0 1 2 2v17.5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V10.5a2 2 0 0 1 2-2Z"
        fill="currentColor"
        fillOpacity="0.1"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {clamped > 0 && (
        <path
          d={`M6.2 ${top}H17.8V27a1.8 1.8 0 0 1-1.8 1.8H8A1.8 1.8 0 0 1 6.2 27Z`}
          fill="currentColor"
          fillOpacity="0.85"
        />
      )}
      <path d="M8.6 11.5v13" stroke="#fff" strokeOpacity="0.4" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

/* ── States ──────────────────────────────────────────────────────────────── */

/** Nobody has opted in yet — a real, expected state on the day this ships. */
export function RankingEmptyState() {
  return (
    <div className="border-y border-krov-smoke/70 px-6 py-16 text-center">
      <p className="text-krov-bone text-sm">
        Todavía no hay nadie en el ranking.
      </p>
      <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-krov-dust">
        Sé la primera persona en aparecer: elige un nombre de usuario en tu
        perfil y activa «Aparecer en el ranking».
      </p>
    </div>
  );
}

/**
 * The leaderboard could not be read. Deliberately says nothing about why — the
 * Postgres error is logged in `getTopRanking` and stays there.
 */
export function RankingErrorState() {
  return (
    <div className="border-y border-krov-smoke/70 px-6 py-16 text-center">
      <p className="text-krov-bone text-sm">
        No pudimos cargar el ranking en este momento.
      </p>
      <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-krov-dust">
        Vuelve a intentarlo en unos minutos.
      </p>
    </div>
  );
}

/**
 * Placeholders sized to the real podium and rows so the board doesn't jump on
 * load. The region pulses as one animation (`krov-skeleton`); bones are static.
 */
export function RankingBoardSkeleton() {
  return (
    <div
      className="krov-skeleton rounded-lg border border-krov-smoke/70 p-2.5 sm:p-5"
      aria-hidden
    >
      <div className="flex items-end justify-center gap-2 pt-7 sm:gap-4">
        {[
          "order-1 h-44 w-[31%] sm:max-w-[13rem]",
          "order-2 h-56 w-[37%] sm:max-w-[16rem]",
          "order-3 h-44 w-[31%] sm:max-w-[13rem]",
        ].map((cls) => (
          <div key={cls} className={`rounded-md bg-white/[0.06] ${cls}`} />
        ))}
      </div>
      <div className="mt-5 space-y-2.5 sm:mt-7 sm:space-y-3">
        {Array.from({ length: Math.max(0, RANKING_TOP_COUNT - 3) }).map((_, i) => (
          <div key={i} className="h-[5.25rem] rounded-md bg-white/[0.05] sm:h-24" />
        ))}
      </div>
    </div>
  );
}
