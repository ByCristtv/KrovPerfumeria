/**
 * The loyalty-admin error contract between Postgres and the app.
 *
 * The admin RPCs of migration 20261109000200 fail with
 * `RAISE EXCEPTION '<code>[:detail]'` (detail = a level number for threshold
 * errors). This module is the ONLY place those strings are interpreted; an
 * unknown message degrades to a generic one instead of leaking SQL text.
 */

export type LoyaltyErrorCode =
  | "loyalty_forbidden"
  | "levels_invalid_payload"
  | "levels_invalid_value"
  | "levels_unknown_level"
  | "levels_duplicate_level"
  | "levels_incomplete"
  | "levels_base_not_zero"
  | "levels_not_increasing"
  | "levels_stale"
  | "reward_not_found"
  | "reward_invalid_level"
  | "reward_invalid_name"
  | "reward_invalid_description"
  | "reward_invalid_type"
  | "reward_invalid_value"
  | "reward_invalid_min_subtotal"
  | "reward_invalid_max_discount"
  | "reward_invalid_valid_days"
  | "reward_invalid_request"
  | "reward_stale"
  | "reward_inactive"
  | "reward_has_issued_coupons";

const KNOWN: ReadonlySet<string> = new Set<LoyaltyErrorCode>([
  "loyalty_forbidden",
  "levels_invalid_payload",
  "levels_invalid_value",
  "levels_unknown_level",
  "levels_duplicate_level",
  "levels_incomplete",
  "levels_base_not_zero",
  "levels_not_increasing",
  "levels_stale",
  "reward_not_found",
  "reward_invalid_level",
  "reward_invalid_name",
  "reward_invalid_description",
  "reward_invalid_type",
  "reward_invalid_value",
  "reward_invalid_min_subtotal",
  "reward_invalid_max_discount",
  "reward_invalid_valid_days",
  "reward_invalid_request",
  "reward_stale",
  "reward_inactive",
  "reward_has_issued_coupons",
]);

export interface ParsedLoyaltyError {
  code: LoyaltyErrorCode;
  /** The level number threshold errors carry after the colon. */
  level?: number;
}

export function parseLoyaltyError(message: string | null | undefined): ParsedLoyaltyError | null {
  if (!message) return null;
  const [code, detail] = message.trim().split(":");
  if (!KNOWN.has(code)) return null;

  const parsed: ParsedLoyaltyError = { code: code as LoyaltyErrorCode };
  if (detail !== undefined && /^\d+$/.test(detail)) parsed.level = Number(detail);
  return parsed;
}

/**
 * PostgREST / Postgres signals that the migration is not applied yet: the
 * function (or a column it reads) does not exist.
 */
export function isMissingMigrationError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /Could not find the function|does not exist|schema cache/i.test(error.message ?? "")
  );
}

export const MISSING_MIGRATION_MESSAGE =
  "Falta aplicar las migraciones de recompensas (20261109000100 y 20261109000200) en Supabase.";

/** Spanish message for the admin. `levelName` names the rank a level error is about. */
export function loyaltyErrorMessage(
  error: ParsedLoyaltyError,
  levelName?: (level: number) => string | undefined
): string {
  const rank = error.level !== undefined ? levelName?.(error.level) ?? `nivel ${error.level}` : null;

  switch (error.code) {
    case "loyalty_forbidden":
      return "No tienes permiso para realizar esta acción.";
    case "levels_invalid_payload":
    case "levels_incomplete":
    case "levels_unknown_level":
    case "levels_duplicate_level":
      return "La configuración enviada no incluye cada rango exactamente una vez. Recarga la página e inténtalo de nuevo.";
    case "levels_invalid_value":
      return `La XP de ${rank ?? "un rango"} debe ser un número entero entre 0 y 10.000.000.`;
    case "levels_base_not_zero":
      return "El rango inicial siempre requiere 0 XP.";
    case "levels_not_increasing":
      return `${rank ?? "Un rango"} debe requerir más XP que el rango anterior. No se guardó ningún cambio.`;
    case "levels_stale":
      return "Otro administrador cambió los umbrales mientras editabas. Recarga la página para ver la versión actual; no se guardó ningún cambio.";
    case "reward_not_found":
      return "La recompensa ya no existe. Recarga la página.";
    case "reward_invalid_level":
      return "Elige un rango válido.";
    case "reward_invalid_name":
      return "El nombre debe tener entre 1 y 80 caracteres.";
    case "reward_invalid_description":
      return "La descripción admite hasta 300 caracteres.";
    case "reward_invalid_type":
      return "Tipo de descuento inválido.";
    case "reward_invalid_value":
      return "El valor del descuento no es válido para su tipo.";
    case "reward_invalid_min_subtotal":
      return "La compra mínima debe ser un número entero de colones.";
    case "reward_invalid_max_discount":
      return "El tope de descuento debe ser un número entero de colones y solo aplica a porcentajes.";
    case "reward_invalid_valid_days":
      return "La vigencia debe estar entre 1 y 3650 días.";
    case "reward_invalid_request":
      return "Solicitud inválida.";
    case "reward_stale":
      return "Otro administrador modificó esta recompensa mientras la editabas. Recarga la página; no se guardaron cambios.";
    case "reward_inactive":
      return "Activa la recompensa antes de emitirla a clientes.";
    case "reward_has_issued_coupons":
      return "Esta recompensa ya fue entregada a clientes, así que no se puede eliminar. Desactívala para dejar de emitirla.";
  }
}
