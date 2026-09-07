/**
 * The primary navigation model.
 *
 * Lives apart from <Navbar> on purpose: the list of destinations and the
 * "is this the current page?" rule are plain data plus a pure function, with no
 * React, no hooks and no DOM. Keeping them here lets both the desktop bar and
 * the mobile drawer read from ONE source (they can never drift apart), and lets
 * the routing rules be tested without mounting a client component that needs
 * auth, cart and router context.
 *
 * There is deliberately NO "Inicio" entry. The wordmark in the header is the
 * home affordance — it is a link to "/" with an accessible name, which is the
 * convention every storefront user already knows, and duplicating it as a text
 * link spent a slot in a six-item bar on a destination the logo already covers.
 * `isHomeRoute` exists so the header can still mark the logo as the current
 * page for assistive tech, which is the part removing the text link would
 * otherwise have lost.
 */

export interface NavLink {
  /** Visible label, in Spanish — the storefront's only language. */
  label: string;
  href: string;
}

export const NAV_LINKS: readonly NavLink[] = [
  { label: "Perfumes", href: "/products" },
  { label: "Ranking y Premios", href: "/ranking" },
  { label: "Identidad", href: "/about" },
  { label: "Cómo comprar", href: "/howtobuy" },
  { label: "Contacto", href: "/contact" },
] as const;

/** Where the wordmark points, and the route it represents. */
export const HOME_HREF = "/";

/**
 * Whether a nav entry represents the page currently being viewed.
 *
 * Every entry also matches its subtree, so /products/<slug> still marks
 * "Perfumes" as current. Home is handled by {@link isHomeRoute} instead —
 * a prefix match on "/" would light up on every route.
 */
export function isCurrentRoute(pathname: string, href: string): boolean {
  if (href === HOME_HREF) return isHomeRoute(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Exact-match rule for the home route the wordmark links to. */
export function isHomeRoute(pathname: string): boolean {
  return pathname === HOME_HREF;
}
