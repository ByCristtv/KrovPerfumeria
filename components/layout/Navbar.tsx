"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCartStore } from "@/store/useCartStore";
import { useAuthUser } from "@/hooks/useAuthUser";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useIsMounted } from "@/hooks/useIsMounted";
import KrovLogo from "@/components/brand/KrovLogo";
import {
  HOME_HREF,
  NAV_LINKS,
  isCurrentRoute,
  isHomeRoute,
} from "./navLinks";

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const pathname = usePathname();
  const mounted = useIsMounted();
  const isAdmin = useIsAdmin();
  const { isAuthenticated, isLoading: authLoading } = useAuthUser();
  const totalItems = useCartStore((state) =>
    state.cart.reduce((acc, item) => acc + item.quantity, 0)
  );

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close the mobile drawer on route-ish interactions and lock body scroll while open.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const cartBadge = mounted ? totalItems : 0;

  return (
    <>
      {/*
        No entrance animation, by design.

        The previous version initialised `isVisible=false` and flipped it inside
        requestAnimationFrame. rAF does not run while `document.visibilityState`
        is "hidden", so the primary navigation stayed at opacity:0 until the tab
        was focused. Re-implementing the same fade in CSS has the identical flaw —
        a hidden document freezes animation timelines at t=0.

        A fixed site header is the one element that must never wait on anything to
        become visible, and fading in the main nav costs perceived performance for
        no real gain. It simply renders.
      */}
      {/*
        The header is a single fixed bar pinned flush to the top of the viewport.

        A "utility bar" (rotating brand promises) used to sit ABOVE this nav and
        collapse on scroll via a max-height transition. Because it was a separate
        element the nav rode on top of, the collapse animation briefly left a gap
        above the nav through which page content flashed — the reported glitch.
        Removing it entirely leaves nothing that can open a gap: the nav is now
        the topmost element and is always attached to `top: 0`.
      */}
      <header className="fixed top-0 left-0 w-full z-50">
        {/* ──────── Main bar ──────── */}
        {/*
          At rest the bar is fully transparent so the hero image runs edge to
          edge behind the mark — the entrance to the store, not a toolbar over
          it. On scroll it condenses into an opaque plane. Only the backdrop and
          height change; the mark never moves horizontally.
        */}
        <nav
          className={`transition-[background-color,backdrop-filter] duration-500 ${
            scrolled
              ? "bg-krov-void/92 backdrop-blur-xl"
              : "bg-gradient-to-b from-krov-void/85 to-transparent"
          }`}
        >
          <div className="max-w-7xl mx-auto px-6 lg:px-10">
            {/*
              Three-column grid rather than flex-between: it lets the navigation
              sit optically centred under the wordmark regardless of how wide the
              right-hand actions get — the editorial layout luxury houses use,
              and the main thing that stops this reading as a stock template.
            */}
            <div
              className={`grid grid-cols-[auto_1fr_auto] items-center gap-6 transition-[height] duration-500 ${
                scrolled ? "h-16" : "h-20"
              }`}
            >
              {/* Wordmark — the official asset, never type. */}
              {/*
                The wordmark is now the ONLY route to the home page — the
                "Inicio" text entry was removed from NAV_LINKS. That makes its
                accessible name and its current-page state load-bearing rather
                than decorative, so both are declared explicitly here.
              */}
              <Link
                href={HOME_HREF}
                aria-label="KROV Perfumería — inicio"
                aria-current={isHomeRoute(pathname) ? "page" : undefined}
                className="shrink-0 opacity-95 transition-opacity duration-300 hover:opacity-100"
              >
                <KrovLogo
                  tone="light"
                  width={scrolled ? 118 : 132}
                  priority
                  className="transition-[width] duration-500"
                />
              </Link>

              {/* Centred navigation */}
              <ul className="hidden lg:flex items-center justify-center gap-9">
                {NAV_LINKS.map((link) => (
                  <li key={link.href}>
                    <NavLink
                      href={link.href}
                      label={link.label}
                      active={isCurrentRoute(pathname, link.href)}
                    />
                  </li>
                ))}
                {isAdmin && (
                  <li>
                    <NavLink
                      href="/admin"
                      label="Administrar"
                      accent
                      active={isCurrentRoute(pathname, "/admin")}
                    />
                  </li>
                )}
              </ul>

              {/* Actions */}
              <div className="hidden lg:flex items-center gap-6 shrink-0">
                <CartLink count={cartBadge} />
                <span className="h-4 w-px bg-krov-smoke" />
                <AuthActions
                  isAuthenticated={isAuthenticated}
                  isLoading={authLoading}
                />
              </div>

              {/* Mobile hamburger — 44px touch target around the 24px rule set. */}
              <button
                className="lg:hidden justify-self-end flex h-11 w-11 flex-col items-end justify-center gap-1.5"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
                aria-expanded={menuOpen}
              >
                <span
                  className={`block h-px bg-krov-bone transition-all duration-300 ${
                    menuOpen ? "w-6 rotate-45 translate-y-2" : "w-6"
                  }`}
                />
                <span
                  className={`block h-px bg-krov-bone transition-all duration-300 ${
                    menuOpen ? "w-6 opacity-0" : "w-4"
                  }`}
                />
                <span
                  className={`block h-px bg-krov-bone transition-all duration-300 ${
                    menuOpen ? "w-6 -rotate-45 -translate-y-2" : "w-6"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Hairline — only once the bar has a surface of its own to sit on. */}
          <div
            className={`krov-rule h-px w-full transition-opacity duration-500 ${
              scrolled ? "opacity-100" : "opacity-0"
            }`}
          />
        </nav>

        {/* ──────── Mobile drawer ──────── */}
        {/*
          max-h-160 (40rem), not the previous 128. The collapse animates a
          max-height, so the cap has to clear the drawer's real height or the
          last row is simply cut off — the links plus the admin row plus two
          auth buttons already exceeded 32rem. Kept at 40rem after "Inicio" was
          dropped: the cap only has to CLEAR the content, and leaving headroom
          means a future entry can be added without the last row vanishing.
        */}
        <div
          className={`lg:hidden overflow-hidden bg-krov-void transition-[max-height,opacity] duration-500 ease-in-out ${
            menuOpen ? "max-h-160 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="px-6 pt-4 pb-9">
            <ul className="flex flex-col">
              {NAV_LINKS.map((link, i) => {
                const active = isCurrentRoute(pathname, link.href);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`group flex items-center gap-4 border-b border-krov-smoke/70 py-4 transition-colors duration-200 hover:text-krov-bone ${
                        active ? "text-krov-bone" : "text-krov-ash"
                      }`}
                    >
                      {/* Editorial index numbering — the drawer reads as a
                          contents page rather than a list of buttons. On the
                          current route the numeral carries the accent, which is
                          the drawer's equivalent of the desktop underline. */}
                      <span
                        className={`w-6 text-[10px] tracking-[0.2em] transition-colors duration-200 group-hover:text-krov-rose ${
                          active ? "text-krov-rose" : "text-krov-dust"
                        }`}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-xs uppercase tracking-[0.24em]">
                        {link.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
              {isAdmin && (
                <li>
                  <Link
                    href="/admin"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-4 border-b border-krov-smoke/70 py-4 text-krov-rose"
                  >
                    <span className="w-6 text-[10px] tracking-[0.2em] text-krov-rose/60">
                      ··
                    </span>
                    <span className="text-xs uppercase tracking-[0.24em]">
                      Administrar
                    </span>
                  </Link>
                </li>
              )}
            </ul>

            <div className="mt-7 flex flex-col gap-3">
              {authLoading ? null : isAuthenticated ? (
                <MobileAction
                  href="/profile"
                  label="Mi perfil"
                  onClick={() => setMenuOpen(false)}
                  primary
                />
              ) : (
                <>
                  <MobileAction
                    href="/register"
                    label="Crear cuenta"
                    onClick={() => setMenuOpen(false)}
                    primary
                  />
                  <MobileAction
                    href="/login"
                    label="Iniciar sesión"
                    onClick={() => setMenuOpen(false)}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Floating mobile cart */}
      {mounted && (
        <Link
          href="/cart"
          aria-label={`Carrito, ${cartBadge} artículos`}
          className="floating-cart fixed bottom-6 right-6 z-50 lg:hidden flex h-14 w-14 items-center justify-center bg-krov-blood text-krov-void shadow-[0_10px_40px_-8px_rgba(255,11,85,0.55)] transition-transform active:scale-95"
        >
          <BagIcon className="h-5 w-5" />
          {cartBadge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center border border-krov-blood bg-krov-void px-1 text-[10px] font-medium text-krov-blush">
              {cartBadge}
            </span>
          )}
        </Link>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Guests get a clear two-step entry (sign in / register) instead of the old
 * ambiguous "MI CUENTA", which promised an account the visitor may not have.
 * Renders nothing until auth resolves — a flash of "Iniciar sesión" for a
 * signed-in user reads as being logged out, which is worse than a brief gap.
 */
function AuthActions({
  isAuthenticated,
  isLoading,
}: {
  isAuthenticated: boolean;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <span className="w-28 h-9" aria-hidden />;
  }

  if (isAuthenticated) {
    return (
      <Link
        href="/profile"
        className="border border-krov-edge px-5 py-2.5 text-[10px] uppercase tracking-[0.22em] text-krov-bone transition-colors duration-300 hover:border-krov-blood hover:text-krov-rose"
      >
        Mi perfil
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-5">
      <Link
        href="/login"
        className="krov-underline text-[10px] uppercase tracking-[0.22em] text-krov-ash transition-colors duration-300 hover:text-krov-bone"
      >
        Entrar
      </Link>
      <Link
        href="/register"
        className="border border-krov-edge px-5 py-2.5 text-[10px] uppercase tracking-[0.22em] text-krov-bone transition-colors duration-300 hover:border-krov-blood hover:text-krov-rose"
      >
        Crear cuenta
      </Link>
    </div>
  );
}

function NavLink({
  href,
  label,
  accent,
  active,
}: {
  href: string;
  label: string;
  accent?: boolean;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      // aria-current is the part that matters for assistive tech; the colour and
      // the drawn underline are its visual equivalent.
      aria-current={active ? "page" : undefined}
      className={`krov-underline py-1 text-[10px] uppercase tracking-[0.22em] transition-colors duration-300 ${
        active ? "krov-underline-active " : ""
      }${
        accent
          ? "text-krov-rose"
          : active
            ? "text-krov-bone"
            : "text-krov-ash hover:text-krov-bone"
      }`}
    >
      {label}
    </Link>
  );
}

function CartLink({ count }: { count: number }) {
  return (
    <Link
      href="/cart"
      aria-label={`Carrito, ${count} artículos`}
      className="relative text-krov-ash transition-colors duration-200 hover:text-krov-bone"
    >
      <BagIcon className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute -top-2 -right-2.5 flex h-4 min-w-4 items-center justify-center bg-krov-blood px-1 text-[9px] font-medium text-krov-void">
          {count}
        </span>
      )}
    </Link>
  );
}

function MobileAction({
  href,
  label,
  onClick,
  primary,
}: {
  href: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`w-full py-3.5 text-center text-[10px] uppercase tracking-[0.24em] transition-colors duration-300 ${
        primary
          ? "bg-krov-blood text-krov-void"
          : "border border-krov-edge text-krov-ash"
      }`}
    >
      {label}
    </Link>
  );
}

function BagIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0"
      />
    </svg>
  );
}
