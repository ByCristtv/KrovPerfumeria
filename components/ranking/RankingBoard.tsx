import { formatXp } from "@/lib/format";
import { RANKING_TOP_COUNT, type RankingEntry } from "@/types/ranking";

/**
 * The Top 10 board.
 *
 * A Server Component with no interactivity: the list is static content, so
 * shipping a client bundle (or a motion timeline) for it would buy nothing. The
 * rows' entrance is CSS only (`krov-enter-stagger`): they rise top-down as the
 * board replaces its skeleton, podium first. The only visual hierarchy is the
 * podium treatment on the first three rows, expressed with the palette the rest
 * of the storefront already uses.
 *
 * Rendered as an ordered list — the semantics of a leaderboard are literally
 * `<ol>`, and the position is carried by the markup rather than only by the
 * numeral drawn beside each row.
 */
export default function RankingBoard({ entries }: { entries: RankingEntry[] }) {
  return (
    <ol className="krov-enter-stagger divide-y divide-krov-smoke/70 border-y border-krov-smoke/70">
      {entries.map((entry) => (
        <RankingRow key={entry.position} entry={entry} />
      ))}
    </ol>
  );
}

function RankingRow({ entry }: { entry: RankingEntry }) {
  const isPodium = entry.position <= 3;

  return (
    <li
      className={`grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-1 py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-5 sm:px-2 sm:py-5 ${
        isPodium ? "bg-krov-blood/[0.04]" : ""
      }`}
    >
      {/* Position. `tabular-nums` keeps 1 and 10 the same width so the
          usernames beside them stay on a single optical column. */}
      <span
        aria-hidden
        className={`text-right font-light tabular-nums leading-none ${
          isPodium
            ? "text-krov-rose text-2xl sm:text-3xl"
            : "text-krov-dust text-lg sm:text-xl"
        }`}
        style={{
          fontFamily:
            "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif",
        }}
      >
        {entry.position}
      </span>

      {/* min-w-0 is what actually lets `truncate` work inside a grid track —
          without it the cell grows to fit the longest username and pushes the
          XP column off a narrow screen. */}
      <div className="min-w-0">
        <p
          className={`truncate ${
            isPodium ? "text-krov-bone text-base sm:text-lg" : "text-krov-bone text-sm sm:text-base"
          }`}
        >
          {/* The position is hidden from assistive tech above and restored here,
              so a screen reader announces "1. aurora.cr" as one label instead of
              reading a bare numeral. */}
          <span className="sr-only">{entry.position}. </span>
          {entry.username}
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-krov-dust">
          {entry.rank}
        </p>
      </div>

      <p
        className={`shrink-0 text-right tabular-nums ${
          isPodium ? "text-krov-bone text-sm sm:text-base" : "text-krov-ash text-xs sm:text-sm"
        }`}
      >
        {formatXp(entry.experiencePoints)}
        <span className="ml-1 text-[10px] uppercase tracking-[0.18em] text-krov-dust">
          XP
        </span>
      </p>
    </li>
  );
}

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
 * Row placeholders, sized to the real rows so the board doesn't jump on load.
 * The region pulses as one animation (`krov-skeleton`); the bones are static.
 */
export function RankingBoardSkeleton() {
  return (
    <div
      className="krov-skeleton divide-y divide-krov-smoke/70 border-y border-krov-smoke/70"
      aria-hidden
    >
      {Array.from({ length: RANKING_TOP_COUNT }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 px-1 py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-5 sm:px-2 sm:py-5"
        >
          <div className="ml-auto h-6 w-5 bg-white/[0.06]" />
          <div className="min-w-0">
            <div className="h-4 w-32 max-w-full bg-white/10" />
            <div className="mt-2 h-2.5 w-16 bg-white/[0.06]" />
          </div>
          <div className="h-4 w-16 bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}
