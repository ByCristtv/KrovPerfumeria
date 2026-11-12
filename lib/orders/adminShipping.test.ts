import { describe, expect, it } from "vitest";
import { getCantones, getDistricts } from "@/lib/cr-geo";
import { isAdminFreeLocalDelivery, quoteAdminShipping } from "./adminShipping";

/**
 * Manual orders to Limón › Pococí › Cariari ship free, automatically. The rule
 * is the shared local-delivery area (cantón code + the dataset's district), so
 * these tests pin both directions: it fires for exactly that place, and only
 * for a delivery.
 */

const CARIARI = { canton_code: "702", district: "Cariari" };
const ZONE_RATE = 2_900;

describe("isAdminFreeLocalDelivery", () => {
  it("is free for a delivery to Cariari, Pococí", () => {
    expect(isAdminFreeLocalDelivery("delivery", CARIARI)).toBe(true);
  });

  it("is not a delivery concept for pickup (already free)", () => {
    expect(isAdminFreeLocalDelivery("pickup", CARIARI)).toBe(false);
  });

  it("does not apply to another district of Pococí", () => {
    for (const d of getDistricts("702")) {
      if (d.name === "Cariari") continue;
      expect(isAdminFreeLocalDelivery("delivery", { canton_code: "702", district: d.name })).toBe(
        false
      );
    }
  });

  it("does not apply to a 'Cariari' typed under another cantón (not a real place)", () => {
    expect(isAdminFreeLocalDelivery("delivery", { canton_code: "101", district: "Cariari" })).toBe(
      false
    );
  });

  it("does not apply without a district", () => {
    expect(isAdminFreeLocalDelivery("delivery", { canton_code: "702" })).toBe(false);
    expect(isAdminFreeLocalDelivery("delivery", { canton_code: "702", district: "" })).toBe(false);
  });

  it("matches exactly one place in the whole country", () => {
    const hits: string[] = [];
    for (const province of ["1", "2", "3", "4", "5", "6", "7"]) {
      for (const canton of getCantones(province)) {
        for (const district of getDistricts(canton.code)) {
          if (
            isAdminFreeLocalDelivery("delivery", {
              canton_code: canton.code,
              district: district.name,
            })
          ) {
            hits.push(`${canton.code}/${district.name}`);
          }
        }
      }
    }
    expect(hits).toEqual(["702/Cariari"]);
  });
});

describe("quoteAdminShipping", () => {
  it("charges ₡0 for Cariari even when the zone has a rate", () => {
    expect(quoteAdminShipping("delivery", CARIARI, ZONE_RATE)).toEqual({
      status: "local_delivery",
      cost: 0,
    });
  });

  it("charges ₡0 for Cariari while the zone rate is still unknown", () => {
    expect(quoteAdminShipping("delivery", CARIARI, null)).toEqual({
      status: "local_delivery",
      cost: 0,
    });
  });

  it("restores the zone rate as soon as the district moves away from Cariari", () => {
    expect(
      quoteAdminShipping("delivery", { canton_code: "702", district: "Guápiles" }, ZONE_RATE)
    ).toEqual({ status: "zone", cost: ZONE_RATE });
  });

  it("is free for pickup, whatever the address", () => {
    expect(quoteAdminShipping("pickup", { canton_code: "101", district: "Carmen" }, ZONE_RATE)).toEqual(
      { status: "pickup", cost: 0 }
    );
  });

  it("reports unknown when there is no zone rate yet", () => {
    expect(quoteAdminShipping("delivery", { canton_code: "101", district: "Carmen" }, null)).toEqual(
      { status: "unknown", cost: null }
    );
  });

  it("keeps a zone that is itself free (₡0) as a zone price, not local delivery", () => {
    expect(quoteAdminShipping("delivery", { canton_code: "101", district: "Carmen" }, 0)).toEqual({
      status: "zone",
      cost: 0,
    });
  });
});
