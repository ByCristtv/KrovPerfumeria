/**
 * Validation for admin XP adjustments (Admin → Clientes → [id]).
 *
 * Shared by the client form (instant feedback) and the server action (the
 * input is untrusted there — a server action can be POSTed directly). The
 * database function `admin_adjust_customer_xp` (migration 20261022000100)
 * re-checks every rule and holds a row lock for the negative-balance check, so
 * this layer is for good error messages, not the security boundary.
 *
 * Limits mirror the SQL — keep in lock-step.
 */

/** Largest single adjustment, either direction. */
export const MAX_XP_ADJUSTMENT = 100_000;

/** Longest reason (after trimming). */
export const MAX_XP_REASON_LENGTH = 300;

export type XpAdjustmentDirection = "add" | "deduct";

export interface XpAdjustmentInput {
  direction: XpAdjustmentDirection;
  /** Raw amount as typed (string from the form, or a number). Always positive. */
  amount: string | number;
  reason?: string | null;
}

export type XpAdjustmentValidation =
  | { ok: true; delta: number; reason: string | null }
  | { ok: false; field: "direction" | "amount" | "reason"; message: string };

/**
 * Validate an adjustment and turn it into the signed `delta` the RPC takes.
 *
 * `currentXp` is optional: when known (the detail page has it) a deduction
 * that would push the balance below zero is rejected up front. The database
 * still decides with the locked, current balance.
 */
export function validateXpAdjustment(
  input: XpAdjustmentInput,
  currentXp?: number
): XpAdjustmentValidation {
  if (input.direction !== "add" && input.direction !== "deduct") {
    return { ok: false, field: "direction", message: "Elige si quieres sumar o restar XP." };
  }

  const raw = typeof input.amount === "number" ? String(input.amount) : input.amount.trim();
  // Digits only: rejects "", "-5", "1.5", "1e3", " 10 " (already trimmed), etc.
  if (!/^\d+$/.test(raw)) {
    return { ok: false, field: "amount", message: "Ingresa una cantidad entera de XP." };
  }

  const amount = Number(raw);
  if (amount <= 0) {
    return { ok: false, field: "amount", message: "La cantidad debe ser mayor a 0." };
  }
  if (amount > MAX_XP_ADJUSTMENT) {
    return {
      ok: false,
      field: "amount",
      message: `El máximo por ajuste es ${MAX_XP_ADJUSTMENT.toLocaleString("en-US")} XP.`,
    };
  }

  const reason = input.reason?.trim() || null;
  if (reason && reason.length > MAX_XP_REASON_LENGTH) {
    return {
      ok: false,
      field: "reason",
      message: `El motivo no puede superar ${MAX_XP_REASON_LENGTH} caracteres.`,
    };
  }

  const delta = input.direction === "add" ? amount : -amount;

  if (currentXp !== undefined && currentXp + delta < 0) {
    return {
      ok: false,
      field: "amount",
      message: `No se puede restar más XP del disponible (${currentXp.toLocaleString("en-US")} XP).`,
    };
  }

  return { ok: true, delta, reason };
}
