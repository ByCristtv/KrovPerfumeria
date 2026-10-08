import { describe, expect, it } from "vitest";
import { catalogCanonicalPath, catalogSeo, isFilteredView } from "./catalog";

describe("isFilteredView", () => {
  it("is false for a bare listing, a page number and tracking params", () => {
    expect(isFilteredView({})).toBe(false);
    expect(isFilteredView({ page: "3" })).toBe(false);
    expect(isFilteredView({ utm_source: "ig", fbclid: "abc" })).toBe(false);
  });

  it("is true for every param that changes what is shown or in what order", () => {
    for (const param of ["q", "category", "type", "offer", "wholesale", "sort"]) {
      expect(isFilteredView({ [param]: "x" })).toBe(true);
    }
  });

  it("ignores empty or whitespace-only values and reads the first of repeated params", () => {
    expect(isFilteredView({ q: "" })).toBe(false);
    expect(isFilteredView({ q: "   " })).toBe(false);
    expect(isFilteredView({ category: ["abc", "def"] })).toBe(true);
    expect(isFilteredView({ q: undefined })).toBe(false);
  });
});

describe("catalogCanonicalPath", () => {
  it("has no query string for page 1, and self-canonicalises later pages", () => {
    expect(catalogCanonicalPath("/products", 1)).toBe("/products");
    expect(catalogCanonicalPath("/products", 2)).toBe("/products?page=2");
    expect(catalogCanonicalPath("/decants", 5)).toBe("/decants?page=5");
  });
});

describe("catalogSeo", () => {
  it("indexes the plain listing and each page of the series on its own URL", () => {
    expect(catalogSeo("/products", {})).toEqual({ page: 1, canonicalPath: "/products" });
    expect(catalogSeo("/products", { page: "2" })).toEqual({
      page: 2,
      canonicalPath: "/products?page=2",
    });
  });

  it("falls back to page 1 for junk page numbers", () => {
    for (const page of ["0", "-3", "abc", ""]) {
      expect(catalogSeo("/products", { page }).canonicalPath).toBe("/products");
    }
  });

  it("noindexes (follow) any filtered or sorted view and names no canonical-worthy page", () => {
    const seo = catalogSeo("/products", { sort: "price_desc" });
    expect(seo.robots).toEqual({ index: false, follow: true });

    expect(catalogSeo("/products", { q: "lattafa", page: "2" }).robots).toBeDefined();
  });

  it("keeps tracking-parameter URLs indexable, canonicalised to the clean URL", () => {
    const seo = catalogSeo("/products", { utm_source: "instagram" });
    expect(seo.robots).toBeUndefined();
    expect(seo.canonicalPath).toBe("/products");
  });

  it("lets curated landings ignore filter params they don't honour", () => {
    const seo = catalogSeo("/decants", { sort: "price_desc", page: "2" }, false);
    expect(seo.robots).toBeUndefined();
    expect(seo.canonicalPath).toBe("/decants?page=2");
  });
});
