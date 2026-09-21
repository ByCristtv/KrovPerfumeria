import type { CSSProperties, ElementType, ReactNode } from "react";

/**
 * Skeleton primitives shared by every loading state in the app.
 *
 * Server-safe (no hooks, no "use client"), so `loading.tsx` files stay free of
 * any client JavaScript. The motion lives entirely in `globals.css`
 * (`.krov-skeleton`): the region pulses as ONE animation, so individual bones
 * are plain static boxes.
 */

/**
 * The animated wrapper. Hidden from assistive tech — pair it with
 * {@link LoadingAnnouncement} once per page so screen readers still hear that
 * something is loading.
 */
export function SkeletonRegion({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  return (
    <Tag aria-hidden className={`krov-skeleton ${className}`}>
      {children}
    </Tag>
  );
}

/**
 * A block placeholder. `strong` is for headings and names (the things the eye
 * lands on first); the default tone is for secondary text and controls.
 * Square-cornered by default, matching the brand's no-radius rule.
 */
export function Bone({
  className = "",
  strong = false,
  style,
}: {
  className?: string;
  strong?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      style={style}
      className={`block ${strong ? "bg-white/10" : "bg-white/[0.06]"} ${className}`}
    />
  );
}

/**
 * A single line of text, as a placeholder.
 *
 * The trick that keeps these skeletons CLS-free: pass the SAME typography
 * classes the real line uses (`text-lg leading-snug`, `text-[10px]`…). The
 * outer element then produces a line box of exactly the real height — the bone
 * inside is only the visible bar — so no line-height arithmetic can drift out
 * of sync with the component it stands in for.
 */
export function TextBone({
  className = "",
  width,
  strong = false,
  as: Tag = "span",
  style,
}: {
  /** The real line's typography classes, plus any margin/alignment. */
  className?: string;
  /** Bar width — a CSS length ("8rem", "60%"). */
  width: string;
  strong?: boolean;
  as?: ElementType;
  style?: CSSProperties;
}) {
  return (
    <Tag className={`block ${className}`} style={style}>
      <span
        className={`inline-block h-[0.72em] max-w-full align-middle ${
          strong ? "bg-white/10" : "bg-white/[0.06]"
        }`}
        style={{ width }}
      />
    </Tag>
  );
}

/** The one thing a screen reader should hear while a skeleton is on screen. */
export function LoadingAnnouncement({ label = "Cargando…" }: { label?: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}
