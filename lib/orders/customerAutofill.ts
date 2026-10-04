import { findCanton, findDistrictByName } from "@/lib/cr-geo";
import type { AddressSelection } from "@/lib/cr-geo/selection";
import type { AdminCustomerMatch } from "@/types/adminOrder";

/**
 * What picking a registered customer pre-fills in the manual-order form.
 *
 * Pure so the rules can be tested without rendering the form. The two modes
 * exist because the same customer can arrive two ways with different stakes:
 *
 *  - "replace": the admin picked someone from the search box. That is the start
 *    of the order, so the customer's details win.
 *  - "fill-blanks": the admin typed an email and accepted the "link this
 *    account" hint. By then they may have typed a name or an address by hand
 *    (a different delivery address than the saved one, say), and linking an
 *    account must not silently overwrite that.
 */

export type AutofillMode = "replace" | "fill-blanks";

export interface CustomerFormFields {
  name: string;
  phone: string;
  email: string;
  address: AddressSelection;
  exactAddress: string;
  reference: string;
}

/**
 * Saved address → the form's cascade value, or null when it cannot be trusted.
 *
 * `addresses.province` / `.canton` hold CODES, `.district` a NAME (see the note
 * in lib/cr-geo). Old rows can hold a district that no longer matches its
 * cantón; that district is dropped (it is optional here) rather than carried
 * into an order the server would then reject. An unknown cantón rejects the
 * whole address — a half-filled cascade is worse than an empty one.
 */
export function savedAddressToSelection(
  address: NonNullable<AdminCustomerMatch["address"]>
): AddressSelection | null {
  const canton = findCanton(address.canton);
  if (!canton) return null;

  const district = findDistrictByName(canton.code, address.district);
  return {
    provinceCode: canton.provinceCode,
    cantonCode: canton.code,
    district: district?.name ?? "",
  };
}

export function applyCustomerToForm(
  current: CustomerFormFields,
  customer: AdminCustomerMatch,
  mode: AutofillMode
): CustomerFormFields {
  const replace = mode === "replace";
  const pick = (existing: string, incoming: string | null | undefined) => {
    const next = (incoming ?? "").trim();
    if (!next) return existing;
    return replace || !existing.trim() ? next : existing;
  };

  const next: CustomerFormFields = {
    ...current,
    name: pick(current.name, customer.full_name),
    phone: pick(current.phone, customer.phone),
    // The email is the account's identity: always take it, in either mode.
    email: customer.email,
  };

  const selection = customer.address
    ? savedAddressToSelection(customer.address)
    : null;

  if (customer.address && selection) {
    const addressUntouched =
      !current.address.cantonCode && !current.exactAddress.trim();
    if (replace || addressUntouched) {
      next.address = selection;
      next.exactAddress = customer.address.exact_address.trim();
      next.reference = (customer.address.reference ?? "").trim();
    }
  }

  return next;
}
