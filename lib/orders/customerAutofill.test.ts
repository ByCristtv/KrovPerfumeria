import { describe, expect, it } from "vitest";
import {
  applyCustomerToForm,
  savedAddressToSelection,
  type CustomerFormFields,
} from "./customerAutofill";
import { emptyAddressSelection } from "@/lib/cr-geo/selection";
import type { AdminCustomerMatch } from "@/types/adminOrder";

const blank: CustomerFormFields = {
  name: "",
  phone: "",
  email: "",
  address: emptyAddressSelection,
  exactAddress: "",
  reference: "",
};

const customer: AdminCustomerMatch = {
  user_id: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  full_name: "Ana Solano",
  email: "ana@correo.com",
  phone: "88881234",
  address: {
    province: "1",
    canton: "101",
    district: "Carmen",
    exact_address: "200m sur de la iglesia",
    reference: "casa azul",
  },
};

describe("savedAddressToSelection", () => {
  it("derives the province from the cantón and keeps a valid district", () => {
    expect(savedAddressToSelection(customer.address!)).toEqual({
      provinceCode: "1",
      cantonCode: "101",
      district: "Carmen",
    });
  });

  it("matches the district accent- and case-insensitively, storing the canonical name", () => {
    const sel = savedAddressToSelection({ ...customer.address!, district: "CARMEN" });
    expect(sel?.district).toBe("Carmen");
  });

  it("drops a district that does not belong to the cantón instead of carrying it", () => {
    const sel = savedAddressToSelection({ ...customer.address!, district: "Cariari" });
    expect(sel).toMatchObject({ cantonCode: "101", district: "" });
  });

  it("rejects the whole address when the cantón is unknown", () => {
    expect(
      savedAddressToSelection({ ...customer.address!, canton: "999" })
    ).toBeNull();
  });
});

describe("applyCustomerToForm", () => {
  describe("replace (picked from the search box)", () => {
    it("fills everything on an empty form", () => {
      const next = applyCustomerToForm(blank, customer, "replace");
      expect(next).toMatchObject({
        name: "Ana Solano",
        phone: "88881234",
        email: "ana@correo.com",
        exactAddress: "200m sur de la iglesia",
        reference: "casa azul",
        address: { cantonCode: "101", district: "Carmen" },
      });
    });

    it("overwrites what was already typed — the customer's details win", () => {
      const typed = { ...blank, name: "Otro", phone: "70000000", exactAddress: "otra" };
      const next = applyCustomerToForm(typed, customer, "replace");
      expect(next.name).toBe("Ana Solano");
      expect(next.exactAddress).toBe("200m sur de la iglesia");
    });

    it("keeps the typed value where the customer has none", () => {
      const next = applyCustomerToForm(
        { ...blank, phone: "70000000" },
        { ...customer, phone: null },
        "replace"
      );
      expect(next.phone).toBe("70000000");
    });

    it("leaves the address alone when the customer has no saved one", () => {
      const typed = { ...blank, exactAddress: "mi casa" };
      const next = applyCustomerToForm(typed, { ...customer, address: null }, "replace");
      expect(next.exactAddress).toBe("mi casa");
    });
  });

  describe("fill-blanks (accepted from the email hint)", () => {
    it("never overwrites a name or phone the admin already typed", () => {
      const typed = { ...blank, name: "Ana S.", phone: "70000000" };
      const next = applyCustomerToForm(typed, customer, "fill-blanks");
      expect(next.name).toBe("Ana S.");
      expect(next.phone).toBe("70000000");
    });

    it("fills the blanks", () => {
      const next = applyCustomerToForm(blank, customer, "fill-blanks");
      expect(next.name).toBe("Ana Solano");
      expect(next.phone).toBe("88881234");
    });

    it("does not replace a delivery address the admin has started", () => {
      const typed = { ...blank, exactAddress: "entregar en la oficina" };
      const next = applyCustomerToForm(typed, customer, "fill-blanks");
      expect(next.exactAddress).toBe("entregar en la oficina");
      expect(next.address).toEqual(emptyAddressSelection);
    });

    it("fills the address when the admin has not touched it", () => {
      const next = applyCustomerToForm(blank, customer, "fill-blanks");
      expect(next.address.cantonCode).toBe("101");
    });

    it("always takes the account's email — it is the identity being linked", () => {
      const next = applyCustomerToForm(
        { ...blank, email: "ANA@Correo.com " },
        customer,
        "fill-blanks"
      );
      expect(next.email).toBe("ana@correo.com");
    });
  });
});
