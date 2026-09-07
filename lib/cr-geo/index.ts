/**
 * Costa Rica administrative geography — typed accessors.
 *
 * Use these from UI components (the province → cantón → distrito cascade) and
 * from validation (verify a submitted canton_code is real, and that the district
 * genuinely belongs to it, before sending to the place_order RPC).
 *
 * If we ever migrate to DB-backed geo, only this file changes —
 * callers keep the same accessor API.
 */

import { CANTONES, PROVINCES } from "./data";
import { DISTRICTS } from "./districts";
import type { Canton, District, Province } from "./types";

export type { Canton, Province, District } from "./types";

/** All 7 CR provinces, in canonical order. */
export function getProvinces(): readonly Province[] {
  return PROVINCES;
}

/** Cantones for a given province, or empty array if province code unknown. */
export function getCantones(provinceCode: string | null | undefined): readonly Canton[] {
  if (!provinceCode) return [];
  return CANTONES.filter((c) => c.provinceCode === provinceCode);
}

/** Resolve a canton record from its code. Returns null if not found. */
export function findCanton(cantonCode: string | null | undefined): Canton | null {
  if (!cantonCode) return null;
  return CANTONES.find((c) => c.code === cantonCode) ?? null;
}

/** Resolve a province record from its code. Returns null if not found. */
export function findProvince(provinceCode: string | null | undefined): Province | null {
  if (!provinceCode) return null;
  return PROVINCES.find((p) => p.code === provinceCode) ?? null;
}

/**
 * Quick validator: is this a real CR canton code we know about?
 * Use in zod schemas to refuse obviously-fake input before hitting the RPC.
 */
export function isValidCantonCode(cantonCode: string): boolean {
  return CANTONES.some((c) => c.code === cantonCode);
}

// ─────────────────────────────────────────────────────────────────────────────
// Districts
// ─────────────────────────────────────────────────────────────────────────────
//
// A note on why districts are addressed BY NAME in most of this app while
// cantones are addressed by code: the district name is what the database
// actually stores. `addresses.district` and `orders.shipping_district` are text
// columns holding a display name, written that way long before this dataset
// existed. Introducing a district code as the form's value would mean migrating
// both columns and every saved address, to gain nothing the name doesn't already
// give us. So the dropdowns carry names, and the helpers below let a name be
// checked against the cantón that was chosen alongside it.

/**
 * Districts of a cantón, in official code order, or an empty array when the
 * cantón is unknown.
 *
 * An empty result is a legitimate answer, not an error — a cantón added to
 * CANTONES before its districts are known would land here — so callers should
 * degrade (offer free text) rather than block.
 */
export function getDistricts(
  cantonCode: string | null | undefined
): readonly District[] {
  if (!cantonCode) return [];
  return DISTRICTS.filter((d) => d.cantonCode === cantonCode);
}

/** Resolve a district record from its 5-digit code. Returns null if not found. */
export function findDistrict(
  districtCode: string | null | undefined
): District | null {
  if (!districtCode) return null;
  return DISTRICTS.find((d) => d.code === districtCode) ?? null;
}

/**
 * Resolve a district by NAME within one cantón.
 *
 * Scoped to a cantón on purpose: district names repeat across the country
 * (there are several "San Rafael"s), so a name is only unique in the context of
 * its parent. Matching is accent- and case-insensitive so a legacy hand-typed
 * "SAN RAFAEL" still resolves to the canonical "San Rafael".
 */
export function findDistrictByName(
  cantonCode: string | null | undefined,
  districtName: string | null | undefined
): District | null {
  if (!cantonCode || !districtName) return null;
  const needle = normalizeName(districtName);
  return (
    getDistricts(cantonCode).find((d) => normalizeName(d.name) === needle) ??
    null
  );
}

/**
 * Does this district name belong to this cantón?
 *
 * The cross-field check the checkout schema needs: "Cariari" is a real district
 * and "401" is a real cantón, but "Cariari in cantón 401" is not a real place,
 * and only a validator that sees BOTH fields can say so.
 */
export function isValidDistrictForCanton(
  cantonCode: string | null | undefined,
  districtName: string | null | undefined
): boolean {
  return findDistrictByName(cantonCode, districtName) !== null;
}

/**
 * Whether we hold any districts for a cantón. Lets a form choose between a
 * dropdown and a free-text fallback without reaching for `.length` on a list it
 * would otherwise have to fetch twice.
 */
export function hasDistricts(cantonCode: string | null | undefined): boolean {
  return getDistricts(cantonCode).length > 0;
}

/**
 * Fold case and strip diacritics so "Pérez" and "PEREZ" compare equal.
 *
 * NFD splits an accented character into base + combining mark; the range below
 * removes the marks, leaving the base letter. Used ONLY for comparison — the
 * canonical accented name from the dataset is always what gets stored.
 */
function normalizeName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}
