/**
 * The province → cantón → distrito cascade, as pure state transitions.
 *
 * Every form that collects a Costa Rican address has to answer the same three
 * questions when one level changes: which of the levels below it are still
 * meaningful, which must be cleared, and what the next level may now offer.
 * Getting that wrong is not a cosmetic bug — a stale cantón silently reprices
 * shipping, and a stale district names a place the customer does not live in.
 *
 * The rules live here, outside React, so they can be tested as transitions and
 * shared by the checkout form and the admin manual-order form without either one
 * re-deriving them from `useEffect` timing.
 *
 * Districts are carried BY NAME, matching what the database stores — see the
 * long note in ./index.ts.
 */

import { findCanton, findDistrictByName } from "./index";

/** The three address levels a form holds together. Empty string = "not chosen". */
export interface AddressSelection {
  /** 1-digit province code, or "". */
  provinceCode: string;
  /** 3-digit cantón code, or "". */
  cantonCode: string;
  /** District NAME (not code), or "". */
  district: string;
}

/** Nothing chosen yet — safe `useState` seed for a blank form. */
export const emptyAddressSelection: AddressSelection = {
  provinceCode: "",
  cantonCode: "",
  district: "",
};

/**
 * Choose a province.
 *
 * The cantón survives only when it genuinely belongs to the new province, which
 * in practice means the user re-picked the province they already had. Anything
 * else drops both levels below — keeping a cantón from another province would
 * hand the shipping-cost lookup a cantón the address never had.
 */
export function selectProvince(
  selection: AddressSelection,
  provinceCode: string
): AddressSelection {
  if (provinceCode === selection.provinceCode) return selection;

  const canton = findCanton(selection.cantonCode);
  const cantonStillValid = canton !== null && canton.provinceCode === provinceCode;

  return cantonStillValid
    ? { ...selection, provinceCode }
    : { provinceCode, cantonCode: "", district: "" };
}

/**
 * Choose a cantón.
 *
 * A different cantón always invalidates the district: district names repeat
 * across the country, so "San Rafael" under the previous cantón is a different
 * place from "San Rafael" under this one, and carrying the name across would
 * silently relocate the order.
 */
export function selectCanton(
  selection: AddressSelection,
  cantonCode: string
): AddressSelection {
  if (cantonCode === selection.cantonCode) return selection;
  return { ...selection, cantonCode, district: "" };
}

/** Choose a district. The leaf of the cascade; nothing below it to reset. */
export function selectDistrict(
  selection: AddressSelection,
  district: string
): AddressSelection {
  return { ...selection, district };
}

/**
 * Is this selection internally consistent — cantón inside province, district
 * inside cantón?
 *
 * An empty district passes: districts are optional in the manual-order flow
 * (a phone customer who only gives a cantón), and the RPC accepts NULL there.
 * A NON-empty district that does not belong to the cantón never passes.
 */
export function isCoherentAddressSelection(
  selection: AddressSelection
): boolean {
  const canton = findCanton(selection.cantonCode);
  if (!canton) return false;
  if (selection.provinceCode && canton.provinceCode !== selection.provinceCode) {
    return false;
  }
  if (!selection.district) return true;
  return findDistrictByName(selection.cantonCode, selection.district) !== null;
}
