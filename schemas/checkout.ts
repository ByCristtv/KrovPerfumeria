/**
 * Checkout validation schema + payload builder.
 *
 * Two related pieces:
 *   1. `checkoutFormSchema` — what react-hook-form validates while the user fills the form.
 *      Mirrors the visible input fields (customer + shipping + notes). Items
 *      live in the cart store, not the form.
 *   2. `buildCheckoutPayload()` — assembles the JSON payload sent to the
 *      `/api/checkout/session` route (Phase 4) by joining validated form
 *      values with cart contents and deriving canton/province display names.
 *
 * Snake_case is used throughout to match the place_order RPC's payload contract,
 * eliminating a camelCase ↔ snake_case translation layer.
 */

import { z } from "zod";
import {
  findCanton,
  findDistrictByName,
  findProvince,
  isValidCantonCode,
} from "@/lib/cr-geo";
import type { CartLineItem } from "@/types/product";

// ─────────────────────────────────────────────────────────────────────────────
// Sub-schemas
// ─────────────────────────────────────────────────────────────────────────────

const customerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: "Ingresa tu nombre completo" })
    .max(100, { message: "Nombre demasiado largo" }),
  email: z
    .string()
    .trim()
    .email({ message: "Correo electrónico inválido" })
    .max(254, { message: "Correo electrónico demasiado largo" }),
  phone: z
    .string()
    .trim()
    .min(8, { message: "Teléfono inválido (mínimo 8 dígitos)" })
    .max(20, { message: "Teléfono demasiado largo" }),
});

/**
 * The shipping fields as plain shape, with no cross-field rule attached.
 *
 * Kept separate from `shippingSchema` because `.superRefine()` returns a schema
 * that can no longer be `.extend()`ed, and the API payload schema below has to
 * add canton_name/province_name to exactly these fields. One shape, extended
 * once, with the same rule applied to both — rather than two shapes that could
 * drift.
 */
const shippingShape = z.object({
  address: z
    .string()
    .trim()
    .min(10, { message: "Escribe las señas exactas (al menos 10 caracteres)" })
    .max(500, { message: "Dirección demasiado larga" }),
  canton_code: z
    .string()
    .refine(isValidCantonCode, { message: "Selecciona un cantón válido" }),
  district: z
    .string()
    .trim()
    .min(1, { message: "El distrito es requerido" })
    .max(100, { message: "Distrito demasiado largo" }),
  reference: z
    .string()
    .trim()
    .max(200, { message: "Referencia demasiado larga" })
    .optional(),
  /**
   * "I'm in Cariari centro" — an INTENT, not an entitlement.
   *
   * Intentionally unvalidated against the address here. The server does not
   * trust it either way: `resolveShippingCost` re-derives eligibility from the
   * cantón and district, so a forged `true` on a San José address simply has
   * no effect. Rejecting it instead would turn a harmless stale checkbox — the
   * customer ticked it, then changed cantón — into a submit-blocking error.
   */
  local_delivery: z.boolean().optional(),
});

/**
 * The district must actually belong to the cantón.
 *
 * A cross-field rule, because neither field can be judged alone: "Cariari" is a
 * real district and "401" is a real cantón, but "Cariari in cantón 401" is not a
 * real place. This is also what makes the Cariari shipping rule safe — without
 * it a hand-crafted payload could name any district under any cantón and claim a
 * local delivery rate it isn't entitled to.
 *
 * Applied to BOTH the form schema and the server-side payload schema. The
 * server one is the one that matters: the browser can be bypassed entirely.
 *
 * Skipped when the cantón is itself invalid — that field already carries its own
 * error, and adding "this district isn't in cantón ''" on top of it is noise.
 */
function requireDistrictInCanton(
  shipping: { canton_code: string; district: string },
  ctx: z.RefinementCtx
): void {
  if (!isValidCantonCode(shipping.canton_code)) return;
  if (findDistrictByName(shipping.canton_code, shipping.district)) return;

  const canton = findCanton(shipping.canton_code);
  ctx.addIssue({
    code: "custom",
    path: ["district"],
    message: canton
      ? `Selecciona un distrito válido de ${canton.name}`
      : "Selecciona un distrito válido",
  });
}

const shippingSchema = shippingShape.superRefine(requireDistrictInCanton);

// ─────────────────────────────────────────────────────────────────────────────
// Form schema (what react-hook-form validates)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How the customer wants to pay. Values match PaymentMethodId in
 * lib/checkout/types.ts — the registry maps each to a processor.
 */
export const paymentMethodSchema = z.enum(["card", "sinpe"], {
  message: "Selecciona un método de pago",
});

export const checkoutFormSchema = z.object({
  customer: customerSchema,
  shipping: shippingSchema,
  notes: z
    .string()
    .trim()
    .max(500, { message: "Notas demasiado largas" }),
  payment_method: paymentMethodSchema,
});

export type CheckoutFormValues = z.infer<typeof checkoutFormSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// API-side payload schema — what /api/checkout/session validates server-side.
// ─────────────────────────────────────────────────────────────────────────────
//
// The client-side form schema only covers user-input fields. The API payload
// adds the derived canton_name/province_name fields (filled in by
// buildCheckoutPayload from the CR-geo dataset) and the items array (read
// from the cart at submit time).
//
// We re-validate everything server-side because the API route is a public
// HTTP endpoint and we never trust client-validated data. A malicious user
// can curl arbitrary JSON to /api/checkout/session.

const lineItemSchema = z.object({
  variant_id: z.string().uuid({ message: "variant_id debe ser un UUID válido" }),
  quantity: z
    .number()
    .int({ message: "quantity debe ser un entero" })
    .positive({ message: "quantity debe ser positivo" })
    .max(99, { message: "quantity excede el máximo permitido" }),
});

const shippingPayloadSchema = shippingShape
  .extend({
    canton_name: z
      .string()
      .trim()
      .min(1, { message: "shipping.canton_name es requerido" })
      .max(100),
    province_name: z
      .string()
      .trim()
      .min(1, { message: "shipping.province_name es requerido" })
      .max(100),
  })
  .superRefine(requireDistrictInCanton);

/**
 * Reference to this checkout's live pending order, echoed back by the client on
 * every submit after the first.
 *
 * Its presence is what turns a submit into an UPDATE instead of a new order. The
 * server re-verifies `order_token` (an HMAC of order_id) before touching
 * anything — a client-supplied order_id is never trusted on its own.
 */
const checkoutSessionSchema = z.object({
  order_id: z.string().uuid({ message: "session.order_id debe ser un UUID válido" }),
  order_token: z
    .string()
    .min(1, { message: "session.order_token es requerido" })
    .max(200),
});

export const checkoutPayloadSchema = z.object({
  customer: customerSchema,
  shipping: shippingPayloadSchema,
  items: z
    .array(lineItemSchema)
    .min(1, { message: "items no puede estar vacío" })
    .max(100, { message: "Demasiados artículos en el pedido" }),
  notes: z
    .string()
    .trim()
    .max(500, { message: "Notas demasiado largas" })
    .optional(),
  payment_method: paymentMethodSchema,
  session: checkoutSessionSchema.optional(),
});

export type CheckoutPayloadValidated = z.infer<typeof checkoutPayloadSchema>;

/** Customer-selected payment method. Mirrors PaymentMethodId (lib/checkout/types.ts). */
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * Sensible defaults for `useForm({ defaultValues })`. All strings (never
 * undefined) so controlled inputs work cleanly from the first render.
 */
export const checkoutFormDefaults: CheckoutFormValues = {
  customer: { name: "", email: "", phone: "" },
  shipping: {
    address: "",
    canton_code: "",
    district: "",
    reference: "",
    local_delivery: false,
  },
  notes: "",
  // Card is the default: it completes in-page, whereas SINPE hands the customer a
  // manual transfer + a wait for admin validation.
  payment_method: "card",
};

// ─────────────────────────────────────────────────────────────────────────────
// Payload (what gets POSTed to /api/checkout/session in Phase 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape of the payload sent to the server checkout route, which the route
 * then forwards (after server-side re-validation) to the place_order RPC.
 *
 * Mirrors place_order(p_payload JSONB) exactly — snake_case throughout.
 */
export interface CheckoutPayload {
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  shipping: {
    address: string;
    canton_code: string;
    canton_name: string;
    province_name: string;
    district?: string;
    reference?: string;
    /** See the schema note — an intent the server re-checks, never a price. */
    local_delivery?: boolean;
  };
  items: Array<{
    variant_id: string;
    quantity: number;
  }>;
  notes?: string;
  payment_method: PaymentMethod;
  /**
   * Omitted on the first submit; set once the checkout has a pending order, which
   * makes every later submit update that order instead of creating another.
   */
  session?: {
    order_id: string;
    order_token: string;
  };
}

/**
 * Build the API payload from validated form values + current cart contents.
 *
 *  - Derives canton_name + province_name from canton_code via the CR-geo dataset.
 *  - Strips empty optional strings to `undefined` so they JSON-serialize cleanly.
 *  - Lowercases email (matches what place_order RPC does internally — done
 *    here too so the client-side payload looks consistent in dev tools/logs).
 *
 * Throws if the form's canton_code isn't in the CR-geo dataset — this should
 * never happen because the form schema already validates via isValidCantonCode,
 * but we keep the defensive check so a bug in cr-geo accessors can't silently
 * send garbage to the server.
 */
export function buildCheckoutPayload(
  formValues: CheckoutFormValues,
  cartItems: CartLineItem[],
  session?: CheckoutPayload["session"]
): CheckoutPayload {
  const canton = findCanton(formValues.shipping.canton_code);
  if (!canton) {
    throw new Error(
      `Internal error: unknown canton code "${formValues.shipping.canton_code}"`
    );
  }
  const province = findProvince(canton.provinceCode);
  if (!province) {
    throw new Error(
      `Internal error: unknown province for canton "${canton.code}"`
    );
  }

  const optional = (v?: string): string | undefined => !v || v.trim() === "" ? undefined : v.trim();

  return {
    customer: {
      name: formValues.customer.name.trim(),
      email: formValues.customer.email.trim().toLowerCase(),
      phone: formValues.customer.phone.trim(),
    },
    shipping: {
      address: formValues.shipping.address.trim(),
      canton_code: canton.code,
      canton_name: canton.name,
      province_name: province.name,
      district: formValues.shipping.district.trim(),
      reference: optional(formValues.shipping.reference),
      local_delivery: formValues.shipping.local_delivery === true,
    },
    items: cartItems.map((item) => ({
      variant_id: item.variant_id,
      quantity: item.quantity,
    })),
    notes: optional(formValues.notes),
    payment_method: formValues.payment_method,
    ...(session && { session }),
  };
}
