import { describe, expect, it } from "vitest";
import {
  LANDINGS,
  LANDING_LIST,
  joinSpanish,
  landingContext,
  landingMetadata,
  pickBrands,
} from "./landings";

const brandOf = (name: string | null) => ({ brands: name ? { name } : null });

describe("joinSpanish", () => {
  it("joins like a Spanish sentence", () => {
    expect(joinSpanish([])).toBe("");
    expect(joinSpanish(["Lattafa"])).toBe("Lattafa");
    expect(joinSpanish(["Lattafa", "Armaf"])).toBe("Lattafa y Armaf");
    expect(joinSpanish(["Lattafa", "Armaf", "Rayhaan"])).toBe("Lattafa, Armaf y Rayhaan");
  });
});

describe("pickBrands", () => {
  it("returns distinct, non-empty brands in first-seen order, capped", () => {
    const products = [
      brandOf("Lattafa"),
      brandOf("Lattafa"),
      brandOf(null),
      brandOf("  "),
      brandOf("Armaf"),
      brandOf("Rayhaan"),
      brandOf("Maison Alhambra"),
    ];
    expect(pickBrands(products)).toEqual(["Lattafa", "Armaf", "Rayhaan"]);
    expect(pickBrands(products, 2)).toEqual(["Lattafa", "Armaf"]);
  });
});

describe("LANDINGS", () => {
  it("are keyed by their own slug and live at a clean, unique top-level path", () => {
    for (const [slug, landing] of Object.entries(LANDINGS)) {
      expect(landing.slug).toBe(slug);
      expect(landing.path).toBe(`/${slug}`);
    }
    expect(new Set(LANDING_LIST.map((l) => l.path)).size).toBe(LANDING_LIST.length);
  });

  it("filter by exactly one thing: a category slug or a product type", () => {
    expect(LANDINGS["perfumes-arabes"].filter).toEqual({ categorySlug: "arabe" });
    expect(LANDINGS.decants.filter).toEqual({ productType: "decant" });
  });

  it("only link to landings that exist", () => {
    for (const landing of LANDING_LIST) {
      for (const related of landing.related) expect(LANDINGS[related]).toBeDefined();
    }
  });

  it("never route through /products/<slug>, which the product page owns", () => {
    for (const landing of LANDING_LIST) expect(landing.path.startsWith("/products")).toBe(false);
  });

  it("write meta descriptions that fit a SERP, for 0, 1 and many results", () => {
    for (const landing of LANDING_LIST) {
      for (const total of [0, 1, 15]) {
        const out = landing.description({ total, brands: ["Lattafa", "Armaf", "Maison Alhambra"] });
        expect(out.length).toBeLessThanOrEqual(160);
        expect(out).toContain("Costa Rica");
      }
    }
  });

  it("state counts and brands only from the live context", () => {
    const arabes = LANDINGS["perfumes-arabes"];
    expect(arabes.description({ total: 1, brands: [] })).toContain("1 fragancia.");
    expect(arabes.description({ total: 8, brands: ["Lattafa", "Armaf"] })).toContain(
      "8 fragancias de Lattafa y Armaf"
    );
    // With no brands known, the copy simply omits the clause.
    expect(arabes.intro({ total: 3, brands: [] })).not.toContain(" de  ");
    expect(arabes.intro({ total: 3, brands: ["Lattafa"] })).toContain("de Lattafa");
  });
});

describe("landingMetadata", () => {
  const result = (over: Partial<{ totalProducts: number; currentPage: number }> = {}) => ({
    totalProducts: 12,
    currentPage: 1,
    products: [brandOf("Lattafa"), brandOf("Armaf")] as never,
    ...over,
  });
  const landing = LANDINGS["perfumes-arabes"];

  it("indexes a landing that lists products, with a self-canonical", () => {
    const meta = landingMetadata(landing, result());
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe("/perfumes-arabes");
    expect(meta.title).toBe("Perfumes árabes en Costa Rica");
  });

  it("keeps an empty landing out of the index rather than serving it thin", () => {
    const meta = landingMetadata(landing, result({ totalProducts: 0 }));
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates).toBeUndefined();
  });

  it("titles and canonicalises later pages by the page actually rendered", () => {
    const meta = landingMetadata(landing, result({ currentPage: 2 }));
    expect(meta.title).toBe("Perfumes árabes en Costa Rica – Página 2");
    expect(meta.alternates?.canonical).toBe("/perfumes-arabes?page=2");
  });

  it("builds the description from the same live context as the page copy", () => {
    const ctx = landingContext(result());
    expect(ctx).toEqual({ total: 12, brands: ["Lattafa", "Armaf"] });
    expect(landingMetadata(landing, result()).description).toBe(landing.description(ctx));
  });
});
