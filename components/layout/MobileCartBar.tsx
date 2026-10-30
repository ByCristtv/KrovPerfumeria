"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import BagIcon from "./BagIcon";

/**
 * Routes where a cart shortcut would only get in the way: the cart and checkout
 * themselves, the auth screens, and the admin panel. The same transactional
 * routes the footer already steps aside for (see FooterGate), plus /register.
 */
const HIDDEN_PREFIXES = ["/cart", "/checkout", "/login", "/register", "/auth", "/admin"];

export function isCartBarRoute(pathname: string | null | undefined): boolean {
  const path = pathname ?? "/";
  return !HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The mobile cart, as a slim bar pinned to the bottom edge instead of a button
 * floating over the catalog.
 *
 * The floating square sat over the right-hand column of the product grid, so it
 * covered card names and prices while the customer scrolled. A bar occupies a
 * strip of its own, and while it is shown the page reserves exactly that strip
 * (`html.has-cart-bar` pads the body — see globals.css), so the last row, the
 * pagination and the footer can always be scrolled clear of it.
 *
 *  · Only while the cart has items, and only on routes where browsing happens.
 *  · Honors the device's bottom safe-area inset (home indicator) when the page
 *    is laid out under it; a no-op otherwise. That padding lives on `.cart-bar`
 *    in globals.css, next to the rule that reserves the strip.
 *  · Below `lg` only — from `lg` up the header carries the cart link.
 *  · The product page's StickyPurchaseBar occupies the same edge. It already
 *    toggles `.purchase-bar-open` on <html> while visible; the bar slides out of
 *    its way with CSS alone, so the two components share no React state.
 */
export default function MobileCartBar({ count }: { count: number }) {
  const pathname = usePathname();
  const visible = count > 0 && isCartBarRoute(pathname);

  // Tell the stylesheet to reserve the bar's strip while it exists.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("has-cart-bar", visible);
    return () => root.classList.remove("has-cart-bar");
  }, [visible]);

  if (!visible) return null;

  const noun = count === 1 ? "artículo" : "artículos";

  return (
    <Link
      href="/cart"
      aria-label={`Ver carrito, ${count} ${noun}`}
      className="cart-bar fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-4 bg-krov-blood px-5 pt-3.5 text-krov-void shadow-[0_-12px_32px_-14px_rgba(255,11,85,0.6)] active:brightness-95 lg:hidden"
    >
      <span className="flex items-center gap-3">
        <BagIcon className="h-5 w-5" />
        <span className="text-[11px] font-medium uppercase tracking-[0.24em]">
          Ver carrito
        </span>
      </span>
      <span className="text-[11px] font-medium uppercase tracking-[0.18em] tabular-nums">
        {count} {noun}
      </span>
    </Link>
  );
}
