"use client";

import DistrictSelect from "@/components/ui/DistrictSelect";
import { getCantones, getProvinces } from "@/lib/cr-geo";
import {
  selectCanton,
  selectDistrict,
  selectProvince,
  type AddressSelection,
} from "@/lib/cr-geo/selection";
import Field from "./Field";

interface AdminAddressFieldsProps {
  value: AddressSelection;
  onChange: (next: AddressSelection) => void;
  disabled?: boolean;
}

/**
 * Provincia → Cantón → Distrito for the manual-order form.
 *
 * All three levels are dropdowns backed by the shared CR-geo dataset. The
 * district used to be free text here, which let an admin type a district that
 * does not exist in the chosen cantón — the order then shipped to a place the
 * geo-derived shipping cost was never computed for, and the confirmation email
 * quoted it back to the customer as fact.
 *
 * The component owns no state: it holds the selection as one value and hands
 * back the next one, so the cascade's reset rules stay in the pure helpers in
 * lib/cr-geo/selection (testable without React, shared with checkout's rules)
 * rather than in effects that fire after a render has already shown a stale
 * option as selected.
 */
export default function AdminAddressFields({
  value,
  onChange,
  disabled = false,
}: AdminAddressFieldsProps) {
  const provinces = getProvinces();
  const cantones = getCantones(value.provinceCode);

  return (
    <>
      <Field label="Provincia">
        <select
          className="adm-input"
          value={value.provinceCode}
          disabled={disabled}
          onChange={(e) => onChange(selectProvince(value, e.target.value))}
        >
          <option value="">— Selecciona —</option>
          {provinces.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Cantón">
        <select
          className="adm-input"
          value={value.cantonCode}
          disabled={disabled || !value.provinceCode}
          onChange={(e) => onChange(selectCanton(value, e.target.value))}
        >
          <option value="">
            {value.provinceCode ? "— Selecciona —" : "Provincia primero"}
          </option>
          {cantones.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      {/*
        Shared with checkout and the profile address card: one district
        implementation, so the "unrecognised legacy value" handling and the
        accent-insensitive matching cannot drift between the storefront and the
        admin panel.
      */}
      <Field label="Distrito" htmlFor="admin-order-district">
        <DistrictSelect
          id="admin-order-district"
          className="adm-input"
          cantonCode={value.cantonCode}
          value={value.district}
          disabled={disabled}
          onChange={(district) => onChange(selectDistrict(value, district))}
        />
      </Field>
    </>
  );
}
