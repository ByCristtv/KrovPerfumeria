"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { getRankFromXP } from "@/lib/rank";
import { formatXp } from "@/lib/format";
import { NEUTRAL_RING, RANK_STYLES } from "@/lib/social/rankStyle";
import RankBadge from "@/components/rank/RankBadge";

/**
 * The shared surface of the /friends portal.
 *
 * Friends, received requests and search results all render the same CARD —
 * avatar, identity stack, a top-right overflow slot and a footer of actions.
 * They were rows in a divided list; as cards they scan as people rather than as
 * table lines, and they flow into a grid on wide screens instead of stretching
 * a 600px list across 1100px.
 *
 * Keeping the card here is what stops the three lists from drifting into three
 * slightly different paddings and three slightly different buttons.
 */

/**
 * The card grid every social section renders into: one column on phones, two
 * from `md`, three from `xl`.
 *
 * Cards rise in with `krov-enter-stagger` when they mount (data arriving, a tab
 * switch, a new search result). The animation lands on each card (a direct
 * child), never on the grid, because the cards are backdrop-blur glass and a
 * fading ancestor would blank the blur until the fade ends. Cards already on
 * screen keep their key and are not re-animated by a refetch.
 */
export function SocialList({ children }: { children: ReactNode }) {
  return (
    <ul className="krov-enter-stagger grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3">
      {children}
    </ul>
  );
}

/**
 * One person.
 *
 * Slots, because the three lists genuinely offer different controls:
 *   · `avatar`   — the ring avatar (see {@link SocialRingAvatar})
 *   · children   — the identity stack (name, handle, rank pill, snippet)
 *   · `menu`     — top-right overflow, for secondary / destructive actions
 *   · `actions`  — the footer: the one or two things you came here to do
 *
 * `href` turns the WHOLE card into a tap target without nesting anything in an
 * anchor: the "Ver perfil" button is a real link whose pseudo-element is
 * stretched over the card, and the overflow menu sits above it (`z-10`). So a
 * thumb anywhere on the card opens the profile, the keyboard sees exactly one
 * link, a screen reader hears one named link, and the menu button stays its own
 * target — the same separation the old row kept between name and "Eliminar".
 */
export function SocialCard({
  avatar,
  children,
  actions,
  menu,
  href,
  linkLabel,
  linkText = "Ver perfil",
}: {
  avatar: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  menu?: ReactNode;
  href?: string;
  /** Accessible name for the link; required whenever `href` is set. */
  linkLabel?: string;
  linkText?: string;
}) {
  return (
    <li
      // `has-[…aria-expanded=true]:z-20` lifts a card above its neighbours
      // while its menu is open; each card is its own stacking context (the
      // entrance animation transforms it), so without this the popover would
      // paint UNDER the next card in the grid.
      className={`group relative flex flex-col gap-4 rounded-2xl border border-krov-smoke bg-krov-coal/70 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.3)] backdrop-blur-sm transition-[border-color,background-color] duration-300 has-[[aria-expanded=true]]:z-20 sm:p-5 ${
        href ? "hover:border-krov-blood/40 hover:bg-krov-graphite/70" : ""
      }`}
    >
      <div className="flex items-start gap-3.5">
        {avatar}
        {/* min-w-0 is what lets `truncate` work inside a flex row — without it
            the stack grows to fit the longest name and pushes the menu off a
            narrow screen. */}
        <div className="min-w-0 flex-1 pt-0.5">{children}</div>
        {menu && <div className="relative z-10 -mr-1.5 -mt-1.5 shrink-0">{menu}</div>}
      </div>

      {(href || actions) && (
        // `mt-auto` pins the footer to the card's bottom edge: grid cells in a
        // row stretch to the tallest card, and without it the buttons would
        // sit at different heights whenever one snippet wraps to two lines.
        <div className="mt-auto flex items-center gap-2">
          {href && (
            <Link
              href={href}
              aria-label={linkLabel}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-krov-blood/50 px-4 text-[10px] uppercase tracking-[0.18em] text-krov-rose transition-colors duration-300 after:absolute after:inset-0 after:rounded-2xl after:content-[''] group-hover:bg-krov-blood group-hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-krov-blood/70 sm:min-h-10"
            >
              {linkText}
              <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
            </Link>
          )}
          {actions}
        </div>
      )}
    </li>
  );
}

/**
 * The avatar inside a rank-coloured ring.
 *
 * Two nested 2px shells: the gradient, then a void-coloured gap, then the
 * picture. The gap is what makes the ring read as a ring rather than as a
 * thick image border. Pass `xp` to colour it by rank; omit it where the rank is
 * not known (search results) and it stays neutral.
 */
export function SocialRingAvatar({
  xp,
  children,
}: {
  xp?: number;
  children: ReactNode;
}) {
  const style = xp === undefined ? null : RANK_STYLES[getRankFromXP(xp)];

  return (
    <span
      className={`shrink-0 rounded-full p-[2px] ${style?.ring ?? NEUTRAL_RING} ${style?.glow ?? ""}`}
    >
      <span className="block rounded-full bg-krov-void p-[2px]">{children}</span>
    </span>
  );
}

/** The primary line of a card: the person's name. */
export function SocialRowTitle({ children }: { children: ReactNode }) {
  return (
    <p className="truncate text-[15px] font-semibold leading-tight text-krov-bone sm:text-base">
      {children}
    </p>
  );
}

/** `@username`, under the name. */
export function SocialHandle({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 truncate text-xs text-krov-dust">{children}</p>;
}

/**
 * Rank badge + name + XP as one compact semi-transparent pill. The rank comes from
 * `getRankFromXP`, the same ladder the leaderboard and the profile use — there
 * is no second ladder and nothing stored.
 */
export function SocialRankPill({ xp }: { xp: number }) {
  const rank = getRankFromXP(xp);

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-1 pr-2.5 text-[10px] uppercase tracking-[0.14em] ${RANK_STYLES[rank].pill}`}
    >
      <RankBadge rank={rank} size="xs" decorative />
      <span className="font-medium">{rank}</span>
      <span aria-hidden className="opacity-40">
        ·
      </span>
      <span className="tabular-nums">{formatXp(xp)} XP</span>
    </span>
  );
}

/** The one-line activity under the pill — "Compró recientemente…", "Amigos desde…". */
export function SocialSnippet({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-snug text-krov-ash">
      <span aria-hidden className="mt-px shrink-0 text-krov-rose/80">
        {icon}
      </span>
      {/* Two lines, then an ellipsis: "Decant 10ml · Aventus — Creed" is a real
          product name, and cutting it to one line hid the part that matters. */}
      <span className="line-clamp-2 min-w-0">{children}</span>
    </p>
  );
}

type ActionTone = "primary" | "solid" | "ghost" | "danger";

const TONE_CLASSES: Record<ActionTone, string> = {
  primary:
    "border-krov-blood/60 text-krov-rose hover:bg-krov-blood hover:text-black",
  // The affirmative action: filled, high contrast (black on #ff0b55 ≈ 5.4:1).
  solid:
    "border-krov-blood bg-krov-blood text-black hover:border-krov-crimson hover:bg-krov-crimson",
  ghost:
    "border-krov-edge/60 text-krov-ash hover:border-krov-edge hover:text-krov-bone",
  danger:
    "border-krov-blood/40 text-krov-rose/90 hover:bg-krov-blood hover:text-black",
};

/**
 * A card action.
 *
 * `pending` both disables the button and swaps the label, so a slow network
 * cannot produce a second request from an impatient second click. That is the
 * courtesy layer — the real guarantee is server-side (`send_friend_request` is
 * idempotent for the same sender, and the partial unique index permits only one
 * pending row per pair regardless of direction).
 *
 * `relative z-10` keeps it above a stretched card link, so a card that is
 * entirely a link still has buttons that are their own targets.
 */
export function SocialActionButton({
  label,
  pendingLabel,
  onClick,
  pending = false,
  disabled = false,
  tone = "primary",
  accessibleName,
}: {
  label: string;
  /** Shown while the mutation is in flight. Defaults to an ellipsis. */
  pendingLabel?: string;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  tone?: ActionTone;
  /** Names the person, so a list of identical labels stays distinguishable. */
  accessibleName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending || disabled}
      aria-busy={pending}
      aria-label={accessibleName}
      className={`relative z-10 inline-flex min-h-11 flex-1 items-center justify-center rounded-full border px-4 text-[10px] uppercase tracking-[0.18em] transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 ${TONE_CLASSES[tone]}`}
    >
      {pending ? (pendingLabel ?? "…") : label}
    </button>
  );
}

/** A non-interactive state chip — "Amigos", "Solicitud recibida". */
export function SocialStatusChip({
  label,
  accessiblePrefix,
  accent = false,
  title,
}: {
  label: string;
  /** Usually the username, so the chip is not a bare word in a list. */
  accessiblePrefix?: string;
  accent?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex min-h-11 flex-1 items-center justify-center rounded-full border px-4 text-center text-[10px] uppercase tracking-[0.18em] sm:min-h-10 ${
        accent
          ? "border-krov-blood/50 text-krov-rose"
          : "border-krov-smoke text-krov-ash"
      }`}
    >
      {accessiblePrefix && (
        <span className="sr-only">{`${accessiblePrefix}: `}</span>
      )}
      <span>{label}</span>
    </span>
  );
}

/**
 * Empty / idle / error panel, in the same glass as the cards it stands in for.
 *
 * `children` sits in a div rather than a <p> because the error and empty states
 * put a button in here.
 */
export function SocialStatePanel({
  title,
  icon,
  children,
}: {
  title: string;
  /** Optional decorative glyph above the title. */
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-krov-smoke bg-krov-coal/60 px-6 py-12 text-center backdrop-blur-sm">
      {icon && (
        <span
          aria-hidden
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-krov-blood/30 bg-krov-wine/30 text-krov-rose"
        >
          {icon}
        </span>
      )}
      <p className="text-sm text-krov-bone">{title}</p>
      {children && (
        <div className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-krov-dust">
          {children}
        </div>
      )}
    </div>
  );
}

/** The call-to-action inside an empty or error panel. */
export function SocialPanelAction({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-krov-blood/50 px-6 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
    >
      {label}
    </button>
  );
}

/**
 * The navigational twin of {@link SocialPanelAction} — same treatment, but it
 * goes somewhere instead of doing something. Used by the discovery gates,
 * which send the user to /profile rather than duplicating the privacy controls
 * that already live there.
 */
export function SocialPanelLink({
  label,
  href,
}: {
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full border border-krov-blood/50 px-6 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
    >
      {label}
    </Link>
  );
}

/**
 * Card placeholders, shaped like the real cards (ring avatar, name, handle,
 * pill, snippet, footer) so the grid does not jump on load. The region pulses
 * as one animation (`krov-skeleton`); the bones are static.
 */
export function SocialListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      className="krov-skeleton grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-4 rounded-2xl border border-krov-smoke bg-krov-coal/70 p-4 sm:p-5"
        >
          <div className="flex items-start gap-3.5">
            <div className="h-[60px] w-[60px] shrink-0 rounded-full bg-white/[0.06]" />
            <div className="min-w-0 flex-1 pt-1">
              <div className="h-4 w-32 max-w-full rounded bg-white/10" />
              <div className="mt-2 h-2.5 w-20 rounded bg-white/[0.06]" />
              <div className="mt-3 h-5 w-28 rounded-full bg-white/[0.06]" />
            </div>
          </div>
          <div className="h-11 w-full rounded-full bg-white/[0.06] sm:h-10" />
        </div>
      ))}
    </div>
  );
}

/** A section-level failure, with the retry the user actually needs. */
export function SocialErrorState({
  title = "No pudimos cargar esta sección",
  onRetry,
}: {
  title?: string;
  onRetry: () => void;
}) {
  return (
    <SocialStatePanel title={title}>
      <p>Vuelve a intentarlo en unos segundos.</p>
      <SocialPanelAction label="Reintentar" onClick={onRetry} />
    </SocialStatePanel>
  );
}
