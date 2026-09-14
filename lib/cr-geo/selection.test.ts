import { describe, expect, it } from "vitest";
import {
  emptyAddressSelection,
  isCoherentAddressSelection,
  selectCanton,
  selectDistrict,
  selectProvince,
  type AddressSelection,
} from "./selection";

/**
 * The cascade's reset rules, as transitions. These are the rules every address
 * form depends on, and the failure they guard against is silent: a level left
 * behind does not look wrong on screen, it just names somewhere the customer
 * does not live.
 *
 * Codes used below: province "1" San José / cantón "101" San José / district
 * "Carmen"; province "7" Limón / cantón "702" Pococí / district "Cariari".
 */

const sanJose: AddressSelection = {
  provinceCode: "1",
  cantonCode: "101",
  district: "Carmen",
};

describe("selectProvince", () => {
  it("clears the cantón and district when the province changes", () => {
    expect(selectProvince(sanJose, "7")).toEqual({
      provinceCode: "7",
      cantonCode: "",
      district: "",
    });
  });

  it("keeps a cantón that still belongs to the province just chosen", () => {
    // Re-picking the same province must not wipe an address already filled in.
    expect(selectProvince(sanJose, "1")).toEqual(sanJose);
  });

  it("clears everything below when the province is unset", () => {
    expect(selectProvince(sanJose, "")).toEqual(emptyAddressSelection);
  });
});

describe("selectCanton", () => {
  it("clears the district when the cantón changes", () => {
    const next = selectCanton(sanJose, "102");
    expect(next.cantonCode).toBe("102");
    expect(next.district).toBe("");
  });

  it("keeps the district when the same cantón is re-picked", () => {
    expect(selectCanton(sanJose, "101")).toEqual(sanJose);
  });

  it("clears the district when the cantón is unset", () => {
    expect(selectCanton(sanJose, "")).toEqual({
      provinceCode: "1",
      cantonCode: "",
      district: "",
    });
  });
});

describe("selectDistrict", () => {
  it("sets the district and touches nothing above it", () => {
    const next = selectDistrict({ ...sanJose, district: "" }, "Merced");
    expect(next).toEqual({
      provinceCode: "1",
      cantonCode: "101",
      district: "Merced",
    });
  });
});

describe("isCoherentAddressSelection", () => {
  it("accepts a district that belongs to its cantón", () => {
    expect(isCoherentAddressSelection(sanJose)).toBe(true);
  });

  it("accepts an empty district — it is optional in the manual-order flow", () => {
    expect(
      isCoherentAddressSelection({ ...sanJose, district: "" })
    ).toBe(true);
  });

  it("rejects a district from another cantón", () => {
    // "Cariari" is real and "101" is real; "Cariari in cantón 101" is not.
    expect(
      isCoherentAddressSelection({ ...sanJose, district: "Cariari" })
    ).toBe(false);
  });

  it("rejects free text that is not a district at all", () => {
    expect(
      isCoherentAddressSelection({ ...sanJose, district: "Barrio Escalante" })
    ).toBe(false);
  });

  it("rejects a cantón outside the chosen province", () => {
    expect(
      isCoherentAddressSelection({
        provinceCode: "1",
        cantonCode: "702",
        district: "Cariari",
      })
    ).toBe(false);
  });

  it("rejects a selection with no cantón", () => {
    expect(isCoherentAddressSelection(emptyAddressSelection)).toBe(false);
  });
});
