import { describe, expect, it } from "vitest";
import { CANTONES, PROVINCES } from "./data";
import { DISTRICTS } from "./districts";
import {
  findCanton,
  findDistrict,
  findDistrictByName,
  findProvince,
  getCantones,
  getDistricts,
  getProvinces,
  hasDistricts,
  isValidCantonCode,
  isValidDistrictForCanton,
} from "./index";

describe("the dataset's own integrity", () => {
  it("keeps every district under a cantón that exists", () => {
    const cantonCodes = new Set(CANTONES.map((c) => c.code));
    const orphans = DISTRICTS.filter((d) => !cantonCodes.has(d.cantonCode));
    expect(orphans).toEqual([]);
  });

  it("gives every cantón at least one district to choose from", () => {
    const empty = CANTONES.filter((c) => getDistricts(c.code).length === 0);
    expect(empty).toEqual([]);
  });

  it("uses unique district codes", () => {
    const codes = DISTRICTS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("encodes the parent cantón in the first three digits of every code", () => {
    // The invariant the whole hierarchy rests on — a postal code IS the address.
    const broken = DISTRICTS.filter((d) => d.code.slice(0, 3) !== d.cantonCode);
    expect(broken).toEqual([]);
  });

  it("keeps codes as zero-padded 5-character strings", () => {
    expect(DISTRICTS.every((d) => /^\d{5}$/.test(d.code))).toBe(true);
  });

  it("keeps district names unique within their own cantón", () => {
    // Names repeat nationally, but a duplicate inside ONE cantón would make the
    // dropdown ambiguous and the name→record lookup arbitrary.
    for (const canton of CANTONES) {
      const names = getDistricts(canton.code).map((d) => d.name);
      expect(new Set(names).size, `duplicate district in ${canton.name}`).toBe(
        names.length
      );
    }
  });
});

describe("the province → cantón → district cascade", () => {
  it("offers all seven provinces", () => {
    expect(getProvinces()).toHaveLength(7);
    expect(getProvinces()).toBe(PROVINCES);
  });

  it("narrows cantones to the chosen province", () => {
    const limon = getCantones("7");
    expect(limon.map((c) => c.name)).toContain("Pococí");
    expect(limon.every((c) => c.provinceCode === "7")).toBe(true);
  });

  it("narrows districts to the chosen cantón", () => {
    const pococi = getDistricts("702");
    expect(pococi.map((d) => d.name)).toContain("Cariari");
    expect(pococi.every((d) => d.cantonCode === "702")).toBe(true);
  });

  it("partitions every district across the cantones with none left over", () => {
    const total = CANTONES.reduce(
      (sum, canton) => sum + getDistricts(canton.code).length,
      0
    );
    expect(total).toBe(DISTRICTS.length);
  });

  it("returns nothing for an empty or unknown selection, rather than everything", () => {
    // The failure mode this guards: a falsy filter key silently offering all 493
    // districts under whatever cantón happens to be selected.
    expect(getDistricts("")).toEqual([]);
    expect(getDistricts(null)).toEqual([]);
    expect(getDistricts(undefined)).toEqual([]);
    expect(getDistricts("999")).toEqual([]);
    expect(getCantones("")).toEqual([]);
    expect(getCantones(null)).toEqual([]);
  });
});

describe("lookups by code", () => {
  it("resolves a cantón and its province", () => {
    const canton = findCanton("702");
    expect(canton?.name).toBe("Pococí");
    expect(findProvince(canton!.provinceCode)?.name).toBe("Limón");
  });

  it("resolves a district", () => {
    expect(findDistrict("70205")?.name).toBe("Cariari");
  });

  it("returns null for anything unknown or missing", () => {
    expect(findDistrict("00000")).toBeNull();
    expect(findDistrict("")).toBeNull();
    expect(findDistrict(null)).toBeNull();
    expect(findCanton("999")).toBeNull();
  });
});

describe("findDistrictByName", () => {
  it("resolves a district within its cantón", () => {
    expect(findDistrictByName("702", "Cariari")?.code).toBe("70205");
  });

  it("ignores case and accents, so legacy hand-typed values still resolve", () => {
    expect(findDistrictByName("702", "CARIARI")?.code).toBe("70205");
    expect(findDistrictByName("119", "perez zeledon")).toBeNull();
    expect(findDistrictByName("101", "san sebastian")?.code).toBe("10111");
    expect(findDistrictByName("101", "SAN SEBASTIÁN")?.code).toBe("10111");
  });

  it("ignores surrounding whitespace", () => {
    expect(findDistrictByName("702", "  Cariari  ")?.code).toBe("70205");
  });

  it("does not match a district from a different cantón", () => {
    // Cariari exists, canton 401 (Heredia) exists — the combination does not.
    expect(findDistrictByName("401", "Cariari")).toBeNull();
  });

  it("returns null on missing input instead of guessing", () => {
    expect(findDistrictByName("702", "")).toBeNull();
    expect(findDistrictByName("", "Cariari")).toBeNull();
    expect(findDistrictByName(null, null)).toBeNull();
  });

  it("returns the canonical spelling, not the caller's", () => {
    // What gets persisted comes from here, so accents are normalised once.
    expect(findDistrictByName("101", "san sebastian")?.name).toBe(
      "San Sebastián"
    );
  });
});

describe("validators", () => {
  it("accepts a real cantón code and rejects a fake one", () => {
    expect(isValidCantonCode("702")).toBe(true);
    expect(isValidCantonCode("999")).toBe(false);
  });

  it("accepts a district only under its own cantón", () => {
    expect(isValidDistrictForCanton("702", "Cariari")).toBe(true);
    expect(isValidDistrictForCanton("401", "Cariari")).toBe(false);
    expect(isValidDistrictForCanton("702", "Pura Vida")).toBe(false);
  });

  it("reports whether a cantón has districts at all", () => {
    expect(hasDistricts("702")).toBe(true);
    expect(hasDistricts("999")).toBe(false);
    expect(hasDistricts("")).toBe(false);
  });
});

describe("the Cariari case specifically", () => {
  it("exists exactly once in the whole country", () => {
    const all = DISTRICTS.filter((d) => d.name === "Cariari");
    expect(all).toHaveLength(1);
    expect(all[0].code).toBe("70205");
  });

  it("sits under Limón → Pococí", () => {
    const cariari = findDistrict("70205")!;
    const canton = findCanton(cariari.cantonCode)!;
    expect(canton.name).toBe("Pococí");
    expect(findProvince(canton.provinceCode)?.name).toBe("Limón");
  });

  it("has no namesake under any Heredia cantón", () => {
    // The scenario named in the shipping rule: Heredia → Pococí → Cariari must
    // not be reachable, and it isn't, because Pococí is a Limón cantón only.
    for (const canton of getCantones("4")) {
      expect(findDistrictByName(canton.code, "Cariari")).toBeNull();
    }
    expect(getCantones("4").map((c) => c.name)).not.toContain("Pococí");
  });
});
