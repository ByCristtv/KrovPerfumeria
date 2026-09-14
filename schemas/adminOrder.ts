/**
 * Server-side validation for the admin manual-order payload.
 *
 * The `place_admin_order` RPC remains the authoritative gatekeeper (stock,
 * prices, admin privilege). This schema sits in front of it for the things SQL
 * cannot reasonably check — that the district named is a real district of the
 * cantón chosen — and to normalise the one genuinely optional field, the
 * customer email, into a single unambiguous representation before anything
 * downstream has to decide whether to send mail.
 *
 * Snake_case throughout, mirroring the RPC's JSON contract (and `AdminOrderInput`).
 */

import { z } from "zod";
import {
  findCanton,
  findDistrictByName,
  findProvince,
  isValidCantonCode,
} from "@/lib/cr-geo";

// ─────────────────────────────────────────────────────────────────────────────
// Optional email
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collapse every "the admin didn't give us an email" spelling into `undefined`.
 *
 * A manual order is usually taken over WhatsApp, where the phone number is the
 * only contact detail. The field arrives as null, as undefined, as "" from an
 * untouched input, or as "   " from one the admin tabbed through — and every one
 * of them has to mean the same thing, because the difference between them is
 * what decides whether the notification layer is invoked at all. Normalising
 * once, here, is what lets the rest of the flow test a single condition.
 *
 * A real address is lowercased to match what the RPC stores.
 */
export function normalizeOptionalEmail(
  raw: string | null | undefined
): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

/** Is there a customer address worth sending a confirmation to? */
export function hasCustomerEmail(raw: string | null | undefined): boolean {
  return normalizeOptionalEmail(raw) !== undefined;
}

/**
 * Optional email field: absent/blank/whitespace → undefined (valid, no mail);
 * present → must look like an address, matching the RPC's own regex check so the
 * failure surfaces as a field error rather than a raw Postgres exception.
 */
const optionalEmailSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform(normalizeOptionalEmail)
  .refine(
    (email) => email === undefined || z.string().email().safeParse(email).success,
    { message: "El correo del cliente no es válido." }
  )
  .refine((email) => email === undefined || email.length <= 254, {
    message: "El correo del cliente es demasiado largo.",
  });

// ─────────────────────────────────────────────────────────────────────────────
// Payload
// ─────────────────────────────────────────────────────────────────────────────

const customerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: "El nombre del cliente es obligatorio." })
    .max(100, { message: "El nombre del cliente es demasiado largo." }),
  phone: z
    .string()
    .trim()
    .min(8, { message: "Ingresa un teléfono válido (mín. 8 dígitos)." })
    .max(20, { message: "El teléfono es demasiado largo." }),
  email: optionalEmailSchema,
});

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { message })
    .optional()
    .transform((v) => (v ? v : undefined));

const shippingShape = z.object({
  address: z
    .string()
    .trim()
    .min(5, { message: "Las señas de entrega son obligatorias." })
    .max(500, { message: "Las señas son demasiado largas." }),
  canton_code: z
    .string()
    .refine(isValidCantonCode, { message: "Selecciona un cantón válido." }),
  canton_name: z.string().trim().min(1).max(100),
  province_name: z.string().trim().min(1).max(100),
  /** Optional: a phone customer may only give a cantón. Stored as a NAME. */
  district: optionalText(100, "El distrito es demasiado largo."),
  reference: optionalText(200, "La referencia es demasiado larga."),
});

/**
 * The district must belong to the cantón, and the cantón to the province.
 *
 * Neither can be judged alone: "Cariari" is a real district and "401" is a real
 * cantón, but "Cariari in cantón 401" is not a real place. The form now offers
 * only valid combinations, which is exactly why this check belongs on the
 * server too — the form is a convenience, and a server action is callable with
 * any payload the caller cares to construct.
 *
 * An absent district passes: it is optional by design in this flow.
 */
function requireCoherentGeography(
  shipping: z.infer<typeof shippingShape>,
  ctx: z.RefinementCtx
): void {
  const canton = findCanton(shipping.canton_code);
  // canton_code already carries its own error when unknown; don't pile on.
  if (!canton) return;

  if (shipping.district && !findDistrictByName(canton.code, shipping.district)) {
    ctx.addIssue({
      code: "custom",
      path: ["district"],
      message: `Selecciona un distrito válido de ${canton.name}.`,
    });
  }

  // The display names are derived client-side from the same dataset; if they
  // disagree with the code, the payload was not built from that dataset.
  const province = findProvince(canton.provinceCode);
  if (canton.name !== shipping.canton_name) {
    ctx.addIssue({
      code: "custom",
      path: ["canton_name"],
      message: "El cantón enviado no coincide con su código.",
    });
  }
  if (province && province.name !== shipping.province_name) {
    ctx.addIssue({
      code: "custom",
      path: ["province_name"],
      message: "La provincia enviada no coincide con el cantón.",
    });
  }
}

const itemSchema = z.object({
  variant_id: z.string().uuid({ message: "Producto inválido en el pedido." }),
  quantity: z
    .number()
    .int({ message: "La cantidad debe ser un número entero." })
    .positive({ message: "La cantidad debe ser mayor a cero." })
    .max(99, { message: "La cantidad excede el máximo permitido." }),
});

export const adminOrderInputSchema = z.object({
  customer: customerSchema,
  shipping: shippingShape.superRefine(requireCoherentGeography),
  items: z
    .array(itemSchema)
    .min(1, { message: "Agrega al menos un producto al pedido." })
    .max(100, { message: "Demasiados artículos en el pedido." }),
  shipping_method: z.enum(["delivery", "pickup"], {
    message: "Selecciona un método de envío válido.",
  }),
  discount: z
    .number()
    .nonnegative({ message: "El descuento no puede ser negativo." })
    .optional(),
  notes: optionalText(500, "Las notas son demasiado largas."),
});

/**
 * The payload after normalisation — this, not the raw client input, is what the
 * use case hands to the RPC and inspects for a customer email.
 */
export type AdminOrderInputValidated = z.infer<typeof adminOrderInputSchema>;

/**
 * First validation message, in field order, for the single-message envelope the
 * admin actions return. Full field errors stay available on the zod error for
 * anything that wants to render them per-field later.
 */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Los datos del pedido son inválidos.";
}
