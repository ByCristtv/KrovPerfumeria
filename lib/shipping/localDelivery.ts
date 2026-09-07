import { findCanton, findDistrictByName, findProvince } from "@/lib/cr-geo";

/**
 * Free local delivery in the shop's own town.
 *
 * The store delivers to Cariari centro itself, so an order going there costs
 * nothing to ship. Everywhere else — including the rest of the Cariari district,
 * which stretches well beyond the town — pays the normal zone rate, which is why
 * this is opt-in rather than automatic on the address alone: only the customer
 * knows whether they are actually in the centre.
 *
 * WHERE THIS RULE LIVES, AND WHY IT IS NOT IN SQL
 * Shipping is otherwise computed by `calculate_shipping_cost` in Postgres and
 * written by `place_order`. This override is applied one layer up, in the Next
 * server (lib/checkout), for two reasons:
 *
 *   1. It is still server-authoritative. The browser sends a boolean INTENT;
 *      eligibility is re-derived here from the address the server validated.
 *      A forged `local_delivery: true` on a San José address gets the standard
 *      rate, because `isLocalDeliveryArea` is what decides, not the flag.
 *   2. `place_order` exists in four migration generations, all of which call
 *      `calculate_shipping_cost` identically. Threading a district and a flag
 *      through that RPC would mean rewriting every one of them for a rule that
 *      applies to a single district.
 *
 * If local delivery ever grows to several areas, the shape below is what moves
 * into a table — the callers keep the same two functions.
 */

/**
 * The one address that qualifies. Identified by CANTON CODE rather than by
 * province + cantón names: cantón codes are unique nationally, so "702" already
 * pins the province to Limón and no name comparison can be spoofed by casing.
 */
export const LOCAL_DELIVERY_AREA = {
  provinceCode: "7",
  provinceName: "Limón",
  cantonCode: "702",
  cantonName: "Pococí",
  districtName: "Cariari",
  /** The checkbox's label, verbatim. */
  optInLabel: "Cariari centro",
} as const;

/** The address fields the rule reads. A subset of CheckoutShipping. */
export interface LocalDeliveryAddress {
  canton_code: string;
  district?: string;
}

/**
 * Is this address inside the free local-delivery district?
 *
 * Both levels are checked, and the district is resolved THROUGH its cantón
 * (`findDistrictByName` is cantón-scoped), so a district named "Cariari" under
 * any other cantón cannot match. The province is asserted too — redundant given
 * the cantón code, but it makes the rule read as the three-level statement it
 * is, and it fails closed if the geo dataset is ever edited badly.
 */
export function isLocalDeliveryArea(address: LocalDeliveryAddress): boolean {
  if (address.canton_code !== LOCAL_DELIVERY_AREA.cantonCode) return false;

  const canton = findCanton(address.canton_code);
  if (!canton || canton.name !== LOCAL_DELIVERY_AREA.cantonName) return false;

  const province = findProvince(canton.provinceCode);
  if (!province || province.name !== LOCAL_DELIVERY_AREA.provinceName) {
    return false;
  }

  const district = findDistrictByName(address.canton_code, address.district);
  return district?.name === LOCAL_DELIVERY_AREA.districtName;
}

export interface ResolvedShipping {
  /** What the customer actually pays. */
  cost: number;
  /** True only when the override fired — drives the "Gratis" label. */
  localDeliveryApplied: boolean;
}

/**
 * The final shipping cost: the zone's rate, unless free local delivery applies.
 *
 * `optedIn` is a request, not a decision. It only has an effect when the address
 * independently qualifies, which is what makes this safe to call with a value
 * that came from a browser. Everything else falls through to `baseCost`
 * untouched — including an address that qualifies but did not opt in, and an
 * address that moves away from Cariari while the box is still ticked.
 */
export function resolveShippingCost(
  baseCost: number,
  address: LocalDeliveryAddress,
  optedIn: boolean | undefined
): ResolvedShipping {
  if (optedIn === true && isLocalDeliveryArea(address)) {
    return { cost: 0, localDeliveryApplied: true };
  }
  return { cost: baseCost, localDeliveryApplied: false };
}
