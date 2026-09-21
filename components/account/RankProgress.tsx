import { getRankInfo } from "@/lib/rank";
import { formatXp } from "@/lib/format";

interface RankProgressProps {
  experiencePoints: number;
}

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/**
 * Rank + XP for the account page: the current rank, the XP total, and one bar.
 *
 * Deliberately minimal. It does NOT name the next rank or count the XP left to
 * it; the page is a summary, and /ranking's rewards roadmap is where the ladder
 * is laid out. The bar still means something precise: progress through the
 * CURRENT rank (full at the top rank), all derived by {@link getRankInfo}, so
 * ranks are never stored, only computed from `experience_points`.
 *
 * No client JS: the fill animates with CSS `scaleX` (`.krov-bar-fill`), which
 * stays on the compositor. It previously animated `width` through Framer
 * Motion, a layout property recalculated on every frame.
 */
export default function RankProgress({ experiencePoints }: RankProgressProps) {
  const info = getRankInfo(experiencePoints);
  const percent = info.nextRank === null ? 100 : info.progressPercent;

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-white/45">Rango actual</p>
          <p
            className="mt-2 inline-flex items-center rounded-full border border-krov-blood/40 bg-krov-blood/[0.08] px-3.5 py-1 text-lg leading-snug text-krov-rose"
            style={{ fontFamily: serif }}
          >
            {info.currentRank}
          </p>
        </div>
        <p className="shrink-0 text-sm tabular-nums text-white">
          {formatXp(info.currentXP)}
          <span className="ml-1 text-[10px] uppercase tracking-[0.18em] text-white/45">
            XP
          </span>
        </p>
      </div>

      <div
        className="mt-5 h-2 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progreso en el rango ${info.currentRank}`}
      >
        <div
          className="krov-bar-fill h-full rounded-full bg-gradient-to-r from-krov-blood/70 to-krov-blood"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
