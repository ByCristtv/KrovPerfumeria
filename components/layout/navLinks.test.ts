import { describe, expect, it } from "vitest";
import {
  HOME_HREF,
  NAV_LINKS,
  isCurrentRoute,
  isHomeRoute,
} from "./navLinks";

describe("NAV_LINKS", () => {
  it("does not contain a Home/Inicio entry — the wordmark is the home link", () => {
    expect(NAV_LINKS.some((link) => link.href === HOME_HREF)).toBe(false);
    expect(NAV_LINKS.some((link) => /^(inicio|home)$/i.test(link.label))).toBe(
      false
    );
  });

  it('labels the ranking entry "Ranking y Premios" and points it at /ranking', () => {
    const ranking = NAV_LINKS.find((link) => link.href === "/ranking");
    expect(ranking).toBeDefined();
    expect(ranking?.label).toBe("Ranking y Premios");
  });

  it("has no leftover bare 'Ranking' entry", () => {
    expect(NAV_LINKS.some((link) => link.label === "Ranking")).toBe(false);
  });

  it("does not link the routes that were folded into the home page", () => {
    // /about and /contact no longer exist — their sections live on "/".
    expect(NAV_LINKS.some((link) => link.href === "/about")).toBe(false);
    expect(NAV_LINKS.some((link) => link.href === "/contact")).toBe(false);
  });

  it("keeps every other destination reachable", () => {
    expect(NAV_LINKS.map((link) => link.href)).toEqual([
      "/products",
      "/ranking",
      "/howtobuy",
    ]);
  });

  it("uses unique hrefs so React keys and current-route matching stay stable", () => {
    const hrefs = NAV_LINKS.map((link) => link.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("isCurrentRoute", () => {
  it("marks the exact route as current", () => {
    expect(isCurrentRoute("/ranking", "/ranking")).toBe(true);
  });

  it("marks a child route as current, so /products/<slug> lights up Perfumes", () => {
    expect(isCurrentRoute("/products/aventus", "/products")).toBe(true);
  });

  it("does not match a route that merely shares a prefix", () => {
    // The regression this guards: a `startsWith` rule marked "Perfumes" current
    // on an unrelated /products-faq route.
    expect(isCurrentRoute("/products-faq", "/products")).toBe(false);
  });

  it("does not mark unrelated routes as current", () => {
    expect(isCurrentRoute("/howtobuy", "/ranking")).toBe(false);
  });

  it("never marks a nav entry current just because the user is home", () => {
    for (const link of NAV_LINKS) {
      expect(isCurrentRoute(HOME_HREF, link.href)).toBe(false);
    }
  });
});

describe("isHomeRoute", () => {
  it("is true only on the exact home path", () => {
    expect(isHomeRoute("/")).toBe(true);
  });

  it("is false on every deeper route", () => {
    expect(isHomeRoute("/products")).toBe(false);
    expect(isHomeRoute("/ranking")).toBe(false);
  });
});
