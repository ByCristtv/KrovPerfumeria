import { describe, expect, it } from "vitest";
import {
  adminOrderInputSchema,
  hasCustomerEmail,
  normalizeOptionalEmail,
} from "./adminOrder";
import type { AdminOrderInput } from "@/types/adminOrder";

/**
 * The server-side contract for a manually-created order.
 *
 * Two rules carry real weight here: the optional email must collapse to ONE
 * representation of "absent" (everything downstream branches on it), and the
 * district must belong to the cantón (the form can no longer produce a bad pair,
 * but a Server Action accepts whatever payload a caller constructs).
 */

const VARIANT = "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8";

function makeInput(overrides: Partial<AdminOrderInput> = {}): AdminOrderInput {
  return {
    customer: { name: "Ana Solano", phone: "8888-8888" },
    shipping: {
      address: "200m sur de la iglesia, casa azul",
      canton_code: "101",
      canton_name: "San José",
      province_name: "San José",
      district: "Carmen",
    },
    items: [{ variant_id: VARIANT, quantity: 2 }],
    shipping_method: "delivery",
    ...overrides,
  };
}

function parse(input: AdminOrderInput) {
  return adminOrderInputSchema.safeParse(input);
}

describe("normalizeOptionalEmail", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["a tab and a newline", "\t\n"],
  ])("treats %s as absent", (_label, value) => {
    expect(normalizeOptionalEmail(value)).toBeUndefined();
    expect(hasCustomerEmail(value)).toBe(false);
  });

  it("trims and lowercases a real address", () => {
    expect(normalizeOptionalEmail("  Ana@Example.COM ")).toBe("ana@example.com");
    expect(hasCustomerEmail("  Ana@Example.COM ")).toBe(true);
  });
});

describe("adminOrderInputSchema — the optional email", () => {
  it("accepts an order with no email field at all", () => {
    const parsed = parse(makeInput());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.customer.email).toBeUndefined();
  });

  it.each([null, "", "   "])("normalises %j to undefined", (email) => {
    const parsed = parse(
      makeInput({
        customer: {
          name: "Ana Solano",
          phone: "8888-8888",
          email: email as string | undefined,
        },
      })
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.customer.email).toBeUndefined();
  });

  it("rejects a malformed address rather than passing it to the provider", () => {
    const parsed = parse(
      makeInput({
        customer: { name: "Ana Solano", phone: "8888-8888", email: "not-an-email" },
      })
    );
    expect(parsed.success).toBe(false);
  });
});

describe("adminOrderInputSchema — geography", () => {
  it("accepts a district that belongs to the cantón", () => {
    expect(parse(makeInput()).success).toBe(true);
  });

  it("accepts an omitted district", () => {
    const input = makeInput();
    delete input.shipping.district;
    expect(parse(input).success).toBe(true);
  });

  it("rejects a district from a different cantón", () => {
    const input = makeInput();
    input.shipping.district = "Cariari"; // real, but in Pococí (702)
    const parsed = parse(input);
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0].path).toEqual([
      "shipping",
      "district",
    ]);
  });

  it("rejects arbitrary free text in the district field", () => {
    const input = makeInput();
    input.shipping.district = "donde la pulpería";
    expect(parse(input).success).toBe(false);
  });

  it("rejects a cantón code that is not a real cantón", () => {
    const input = makeInput();
    input.shipping.canton_code = "999";
    expect(parse(input).success).toBe(false);
  });

  it("rejects a cantón name that disagrees with its code", () => {
    const input = makeInput();
    input.shipping.canton_name = "Pococí";
    expect(parse(input).success).toBe(false);
  });

  it("rejects a province name that disagrees with the cantón", () => {
    const input = makeInput();
    input.shipping.province_name = "Limón";
    expect(parse(input).success).toBe(false);
  });
});

describe("adminOrderInputSchema — the rest of the payload", () => {
  it("requires at least one item", () => {
    expect(parse(makeInput({ items: [] })).success).toBe(false);
  });

  it("requires a phone number", () => {
    expect(
      parse(makeInput({ customer: { name: "Ana Solano", phone: "123" } })).success
    ).toBe(false);
  });

  it("requires the exact address (señas)", () => {
    const input = makeInput();
    input.shipping.address = "  ";
    expect(parse(input).success).toBe(false);
  });

  it("rejects a negative discount", () => {
    expect(parse(makeInput({ discount: -1 })).success).toBe(false);
  });

  it("drops blank optional text to undefined", () => {
    const input = makeInput({ notes: "   " });
    input.shipping.reference = "  ";
    const parsed = parse(input);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.notes).toBeUndefined();
    expect(parsed.data.shipping.reference).toBeUndefined();
  });
});
