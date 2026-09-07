import { describe, expect, it } from "vitest";
import {
  buildCheckoutPayload,
  checkoutFormDefaults,
  checkoutFormSchema,
  checkoutPayloadSchema,
  type CheckoutFormValues,
} from "./checkout";
import type { CartLineItem } from "@/types/product";

/** A form the customer filled in correctly — the baseline every case varies. */
const validForm: CheckoutFormValues = {
  customer: {
    name: "María Pérez González",
    email: "Maria@Correo.com",
    phone: "8888-8888",
  },
  shipping: {
    address: "200m sur de la iglesia católica, casa azul portón negro",
    canton_code: "702",
    district: "Cariari",
    reference: "Frente al parque",
  },
  notes: "",
  payment_method: "card",
};

const withShipping = (
  overrides: Partial<CheckoutFormValues["shipping"]>
): CheckoutFormValues => ({
  ...validForm,
  shipping: { ...validForm.shipping, ...overrides },
});

/** Field paths that failed, as "shipping.district"-style strings. */
const issuePaths = (values: unknown): string[] => {
  const result = checkoutFormSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
};

const cart: CartLineItem[] = [
  {
    variant_id: "11111111-1111-4111-8111-111111111111",
    product_name: "Aventus",
    size_ml: 100,
    quantity: 1,
    price: 90_000,
  } as CartLineItem,
];

describe("checkoutFormSchema — the happy path", () => {
  it("accepts a completed form", () => {
    expect(checkoutFormSchema.safeParse(validForm).success).toBe(true);
  });

  it("ships defaults that are shaped for controlled inputs", () => {
    // Every string present (never undefined) so no input flips
    // uncontrolled → controlled on the first keystroke.
    expect(checkoutFormDefaults.shipping.district).toBe("");
    expect(checkoutFormDefaults.shipping.canton_code).toBe("");
  });

  it("does not accept its own defaults as a submittable form", () => {
    expect(checkoutFormSchema.safeParse(checkoutFormDefaults).success).toBe(
      false
    );
  });
});

describe("checkoutFormSchema — the district field", () => {
  it("requires a district", () => {
    expect(issuePaths(withShipping({ district: "" }))).toContain(
      "shipping.district"
    );
  });

  it("accepts a district that belongs to the chosen cantón", () => {
    expect(
      checkoutFormSchema.safeParse(
        withShipping({ canton_code: "702", district: "Guápiles" })
      ).success
    ).toBe(true);
  });

  it("rejects a real district paired with the wrong cantón", () => {
    // Cariari is real, Heredia (401) is real, the combination is not.
    const result = checkoutFormSchema.safeParse(
      withShipping({ canton_code: "401", district: "Cariari" })
    );
    expect(result.success).toBe(false);
    expect(issuePaths(withShipping({ canton_code: "401", district: "Cariari" })))
      .toContain("shipping.district");
  });

  it("names the cantón in the error, so the customer knows what to fix", () => {
    const result = checkoutFormSchema.safeParse(
      withShipping({ canton_code: "401", district: "Cariari" })
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path.join(".") === "shipping.district"
    );
    expect(issue?.message).toBe("Selecciona un distrito válido de Heredia");
  });

  it("rejects a district that does not exist anywhere", () => {
    expect(issuePaths(withShipping({ district: "Barrio Los Ángeles" }))).toContain(
      "shipping.district"
    );
  });

  it("accepts a legacy value that differs only in case or accents", () => {
    // Prefilled profiles hold hand-typed values; folding is what keeps a
    // returning customer from being blocked on a spelling difference.
    expect(
      checkoutFormSchema.safeParse(
        withShipping({ canton_code: "101", district: "san sebastian" })
      ).success
    ).toBe(true);
  });

  it("does not pile a district error on top of an invalid cantón", () => {
    // One actionable error at a time: with no cantón chosen, "this district is
    // not in cantón ''" tells the customer nothing they can act on.
    const paths = issuePaths(
      withShipping({ canton_code: "", district: "Cariari" })
    );
    expect(paths).toContain("shipping.canton_code");
    expect(paths).not.toContain("shipping.district");
  });

  it("still rejects an unknown cantón outright", () => {
    expect(issuePaths(withShipping({ canton_code: "999" }))).toContain(
      "shipping.canton_code"
    );
  });
});

describe("checkoutPayloadSchema — the server-side gate", () => {
  const validPayload = buildCheckoutPayload(validForm, cart);

  it("accepts a payload built from a valid form", () => {
    expect(checkoutPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it("applies the same district/cantón rule as the form", () => {
    // The browser can be bypassed entirely; this is the check that matters.
    const forged = {
      ...validPayload,
      shipping: {
        ...validPayload.shipping,
        canton_code: "401",
        canton_name: "Heredia",
        province_name: "Heredia",
        district: "Cariari",
      },
    };
    expect(checkoutPayloadSchema.safeParse(forged).success).toBe(false);
  });

  it("rejects an invented district on a real cantón", () => {
    const forged = {
      ...validPayload,
      shipping: { ...validPayload.shipping, district: "Zona Franca" },
    };
    expect(checkoutPayloadSchema.safeParse(forged).success).toBe(false);
  });

  it("still requires the derived cantón and province names", () => {
    const shippingWithoutCanton = { ...validPayload.shipping };
    delete (shippingWithoutCanton as { canton_name?: string }).canton_name;

    expect(
      checkoutPayloadSchema.safeParse({
        ...validPayload,
        shipping: shippingWithoutCanton,
      }).success
    ).toBe(false);
  });

  it("rejects an empty cart", () => {
    expect(
      checkoutPayloadSchema.safeParse({ ...validPayload, items: [] }).success
    ).toBe(false);
  });
});

describe("buildCheckoutPayload", () => {
  it("derives the cantón and province names from the code", () => {
    const payload = buildCheckoutPayload(validForm, cart);
    expect(payload.shipping.canton_name).toBe("Pococí");
    expect(payload.shipping.province_name).toBe("Limón");
  });

  it("carries the district through", () => {
    expect(buildCheckoutPayload(validForm, cart).shipping.district).toBe(
      "Cariari"
    );
  });

  it("lowercases the email, matching what place_order stores", () => {
    expect(buildCheckoutPayload(validForm, cart).customer.email).toBe(
      "maria@correo.com"
    );
  });

  it("strips empty optionals rather than sending empty strings", () => {
    const payload = buildCheckoutPayload(
      { ...withShipping({ reference: "" }), notes: "" },
      cart
    );
    expect(payload.shipping.reference).toBeUndefined();
    expect(payload.notes).toBeUndefined();
  });

  it("maps the cart to variant/quantity pairs only", () => {
    expect(buildCheckoutPayload(validForm, cart).items).toEqual([
      { variant_id: cart[0].variant_id, quantity: 1 },
    ]);
  });

  it("throws rather than sending an unknown cantón to the server", () => {
    expect(() =>
      buildCheckoutPayload(withShipping({ canton_code: "999" }), cart)
    ).toThrow(/unknown canton code/i);
  });
});
