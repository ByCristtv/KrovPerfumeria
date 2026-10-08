/**
 * Which URL prefixes are private, and how each one is kept out of search.
 *
 * Deliberately a dependency-free module: `next.config.ts` imports it to emit
 * `X-Robots-Tag` headers, and the config file can't resolve the `@/` alias or
 * pull in app code. `robots.ts`, the sitemap and the tests read the same lists,
 * so the three mechanisms below can never drift apart.
 *
 * Three layers, because none of them is sufficient alone:
 *
 *  1. `X-Robots-Tag: noindex` header (next.config.ts) — covers EVERY route under
 *     these prefixes, including route handlers and pages nobody remembered to
 *     annotate. This is the safety net.
 *  2. `<meta name="robots" content="noindex">` in each page's metadata — the
 *     signal most tools and humans inspect.
 *  3. `robots.txt` Disallow — saves crawl budget on paths with nothing to index.
 *
 * The catch: a crawler that is blocked by robots.txt never fetches the page, so
 * it never sees layers 1 and 2. A blocked URL that is linked from elsewhere can
 * still be listed (as a bare URL). That is why paths linked from the public
 * navigation are in NOINDEX_PATHS but NOT in DISALLOWED_PATHS: they must stay
 * crawlable so Google can read the `noindex` and drop them.
 */

/** Every prefix that must never be indexed (header + meta). */
export const NOINDEX_PATHS = [
  "/admin",
  "/api",
  "/auth",
  "/cart",
  "/checkout",
  "/friends",
  "/login",
  "/orders",
  "/profile",
  "/register",
  "/wholesale",
] as const;

/**
 * Linked from the public header/footer on every page, so a robots.txt block
 * would let them surface as URL-only results. They stay crawlable and rely on
 * `noindex` instead.
 */
const CRAWLABLE_NOINDEX_PATHS: readonly string[] = ["/cart", "/login", "/register"];

/** Prefixes robots.txt tells crawlers to skip. */
export const DISALLOWED_PATHS: readonly string[] = NOINDEX_PATHS.filter(
  (path) => !CRAWLABLE_NOINDEX_PATHS.includes(path)
);

/** True when `pathname` is inside one of the private prefixes. */
export function isPrivatePath(pathname: string): boolean {
  return NOINDEX_PATHS.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
