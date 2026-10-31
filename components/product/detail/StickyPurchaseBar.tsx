"use client";

import { useEffect, useState, type RefObject } from "react";
import { formatPrice } from "@/lib/format";
import type { AvailabilityStatus } from "@/lib/stock";

interface StickyPurchaseBarProps {
  productName: string;
  variantLabel: string;
  price: number;
  /**
   * What the selected variant is to a customer. Decides the single action the
   * bar offers: add to cart, inquire on WhatsApp, or — sold out — no bar at all.
   */
  status: AvailabilityStatus;
  onAdd: () => void;
  /** Prefilled WhatsApp link; used only when `status` is `made_to_order`. */
  inquiryUrl: string | null;
  /**
   * The page's own quantity + CTA block. The bar is shown exactly while that
   * block is off-screen, so the two are never visible together. Without it (or
   * without IntersectionObserver) the bar falls back to a scroll threshold.
   */
  watchRef?: RefObject<HTMLElement | null>;
}

const ACTION_CLASS =
  "inline-flex min-h-12 shrink-0 items-center bg-krov-blood px-6 text-[10px] uppercase tracking-[0.2em] text-krov-void transition-colors";

/**
 * Space the fixed chrome takes at the top (the header, 64–80px) and bottom (this
 * bar plus the safe area). A CTA hiding behind either is not visible to the
 * shopper, so it must count as off-screen.
 */
const OBSERVER_MARGIN = "-80px 0px -72px 0px";

/**
 * Mobile-only sticky purchase bar. It slides up once the page's own CTA has left
 * the screen, so the primary action is always one tap away without ever showing
 * two add buttons at once. Desktop keeps the main CTA visible in the sticky
 * column, so this is hidden ≥ md.
 *
 * It is a second face on the SAME action: `onAdd` is the page's add handler
 * (the one gate that enforces stock and made-to-order) and `inquiryUrl` is the
 * page's WhatsApp link — the bar owns no cart logic of its own. A sold-out size
 * has nothing to offer, so the bar is not rendered for it.
 *
 * Performance notes (this bar is on screen precisely while the user scrolls, so
 * it must be cheap):
 *  - No Framer Motion. The show/hide is a plain CSS `translateY` transition —
 *    transform only, so it stays on the compositor and never triggers layout.
 *  - No `backdrop-blur`. A blurred backdrop re-samples the content scrolling
 *    behind it every single frame, which is one of the worst offenders for
 *    scroll FPS on low-end Android. The bar is fully opaque instead.
 *  - Visibility comes from an IntersectionObserver, not a scroll listener.
 *  - Always mounted, moved off-screen when hidden — avoids mount/unmount churn.
 */
export default function StickyPurchaseBar({
  productName,
  variantLabel,
  price,
  status,
  onAdd,
  inquiryUrl,
  watchRef,
}: StickyPurchaseBarProps) {
  const [visible, setVisible] = useState(false);

  // Sold out: nothing to buy. Made to order with no link: nothing to do.
  const hasAction =
    status === "in_stock" || (status === "made_to_order" && !!inquiryUrl);

  useEffect(() => {
    const target = watchRef?.current;
    if (target && typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver(
        ([entry]) => setVisible(!entry.isIntersecting),
        { rootMargin: OBSERVER_MARGIN }
      );
      io.observe(target);
      return () => io.disconnect();
    }
    const onScroll = () => setVisible(window.scrollY > 560);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [watchRef]);

  const shown = visible && hasAction;

  // While the bar is on screen, slide the mobile cart bar out of its way via a
  // root class (decoupled — no shared React state). Scoped to the viewport
  // where the bar actually renders (matches the `md:hidden` below) so the cart
  // bar never moves on tablet where this bar is hidden.
  useEffect(() => {
    const root = document.documentElement;
    const onMobile = window.matchMedia("(max-width: 767px)").matches;
    root.classList.toggle("purchase-bar-open", shown && onMobile);
    return () => root.classList.remove("purchase-bar-open");
  }, [shown]);

  if (!hasAction) return null;

  return (
    <div
      aria-hidden={!shown}
      // `inert` keeps the off-screen bar out of the tab order and away from
      // assistive tech; a plain `aria-hidden` on focusable children is not enough.
      inert={!shown}
      className={`md:hidden fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-out motion-reduce:transition-none ${
        shown ? "translate-y-0" : "translate-y-[130%] pointer-events-none"
      }`}
    >
      {/* Squared and flush to the screen edges rather than a floating pill: at
          the foot of a phone this bar IS the base of the layout, and a pill
          hovering above the home indicator wastes the safest tap zone there is.
          The CTA is 48px tall so it clears the touch-target minimum, and the
          bottom padding grows by the device's safe-area inset (home indicator)
          so the CTA is never under it. */}
      <div className="flex items-center gap-3 border-t border-krov-smoke bg-krov-coal px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] uppercase tracking-[0.16em] text-krov-dust">
            {productName}
          </p>
          <p className="truncate text-sm leading-tight tabular-nums text-krov-bone">
            {formatPrice(price)}{" "}
            <span className="text-[10px] text-krov-dust">
              · {variantLabel}
              {status === "made_to_order" && " · Por encargo"}
            </span>
          </p>
        </div>

        {status === "made_to_order" ? (
          // A link, not the add button: it opens a WhatsApp inquiry and never
          // reaches the cart.
          <a
            href={inquiryUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={ACTION_CLASS}
          >
            Consultar
            <span className="sr-only"> disponibilidad por WhatsApp (abre una pestaña nueva)</span>
          </a>
        ) : (
          <button type="button" onClick={onAdd} className={ACTION_CLASS}>
            Agregar
          </button>
        )}
      </div>
    </div>
  );
}
