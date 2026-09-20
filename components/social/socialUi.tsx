"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The shared surface of the /friends portal.
 *
 * Three lists now render the same row — avatar, identity, action area: search
 * results, received requests and the friends list. MVP 1 had one, so the markup
 * lived inside UserSearchResults; it was lifted here the moment the second and
 * third appeared, which is the same move `components/account/profileUi.tsx`
 * made for the profile cards. Nothing about the classes changed in the move.
 *
 * Keeping the row here is what stops the three lists from slowly drifting into
 * three slightly different paddings and three slightly different buttons.
 */

/** The bordered, divided list every social section renders into. */
export function SocialList({ children }: { children: ReactNode }) {
  return (
    <ul className="divide-y divide-krov-smoke/70 border-y border-krov-smoke/70">
      {children}
    </ul>
  );
}

/**
 * One person in a list.
 *
 * `actions` is a slot rather than a prop set because the three lists offer
 * genuinely different controls (one button, two buttons, a chip) and modelling
 * that as flags would produce a component with five booleans and no shape.
 *
 * The layout stacks on the narrowest screens: two action buttons plus a
 * username do not fit on a 320px row, and letting them wrap under the name
 * beats truncating either one.
 */
export function SocialRow({
  avatar,
  children,
  actions,
  href,
  linkLabel,
}: {
  avatar: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  /** Makes the avatar + identity area a link. The actions stay outside it. */
  href?: string;
  /** Accessible name for that link; required whenever `href` is set. */
  linkLabel?: string;
}) {
  // The identity area and the actions are SIBLINGS, never nested. Wrapping the
  // whole row in a link and putting "Eliminar" inside it would nest a button in
  // an anchor — invalid HTML, and it makes every click ambiguous. This way the
  // navigable target is the avatar and name, the destructive button is its own
  // target, and neither can be hit by aiming at the other.
  const identity = (
    <>
      {avatar}
      {/* min-w-0 is what lets `truncate` work inside a flex row — without it the
          cell grows to fit the longest username and pushes the actions off a
          narrow screen. */}
      <div className="min-w-0 flex-1">{children}</div>
    </>
  );

  return (
    <li className="flex flex-wrap items-center gap-3 py-4 sm:gap-4 sm:py-5">
      {href ? (
        <Link
          href={href}
          aria-label={linkLabel}
          className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1 transition-colors duration-200 hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-krov-blood/60 sm:gap-4"
        >
          {identity}
        </Link>
      ) : (
        identity
      )}
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </li>
  );
}

/** The primary line of a row: the username. */
export function SocialRowTitle({ children }: { children: ReactNode }) {
  return (
    <p className="truncate text-sm text-krov-bone sm:text-base">{children}</p>
  );
}

/** The secondary line: rank, XP, "amigos desde…" — never private data. */
export function SocialRowMeta({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 truncate text-[11px] uppercase tracking-[0.18em] text-krov-dust">
      {children}
    </p>
  );
}

type ActionTone = "primary" | "ghost" | "danger";

const TONE_CLASSES: Record<ActionTone, string> = {
  primary:
    "border-krov-blood/60 text-krov-rose hover:bg-krov-blood hover:text-black",
  ghost: "border-krov-edge/60 text-krov-ash hover:border-krov-edge hover:text-krov-bone",
  danger: "border-krov-blood/40 text-krov-rose/90 hover:bg-krov-blood hover:text-black",
};

/**
 * A row action.
 *
 * `pending` both disables the button and swaps the label, so a slow network
 * cannot produce a second request from an impatient second click. That is the
 * courtesy layer — the real guarantee is server-side (`send_friend_request` is
 * idempotent for the same sender, and the partial unique index permits only one
 * pending row per pair regardless of direction).
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
      className={`shrink-0 border px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent sm:px-4 ${TONE_CLASSES[tone]}`}
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
      className={`shrink-0 border px-3 py-2 text-center text-[10px] uppercase tracking-[0.18em] sm:px-4 ${
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
 * Empty / idle / error panel, sized like the lists it replaces.
 *
 * `children` sits in a div rather than a <p> because the error and empty states
 * put a button in here.
 */
export function SocialStatePanel({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="border-y border-krov-smoke/70 px-6 py-14 text-center">
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
      className="mt-4 inline-block border border-krov-blood/50 px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
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
      className="mt-4 inline-block border border-krov-blood/50 px-5 py-2.5 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
    >
      {label}
    </Link>
  );
}

/** Row placeholders, sized to the real rows so a list does not jump on load. */
export function SocialListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      aria-hidden
      className="divide-y divide-krov-smoke/70 border-y border-krov-smoke/70"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-4 sm:gap-4 sm:py-5">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-white/5" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-32 max-w-full animate-pulse rounded bg-white/10" />
            <div className="mt-2 h-2.5 w-20 animate-pulse rounded bg-white/5" />
          </div>
          <div className="h-8 w-24 shrink-0 animate-pulse rounded bg-white/5" />
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
