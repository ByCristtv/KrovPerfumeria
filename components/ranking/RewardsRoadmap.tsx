"use client";

import { useState } from "react";
import { formatXp } from "@/lib/format";
import type { UserRank } from "@/lib/rank";
import {
  buildRewardsRoadmap,
  describeReward,
  summarizeReward,
  type RewardRoadmapStep,
  type RewardsRoadmapViewer,
  type RoadmapStepStatus,
} from "@/lib/rewards";

interface RewardsRoadmapProps {
  /**
   * The viewer's XP balance, or null when nobody is signed in. Null is a real
   * state, not an error: the ladder is a marketing artefact too, so a visitor
   * sees every tier and its reward — just none of them highlighted.
   */
  experiencePoints: number | null;
}

/**
 * The rewards progression timeline on /ranking.
 *
 * Presentation only. Every threshold, range and reward term comes from
 * `buildRewardsRoadmap` (lib/rewards.ts → lib/rank.ts), so this file contains no
 * XP number and no discount percentage — changing the ladder never means editing
 * a component.
 *
 * Layout is mobile-first and changes ORIENTATION rather than content: a vertical
 * stepper on a phone (where five tiers side by side would be unreadable) that
 * becomes a horizontal timeline from `md` up. The same list and the same nodes
 * serve both; only the connector and the flex direction flip, so there is one
 * DOM to reason about and nothing is rendered twice.
 *
 * The interaction is selection: tapping a tier opens its full terms in the panel
 * below the rail. It opens on the viewer's own rank, which is the tier they
 * actually care about, and falls back to the first tier that carries a reward
 * for a signed-out visitor.
 */
export default function RewardsRoadmap({
  experiencePoints,
}: RewardsRoadmapProps) {
  const { steps, viewer } = buildRewardsRoadmap(experiencePoints);

  const [selectedRank, setSelectedRank] = useState<UserRank>(() =>
    initialSelection(steps, viewer)
  );

  // Resolved during render rather than trusted blindly: if the ladder ever
  // changes under a stale selection, this falls back instead of rendering
  // nothing.
  const selected = steps.find((step) => step.rank === selectedRank) ?? steps[0];

  return (
    <section aria-labelledby="rewards-roadmap-heading" className="w-full">
      <header className="text-center">
        <p className="krov-eyebrow mb-4">Premios</p>
        <h2
          id="rewards-roadmap-heading"
          className="krov-display text-2xl text-krov-bone sm:text-3xl"
        >
          Ruta de recompensas
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-krov-ash">
          Cada rango desbloquea un beneficio que puedes reclamar en tu siguiente
          compra. La experiencia se gana con cada pedido recibido.
        </p>
      </header>

      {viewer && <ViewerProgress viewer={viewer} />}

      {/* ──────── The rail ──────── */}
      <ol className="mt-10 md:grid md:grid-cols-5 md:gap-2">
        {steps.map((step, index) => (
          <TimelineStep
            key={step.rank}
            step={step}
            isLast={index === steps.length - 1}
            selected={step.rank === selected.rank}
            onSelect={() => setSelectedRank(step.rank)}
          />
        ))}
      </ol>

      {/*
        ──────── Detail for the selected tier ────────

        The region is NAMED, not left bare: the roadmap itself is already
        exposed as a landmark, and two unlabelled regions nested inside one
        another are indistinguishable to anyone navigating by landmark.
      */}
      <div
        id="rewards-roadmap-detail"
        role="region"
        aria-label="Detalle de la recompensa"
        aria-live="polite"
        className="mt-8 border border-krov-smoke bg-krov-coal p-5 sm:p-6"
      >
        <p className="text-[10px] uppercase tracking-[0.24em] text-krov-dust tabular-nums">
          {rangeLabel(selected)} XP
        </p>
        <h3
          className="krov-display mt-2 text-xl text-krov-bone sm:text-2xl"
          data-testid="roadmap-detail-rank"
        >
          {selected.rank}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-krov-ash">
          {describeReward(selected.reward)}
        </p>
        {selected.status === "locked" && viewer && (
          <p className="mt-3 text-xs leading-relaxed text-krov-dust">
            Te faltan{" "}
            <strong className="text-krov-rose tabular-nums">
              {formatXp(selected.minXP - viewer.currentXP)} XP
            </strong>{" "}
            para llegar a {selected.rank}.
          </p>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * One node on the rail.
 *
 * The connector is drawn by this step and points at the NEXT one, which is why
 * the last step draws none — it keeps the line inside the list instead of
 * needing a container that knows how tall or wide the rail ended up.
 */
function TimelineStep({
  step,
  isLast,
  selected,
  onSelect,
}: {
  step: RewardRoadmapStep;
  isLast: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const tone = STATUS_TONE[step.status];

  return (
    <li className="relative flex gap-4 pb-7 last:pb-0 md:flex-col md:gap-0 md:pb-0">
      {!isLast && (
        <span
          aria-hidden
          className={`absolute left-[7px] top-5 h-[calc(100%-1.25rem)] w-px md:left-[calc(50%+8px)] md:top-[7px] md:h-px md:w-[calc(100%-16px)] ${tone.connector}`}
        />
      )}

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-controls="rewards-roadmap-detail"
        aria-current={step.status === "current" ? "step" : undefined}
        className={`group flex flex-1 items-start gap-4 text-left transition-opacity md:flex-col md:items-center md:gap-0 md:text-center ${
          selected ? "opacity-100" : "opacity-80 hover:opacity-100"
        }`}
      >
        {/* Node. A fixed 15px dot, so the connector can be pinned to its centre
            at both orientations with one offset instead of two magic numbers. */}
        <span
          aria-hidden
          className={`mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border transition-colors md:mt-0 ${
            tone.dot
          } ${
            selected
              ? "ring-2 ring-krov-blood/40 ring-offset-2 ring-offset-krov-void"
              : ""
          }`}
        >
          {step.status === "unlocked" && (
            <span className="h-1.5 w-1.5 rounded-full bg-krov-void" />
          )}
        </span>

        <span className="min-w-0 md:mt-4">
          <span className={`block text-sm font-medium tracking-wide ${tone.title}`}>
            {step.rank}
          </span>
          <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-krov-dust tabular-nums">
            {rangeLabel(step)} XP
          </span>
          <span className="mt-2 block text-xs leading-relaxed text-krov-ash">
            {summarizeReward(step.reward)}
          </span>
          {tone.badge && (
            <span
              className={`mt-2.5 inline-block px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] ${tone.badgeClass}`}
            >
              {tone.badge}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** Where the viewer stands, and what the next reward costs them. */
function ViewerProgress({ viewer }: { viewer: RewardsRoadmapViewer }) {
  const atTop = viewer.nextRank === null;

  return (
    <div
      data-testid="viewer-progress"
      className="mt-8 border border-krov-blood/30 bg-krov-blood/[0.06] p-5"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-krov-dust">
            Tu rango
          </p>
          <p className="krov-display mt-1 text-2xl text-krov-rose">
            {viewer.currentRank}
          </p>
        </div>
        <p className="text-sm text-krov-bone tabular-nums">
          {formatXp(viewer.currentXP)}{" "}
          <span className="text-[10px] uppercase tracking-[0.18em] text-krov-dust">
            XP
          </span>
        </p>
      </div>

      <div
        className="mt-4 h-1.5 w-full overflow-hidden bg-white/10"
        role="progressbar"
        aria-valuenow={viewer.progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={
          atTop ? "Rango máximo alcanzado" : `Progreso hacia ${viewer.nextRank}`
        }
      >
        <div
          className="h-full bg-gradient-to-r from-krov-blood/70 to-krov-blood transition-[width] duration-700 ease-out"
          style={{ width: `${viewer.progressPercent}%` }}
        />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-krov-ash">
        {atTop ? (
          <>
            Alcanzaste el rango máximo.{" "}
            {summarizeReward(viewer.currentReward)} te espera.
          </>
        ) : (
          <>
            Te faltan{" "}
            <strong className="text-krov-rose tabular-nums">
              {formatXp(viewer.xpRemaining)} XP
            </strong>{" "}
            para {viewer.nextRank}
            {viewer.nextReward && <> y {summarizeReward(viewer.nextReward)}</>}.
          </>
        )}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Visual vocabulary per status. One table, so no status gets styled ad hoc. */
const STATUS_TONE: Record<
  RoadmapStepStatus,
  {
    dot: string;
    connector: string;
    title: string;
    badge: string | null;
    badgeClass: string;
  }
> = {
  unlocked: {
    dot: "border-krov-rose bg-krov-rose",
    connector: "bg-krov-rose/50",
    title: "text-krov-bone",
    badge: "Desbloqueado",
    badgeClass: "border border-krov-rose/40 text-krov-rose",
  },
  current: {
    dot: "border-krov-blood bg-krov-blood",
    connector: "bg-krov-smoke",
    title: "text-krov-rose",
    badge: "Tu rango",
    badgeClass: "border border-krov-blood bg-krov-blood/15 text-krov-rose",
  },
  locked: {
    dot: "border-krov-smoke bg-krov-void",
    connector: "bg-krov-smoke",
    title: "text-krov-ash",
    badge: "Bloqueado",
    badgeClass: "border border-krov-smoke text-krov-dust",
  },
  unknown: {
    dot: "border-krov-edge bg-krov-void",
    connector: "bg-krov-smoke",
    title: "text-krov-bone",
    badge: null,
    badgeClass: "",
  },
};

/** "1,000 – 4,999", or "18,000+" for the open-ended top tier. */
function rangeLabel(step: RewardRoadmapStep): string {
  if (step.maxXP === null) return `${formatXp(step.minXP)}+`;
  return `${formatXp(step.minXP)} – ${formatXp(step.maxXP)}`;
}

/**
 * Which tier the panel opens on: the viewer's own rank, or — with no viewer —
 * the first tier that actually carries a reward, since opening on "Sin
 * recompensa" would be the least useful thing to show a prospective customer.
 */
function initialSelection(
  steps: RewardRoadmapStep[],
  viewer: RewardsRoadmapViewer | null
): UserRank {
  if (viewer) return viewer.currentRank;
  return steps.find((step) => step.reward.kind !== "none")?.rank ?? steps[0].rank;
}

/** Rail placeholder, sized to the real thing so /ranking doesn't jump on load. */
export function RewardsRoadmapSkeleton() {
  return (
    <div className="mt-10 md:grid md:grid-cols-5 md:gap-2" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 pb-7 last:pb-0 md:flex-col md:items-center md:pb-0"
        >
          <div className="mt-0.5 h-[15px] w-[15px] shrink-0 animate-pulse rounded-full bg-white/10 md:mt-0" />
          <div className="w-full md:mt-4">
            <div className="h-4 w-20 animate-pulse rounded bg-white/10 md:mx-auto" />
            <div className="mt-2 h-2.5 w-28 animate-pulse rounded bg-white/5 md:mx-auto" />
            <div className="mt-3 h-3 w-32 animate-pulse rounded bg-white/5 md:mx-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}
