"use client";

import { findDistrictByName, getDistricts } from "@/lib/cr-geo";

interface DistrictSelectProps {
  /** The cantón chosen alongside this field. Empty disables the control. */
  cantonCode: string;
  /** Currently selected district NAME (not code) — see the note below. */
  value: string;
  onChange: (districtName: string) => void;
  /** The host form's input styling; this component ships none of its own. */
  className?: string;
  name?: string;
  id?: string;
  disabled?: boolean;
}

/**
 * The "Distrito" field, shared by checkout and the profile address card.
 *
 * One component rather than two copies because the district rules are subtle
 * enough that two implementations would drift: the options depend on another
 * field, and the legacy-value case below is easy to get wrong in a way that
 * silently discards a customer's saved address.
 *
 * WHY THE VALUE IS A NAME, NOT A CODE
 * `addresses.district` and `orders.shipping_district` are text columns holding a
 * display name. Switching the form to a district code would require migrating
 * both columns plus every saved address to gain nothing, so the option values
 * are canonical names straight from the CR-geo dataset.
 *
 * THE LEGACY VALUE
 * Until now this field was free text, so saved addresses hold whatever the
 * customer typed — "Sn Rafael", "cariari", a neighbourhood that is not a
 * district at all. Those values are preserved as an extra option marked
 * "(no reconocido)" instead of being dropped: rendering the select without the
 * incoming value would make the browser silently fall back to the first option
 * and QUIETLY REWRITE the customer's address to somewhere they don't live.
 * Showing it, flagged, lets validation ask them to re-pick — the only safe
 * resolution.
 *
 * A value that merely differs in case or accents is not "legacy": the lookup is
 * accent- and case-insensitive, so "PEREZ ZELEDON" resolves to the canonical
 * option and simply selects it.
 */
export default function DistrictSelect({
  cantonCode,
  value,
  onChange,
  className,
  name,
  id,
  disabled,
}: DistrictSelectProps) {
  const districts = getDistricts(cantonCode);

  // Resolved through the shared cr-geo lookup, which already folds case and
  // accents — a saved "PEREZ ZELEDON" therefore selects the "Pérez Zeledón"
  // option instead of registering as unrecognised. Re-implementing that
  // comparison here is what would let the two drift apart.
  const match = findDistrictByName(cantonCode, value);
  const canonical = match?.name ?? value;
  const unrecognized = value !== "" && match === null;

  return (
    <select
      id={id}
      name={name}
      value={canonical}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || !cantonCode || districts.length === 0}
      className={className}
      autoComplete="address-level3"
    >
      <option value="">
        {!cantonCode
          ? "Selecciona el cantón primero"
          : districts.length === 0
            ? "No hay distritos para este cantón"
            : "— Selecciona —"}
      </option>

      {/*
        Rendered BEFORE the real options and only when needed, so the value the
        form already holds always has a matching <option> on the first commit.
        Without it React would find no match and the browser would show — and on
        the next change, submit — a district the customer never chose.
      */}
      {unrecognized && (
        <option value={value}>{`${value} (no reconocido)`}</option>
      )}

      {districts.map((district) => (
        <option key={district.code} value={district.name}>
          {district.name}
        </option>
      ))}
    </select>
  );
}
