import { describe, it, expect } from "vitest";
import {
  commercialCategoryIds,
  isGenderCategorySlug,
  relatedGenders,
  resolveCatalogCategoryFilter,
  type GenderCategoryIds,
} from "./catalogCategoryFilter";

const IDS: Required<GenderCategoryIds> = {
  hombre: "id-hombre",
  mujer: "id-mujer",
  unisex: "id-unisex",
};

describe("resolveCatalogCategoryFilter", () => {
  it("Hombre → masculine + unisex (by products.gender, not category rows)", () => {
    expect(resolveCatalogCategoryFilter(IDS.hombre, IDS)).toEqual({
      kind: "gender",
      genders: ["masculine", "unisex"],
    });
  });

  it("Mujer → feminine + unisex — never masculine", () => {
    const filter = resolveCatalogCategoryFilter(IDS.mujer, IDS);
    expect(filter).toEqual({ kind: "gender", genders: ["feminine", "unisex"] });
    expect(filter.kind === "gender" && filter.genders).not.toContain("masculine");
  });

  it("Unisex → unisex only", () => {
    expect(resolveCatalogCategoryFilter(IDS.unisex, IDS)).toEqual({
      kind: "gender",
      genders: ["unisex"],
    });
  });

  it("a commercial category keeps filtering by its association rows", () => {
    expect(resolveCatalogCategoryFilter("id-arabe", IDS)).toEqual({
      kind: "category",
      categoryId: "id-arabe",
    });
  });

  it("an id that matches no gender category is treated as a plain category", () => {
    // E.g. the lookup failed (empty map): the request must not turn into a
    // gender filter by accident.
    expect(resolveCatalogCategoryFilter(IDS.hombre, {})).toEqual({
      kind: "category",
      categoryId: IDS.hombre,
    });
  });

  it("returns a fresh list each call (callers may not mutate the rule)", () => {
    const a = resolveCatalogCategoryFilter(IDS.hombre, IDS);
    const b = resolveCatalogCategoryFilter(IDS.hombre, IDS);
    expect(a.kind === "gender" && b.kind === "gender" && a.genders !== b.genders).toBe(true);
  });
});

describe("isGenderCategorySlug", () => {
  it("recognises exactly the three gender slugs", () => {
    expect(["hombre", "mujer", "unisex"].every(isGenderCategorySlug)).toBe(true);
    expect(isGenderCategorySlug("arabe")).toBe(false);
    expect(isGenderCategorySlug(undefined)).toBe(false);
    expect(isGenderCategorySlug(null)).toBe(false);
  });
});

describe("commercialCategoryIds", () => {
  it("drops legacy gender rows and keeps commercial ones", () => {
    expect(
      commercialCategoryIds([
        { id: "c-arabe", slug: "arabe" },
        { id: "c-hombre", slug: "hombre" },
        { id: "c-unisex", slug: "unisex" },
        { id: "c-nicho", slug: "nicho" },
      ])
    ).toEqual(["c-arabe", "c-nicho"]);
  });

  it("keeps a category whose slug is unknown", () => {
    expect(commercialCategoryIds([{ id: "c-x" }])).toEqual(["c-x"]);
  });
});

describe("relatedGenders", () => {
  it("pairs each gender with unisex, same gender first", () => {
    expect(relatedGenders("masculine")).toEqual(["masculine", "unisex"]);
    expect(relatedGenders("feminine")).toEqual(["feminine", "unisex"]);
  });

  it("lets a unisex perfume relate to everything, unisex first", () => {
    expect(relatedGenders("unisex")).toEqual(["unisex", "masculine", "feminine"]);
  });

  it("has no preference for an unknown gender", () => {
    expect(relatedGenders(null)).toBeNull();
  });
});
