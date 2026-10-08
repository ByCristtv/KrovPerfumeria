import { describe, expect, it, vi } from "vitest";
import { NOINDEX_PATHS, isPrivatePath } from "./privatePaths";
import { buildSitemapEntries, type SitemapProduct } from "./sitemap";
import { PRODUCTION_URL } from "./site";

// At file level on purpose: `describe` bodies run at collection time, before any
// beforeEach, and they build the entries below. Vitest isolates env per file.
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

const products: SitemapProduct[] = [
  { slug: "lion", updatedAt: "2026-10-05T06:21:45.277Z", imageUrl: "https://cdn.example/lion.webp" },
  { slug: "yara", updatedAt: "2026-10-07T10:00:00.000Z", imageUrl: null },
  { slug: "broken-date", updatedAt: "not-a-date" },
];

const urls = (entries: ReturnType<typeof buildSitemapEntries>) =>
  entries.map((e) => e.url);

describe("buildSitemapEntries", () => {
  const entries = buildSitemapEntries({
    products,
    landingPaths: ["/perfumes-arabes", "/decants"],
  });

  it("uses the production origin for every URL", () => {
    for (const url of urls(entries)) expect(url.startsWith(`${PRODUCTION_URL}/`)).toBe(true);
  });

  it("includes home, catalog, landings, public pages and every product", () => {
    expect(urls(entries)).toEqual(
      [
        "/",
        "/products",
        "/perfumes-arabes",
        "/decants",
        "/ranking",
        "/howtobuy",
        "/legal/privacidad",
        "/legal/terminos",
        "/products/lion",
        "/products/yara",
        "/products/broken-date",
      ].map((p) => `${PRODUCTION_URL}${p}`)
    );
  });

  it("lists no duplicate URL", () => {
    expect(new Set(urls(entries)).size).toBe(entries.length);
  });

  it("never lists a private area", () => {
    for (const url of urls(entries)) {
      expect(isPrivatePath(new URL(url).pathname)).toBe(false);
    }
    // Spot-check the prefixes the brief calls out by name.
    for (const prefix of ["/admin", "/login", "/register", "/cart", "/checkout", "/profile", "/api"]) {
      expect(NOINDEX_PATHS).toContain(prefix);
      expect(urls(entries).some((u) => new URL(u).pathname.startsWith(prefix))).toBe(false);
    }
  });

  it("carries only query-free URLs", () => {
    for (const url of urls(entries)) expect(url).not.toContain("?");
  });

  it("dates the catalog pages by the newest product change, not by 'now'", () => {
    const byUrl = Object.fromEntries(entries.map((e) => [e.url, e.lastModified]));
    const newest = new Date("2026-10-07T10:00:00.000Z");
    expect(byUrl[`${PRODUCTION_URL}/`]).toEqual(newest);
    expect(byUrl[`${PRODUCTION_URL}/products`]).toEqual(newest);
    expect(byUrl[`${PRODUCTION_URL}/perfumes-arabes`]).toEqual(newest);
    expect(byUrl[`${PRODUCTION_URL}/products/lion`]).toEqual(new Date("2026-10-05T06:21:45.277Z"));
  });

  it("omits lastModified where it isn't known rather than inventing it", () => {
    const byUrl = Object.fromEntries(entries.map((e) => [e.url, e]));
    expect(byUrl[`${PRODUCTION_URL}/howtobuy`].lastModified).toBeUndefined();
    expect(byUrl[`${PRODUCTION_URL}/legal/terminos`].lastModified).toBeUndefined();
    expect(byUrl[`${PRODUCTION_URL}/products/broken-date`].lastModified).toBeUndefined();
  });

  it("adds an image entry only for products that have one", () => {
    const byUrl = Object.fromEntries(entries.map((e) => [e.url, e]));
    expect(byUrl[`${PRODUCTION_URL}/products/lion`].images).toEqual(["https://cdn.example/lion.webp"]);
    expect(byUrl[`${PRODUCTION_URL}/products/yara`]).not.toHaveProperty("images");
  });

  it("degrades to the static routes when there are no products", () => {
    const empty = buildSitemapEntries({ products: [], landingPaths: [] });
    expect(urls(empty)).toEqual(
      ["/", "/products", "/ranking", "/howtobuy", "/legal/privacidad", "/legal/terminos"].map(
        (p) => `${PRODUCTION_URL}${p}`
      )
    );
    expect(empty[0].lastModified).toBeUndefined();
  });

  it("omits landings that list nothing", () => {
    const partial = buildSitemapEntries({ products, landingPaths: ["/perfumes-arabes"] });
    expect(urls(partial)).not.toContain(`${PRODUCTION_URL}/decants`);
  });
});
