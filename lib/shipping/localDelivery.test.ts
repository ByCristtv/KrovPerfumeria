import { describe, expect, it } from "vitest";
import { findCanton, findProvince, getCantones } from "@/lib/cr-geo";
import {
  LOCAL_DELIVERY_AREA,
  isLocalDeliveryArea,
  resolveShippingCost,
} from "./localDelivery";

/** A representative zone rate, so 0 vs "unchanged" is never ambiguous. */
const ZONE_RATE = 3_500;

/** Limón → Pococí → Cariari, the one qualifying address. */
const CARIARI = { canton_code: "702", district: "Cariari" };

describe("LOCAL_DELIVERY_AREA", () => {
  it("points at a cantón that really exists", () => {
    const canton = findCanton(LOCAL_DELIVERY_AREA.cantonCode);
    expect(canton?.name).toBe(LOCAL_DELIVERY_AREA.cantonName);
  });

  it("sits in the province it claims", () => {
    const canton = findCanton(LOCAL_DELIVERY_AREA.cantonCode)!;
    expect(canton.provinceCode).toBe(LOCAL_DELIVERY_AREA.provinceCode);
    expect(findProvince(canton.provinceCode)?.name).toBe(
      LOCAL_DELIVERY_AREA.provinceName
    );
  });

  it("uses the exact checkbox label the storefront shows", () => {
    expect(LOCAL_DELIVERY_AREA.optInLabel).toBe("Cariari centro");
  });
});

describe("isLocalDeliveryArea", () => {
  it("matches Limón → Pococí → Cariari", () => {
    expect(isLocalDeliveryArea(CARIARI)).toBe(true);
  });

  it("matches regardless of how the district was capitalised or accented", () => {
    expect(isLocalDeliveryArea({ ...CARIARI, district: "CARIARI" })).toBe(true);
    expect(isLocalDeliveryArea({ ...CARIARI, district: " cariari " })).toBe(true);
  });

  it("rejects another district of the same cantón", () => {
    // Guápiles is Pococí too, and pays the normal rate.
    expect(isLocalDeliveryArea({ canton_code: "702", district: "Guápiles" })).toBe(
      false
    );
  });

  it("rejects the same district name under a different cantón", () => {
    // The Heredia case from the spec: a "Cariari" that is not OUR Cariari must
    // never qualify. Scoping the district lookup to its cantón is what stops it.
    for (const canton of getCantones("4")) {
      expect(
        isLocalDeliveryArea({ canton_code: canton.code, district: "Cariari" })
      ).toBe(false);
    }
  });

  it("rejects a Cariari-shaped address in the wrong province", () => {
    expect(isLocalDeliveryArea({ canton_code: "101", district: "Cariari" })).toBe(
      false
    );
    expect(isLocalDeliveryArea({ canton_code: "401", district: "Cariari" })).toBe(
      false
    );
  });

  it("rejects the cantón on its own, with no district chosen", () => {
    expect(isLocalDeliveryArea({ canton_code: "702" })).toBe(false);
    expect(isLocalDeliveryArea({ canton_code: "702", district: "" })).toBe(false);
  });

  it("rejects an empty or unknown cantón", () => {
    expect(isLocalDeliveryArea({ canton_code: "", district: "Cariari" })).toBe(
      false
    );
    expect(isLocalDeliveryArea({ canton_code: "999", district: "Cariari" })).toBe(
      false
    );
  });

  it("qualifies exactly one address in the entire country", () => {
    const matches = [];
    for (const province of ["1", "2", "3", "4", "5", "6", "7"]) {
      for (const canton of getCantones(province)) {
        for (const district of ["Cariari", "Guápiles", "Carmen", "Centro"]) {
          if (isLocalDeliveryArea({ canton_code: canton.code, district })) {
            matches.push(`${canton.code}/${district}`);
          }
        }
      }
    }
    expect(matches).toEqual(["702/Cariari"]);
  });
});

describe("resolveShippingCost — free shipping activates", () => {
  it("zeroes the cost for Cariari with the box checked", () => {
    expect(resolveShippingCost(ZONE_RATE, CARIARI, true)).toEqual({
      cost: 0,
      localDeliveryApplied: true,
    });
  });

  it("zeroes it no matter how high the zone rate was", () => {
    expect(resolveShippingCost(99_000, CARIARI, true).cost).toBe(0);
  });
});

describe("resolveShippingCost — standard shipping is retained", () => {
  it("keeps the zone rate when the box is unchecked", () => {
    expect(resolveShippingCost(ZONE_RATE, CARIARI, false)).toEqual({
      cost: ZONE_RATE,
      localDeliveryApplied: false,
    });
  });

  it("keeps the zone rate when the box was never touched", () => {
    expect(resolveShippingCost(ZONE_RATE, CARIARI, undefined).cost).toBe(
      ZONE_RATE
    );
  });

  it("keeps the zone rate once the address moves to another district", () => {
    // The stale-checkbox case: the flag survives an address edit, and must stop
    // having any effect the moment the address stops qualifying.
    const moved = { canton_code: "702", district: "Guápiles" };
    expect(resolveShippingCost(ZONE_RATE, moved, true)).toEqual({
      cost: ZONE_RATE,
      localDeliveryApplied: false,
    });
  });

  it("keeps the zone rate once the address moves to another cantón", () => {
    const moved = { canton_code: "101", district: "Carmen" };
    expect(resolveShippingCost(ZONE_RATE, moved, true).cost).toBe(ZONE_RATE);
  });

  it("ignores a forged flag on a Cariari district in the wrong cantón", () => {
    // Heredia → "Cariari": the exact payload a client could hand-craft to claim
    // free delivery. It gets the standard rate.
    const forged = { canton_code: "401", district: "Cariari" };
    expect(resolveShippingCost(ZONE_RATE, forged, true)).toEqual({
      cost: ZONE_RATE,
      localDeliveryApplied: false,
    });
  });

  it("does not report the override when shipping was already free", () => {
    // A zone threshold had made it free; that is not local delivery, and
    // labelling it "Cariari centro" would be a lie about why.
    const resolved = resolveShippingCost(0, CARIARI, false);
    expect(resolved.cost).toBe(0);
    expect(resolved.localDeliveryApplied).toBe(false);
  });

  it("treats a truthy-but-not-true flag as no opt-in", () => {
    // Guards a value arriving from JSON as a string. The check is `=== true`.
    const flag = "true" as unknown as boolean;
    expect(resolveShippingCost(ZONE_RATE, CARIARI, flag).cost).toBe(ZONE_RATE);
  });
});
